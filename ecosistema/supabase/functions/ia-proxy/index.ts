// supabase/functions/ia-proxy/index.ts
// Proxy único de IA para todos los módulos de El Independiente 2030.
// La API key de Gemini vive solo en el secreto GEMINI_API_KEY.
//
// Variables de entorno:
//   GEMINI_API_KEY          (obligatoria) key de Google AI Studio
//   ALLOWED_ORIGINS         orígenes permitidos separados por coma
//                           ej: https://gabrielgenri.github.io,http://localhost:5500
//   ALLOWED_MODELS          modelos permitidos separados por coma
//   RATE_LIMIT_PER_HOUR     solicitudes por usuario por hora (default 60)
// Inyectadas automáticamente por Supabase:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://gabrielgenri.github.io,http://localhost:5500,http://127.0.0.1:5500")
  .split(",").map((s) => s.trim()).filter(Boolean);

const ALLOWED_MODELS = (Deno.env.get("ALLOWED_MODELS") ??
  "gemini-3.8-flash")
  .split(",").map((s) => s.trim()).filter(Boolean);

const RATE_LIMIT = Number(Deno.env.get("RATE_LIMIT_PER_HOUR") ?? "60");
const MAX_INPUT_CHARS = 40_000;
const MAX_OUTPUT_TOKENS = 16_000;
const TIMEOUT_MS = 55_000;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
  extra: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
      ...extra,
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405, origin);
  }
  // --- 1) Autenticación ------------------------------------------
  const token = (req.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!token) return json({ error: "Sesión requerida" }, 401, origin);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json({ error: "Sesión inválida o vencida" }, 401, origin);
  }
  const userId = userData.user.id;

  // --- 2) Validación de entrada ----------------------------------
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "El cuerpo debe ser JSON válido" }, 400, origin);
  }

  if (body.health === true) {
    const { error: dbError } = await admin.from("ia_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (dbError) return json({ ok: false, function: "ia-proxy", error: "No se pudo consultar ia_usage" }, 503, origin);
    return json({ ok: true, function: "ia-proxy", dbConnected: true, geminiConfigured: Boolean(GEMINI_API_KEY), model: ALLOWED_MODELS[0] ?? null }, 200, origin);
  }

  if (!GEMINI_API_KEY) {
    return json({ error: "El servicio de IA no está configurado" }, 502, origin);
  }

  const model = String(body.model ?? ALLOWED_MODELS[0]);
  if (!ALLOWED_MODELS.includes(model)) {
    return json({ error: "Modelo no permitido" }, 400, origin);
  }

  const prompt = String(body.prompt ?? "").trim();
  const system = String(body.systemInstruction ?? "").trim();
  if (!prompt) return json({ error: "Falta el prompt" }, 400, origin);
  if (prompt.length + system.length > MAX_INPUT_CHARS) {
    return json({ error: "El texto supera el máximo permitido" }, 400, origin);
  }

  const temperature = Math.min(1.5, Math.max(0, Number(body.temperature ?? 0.7)));
  const maxOutputTokens = Math.min(
    MAX_OUTPUT_TOKENS,
    Math.max(256, Number(body.maxOutputTokens ?? 8192)),
  );
  const search = body.search === true;
  const schema = body.schema && typeof body.schema === "object"
    ? body.schema
    : null;
  const modulo = typeof body.modulo === "string"
    ? body.modulo.slice(0, 40)
    : null;

  // --- 3) Rate limit por usuario ---------------------------------
  const desde = new Date(Date.now() - 3600_000).toISOString();
  const { count, error: countErr } = await admin
    .from("ia_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", desde);
  if (countErr) {
    console.error("rate-limit:", countErr.message);
    return json({ error: "No se pudo verificar el límite de uso" }, 502, origin);
  }
  if ((count ?? 0) >= RATE_LIMIT) {
    return json(
      { error: "Alcanzaste el límite horario de uso de IA. Probá más tarde." },
      429,
      origin,
      { "Retry-After": "3600" },
    );
  }

  // --- 4) Llamada a Gemini ---------------------------------------
  const payload: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens },
  };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  if (schema) {
    (payload.generationConfig as Record<string, unknown>).responseMimeType =
      "application/json";
    (payload.generationConfig as Record<string, unknown>).responseSchema =
      schema;
  }
  if (search) payload.tools = [{ google_search: {} }];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let gRes: Response;
  try {
    gRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      },
    );
  } catch (e) {
    clearTimeout(timer);
    const timeout = (e as Error).name === "AbortError";
    return json(
      { error: timeout ? "La IA tardó demasiado en responder" : "No se pudo contactar a la IA" },
      timeout ? 504 : 502,
      origin,
    );
  }
  clearTimeout(timer);

  if (!gRes.ok) {
    // Se registra solo el código; nunca se reenvía el cuerpo crudo al cliente.
    console.error("gemini status:", gRes.status);
    const msg = gRes.status === 429
      ? "La IA está saturada. Reintentá en unos minutos."
      : "La IA devolvió un error";
    return json({ error: msg }, gRes.status === 429 ? 429 : 502, origin);
  }

  const data = await gRes.json();
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");

  if (!text) {
    return json(
      { error: "La IA no devolvió contenido (posible bloqueo de seguridad)" },
      502,
      origin,
    );
  }

  // Fuentes del grounding, sin duplicados
  const seen = new Set<string>();
  const sources: { uri: string; title: string }[] = [];
  for (const ch of cand?.groundingMetadata?.groundingChunks ?? []) {
    const uri = ch?.web?.uri;
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ uri, title: ch.web.title ?? uri });
    }
  }

  const usage = {
    promptTokens: data?.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data?.usageMetadata?.candidatesTokenCount ?? 0,
  };

  // --- 5) Registro de uso (solo metadatos, nunca el contenido) ----
  const { error: logErr } = await admin.from("ia_usage").insert({
    user_id: userId,
    modulo,
    model,
    prompt_tokens: usage.promptTokens,
    output_tokens: usage.outputTokens,
    search,
  });
  if (logErr) console.error("ia_usage insert:", logErr.message);

  return json({ text, sources, usage, model }, 200, origin);
});
