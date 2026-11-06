// Madre V3 · Proxy de IA (Supabase Edge Function, Deno)
// Las claves viven como secrets del servidor; el navegador nunca las ve.
//
// Secrets requeridos:
//   GEMINI_API_KEY
//   GEMINI_MODEL        (opcional, predeterminado gemini-3.8-flash)
//   WP_URL              (ej: https://eldiario.com.ar)
//   WP_USER             (usuario de WordPress)
//   WP_APP_PASSWORD     (Application Password de WordPress)
//
// Deploy: supabase functions deploy madre-ai
// verify_jwt queda activo: solo usuarios autenticados de la redacción pueden llamarla.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://gabrielgenri.github.io,http://localhost:5500,http://127.0.0.1:5500")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const corsHeaders = (origin: string | null) => ({
  ...(origin && ALLOWED_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
const KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const RATE_LIMIT = Number(Deno.env.get("RATE_LIMIT_PER_HOUR") ?? "60");

const json = (data: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" } });

async function gemini(path: string, body: unknown) {
  const r = await fetch(`${GEMINI}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  return r.json();
}

const textOf = (res: any) => res?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// PCM 16-bit mono 24kHz -> WAV
function pcmToWav(pcm: Uint8Array, sampleRate = 24000) {
  const h = new ArrayBuffer(44);
  const v = new DataView(h);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(h), 0); out.set(pcm, 44);
  return out;
}

const SYSTEM_EDITORIAL = (tono: string, departamento: string) => `Eres el motor editorial del diario "El Independiente" de La Rioja, Argentina.
A partir del hecho o titular recibido, produce EXACTAMENTE 6 formatos en español rioplatense neutro, tono: ${tono}. El enfoque territorial solicitado es ${departamento}; no atribuyas el hecho a ese lugar salvo que el material lo respalde.
Reglas: no inventes datos, cifras, citas ni nombres; si falta información, indícalo con [VERIFICAR].
Devuelve SOLO JSON válido con esta forma:
{
 "articulo": {"titular":"","slug":"","palabras_clave":[""],"meta_descripcion":"","cuerpo":""},
 "reel": "guion de 60s con marcas de tiempo",
 "podcast": "guion hablado: intro, desarrollo, cierre (solo texto a locutar, sin acotaciones entre corchetes)",
 "carrusel": [{"titulo":"","texto":"","prompt_imagen":""}],
 "newsletter": {"asunto":"","cuerpo":""},
 "whatsapp": ""
}
El carrusel debe tener 8 placas, desde portada hasta llamada a la acción.`;

const SYSTEM_CRITIC = `Eres un editor crítico senior de un diario argentino. Evalúas un paquete de contenidos ANTES de la revisión humana.
Puntúa de 0 a 10 (10 = excelente / sin riesgo) y justifica brevemente:
- sesgo (equilibrio, adjetivación, fuentes de ambos lados)
- claridad (estructura, jerga, titular fiel al cuerpo)
- riesgo_legal (injurias y calumnias, presunción de inocencia, datos personales, menores, derechos de autor, afirmaciones sin sustento)
Marca afirmaciones no verificables y sugiere correcciones concretas. Eres un asistente: la decisión final es del editor humano.
Devuelve SOLO JSON:
{"sesgo":{"puntaje":0,"comentario":""},"claridad":{"puntaje":0,"comentario":""},"riesgo_legal":{"puntaje":0,"comentario":""},
 "afirmaciones_a_verificar":[""],"correcciones_sugeridas":[""],"veredicto":"publicable|requiere_cambios|no_publicar"}`;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response("Origen no permitido", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405, origin);
  try {
    if (!KEY) return json({ error: "Falta el secret GEMINI_API_KEY" }, 500, origin);
    const { action, ...p } = await req.json();

    // Cliente con el JWT del usuario (respeta RLS) y cliente admin para Storage
    const authHeader = req.headers.get("Authorization") ?? "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sesión requerida" }, 401, origin);
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Sesión inválida o vencida" }, 401, origin);

    if (action !== "wp_draft") {
      const since = new Date(Date.now() - 3_600_000).toISOString();
      const { count, error: usageError } = await admin.from("ia_usage")
        .select("id", { count: "exact", head: true })
        .eq("user_id", authData.user.id).gte("created_at", since);
      if (usageError) return json({ error: "No se pudo verificar el límite de uso" }, 502, origin);
      if ((count ?? 0) >= RATE_LIMIT) {
        return json({ error: "Alcanzaste el límite horario de uso. Probá más tarde." }, 429, origin);
      }
      const { error: logError } = await admin.from("ia_usage").insert({
        user_id: authData.user.id,
        modulo: "madre",
        model: MODEL,
        search: action === "generate" && p.search === true,
      });
      if (logError) return json({ error: "No se pudo registrar el uso de IA" }, 502, origin);
    }

    switch (action) {
      case "generate": {
        const body: any = {
          systemInstruction: { parts: [{ text: SYSTEM_EDITORIAL(p.tono ?? "informativo", p.departamento ?? "La Rioja (provincia)") }] },
          contents: [{ parts: [{ text: `Hecho o titular: "${p.tema}"\nEnfoque territorial solicitado: ${p.departamento ?? "La Rioja (provincia)"}${p.contexto ? `\n\nContexto del archivo histórico:\n${p.contexto}` : ""}` }] }],
        };
        if (p.search) body.tools = [{ google_search: {} }];
        else body.generationConfig = { responseMimeType: "application/json" };
        const res = await gemini(`models/${MODEL}:generateContent`, body);
        const t = textOf(res);
        const raw = t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
        const sources = (res?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
          .map((c: any) => c.web).filter(Boolean);
        return json({ data: JSON.parse(raw), sources }, 200, origin);
      }

      case "critic": {
        const res = await gemini(`models/${MODEL}:generateContent`, {
          systemInstruction: { parts: [{ text: SYSTEM_CRITIC }] },
          contents: [{ parts: [{ text: JSON.stringify(p.paquete).slice(0, 60000) }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
        });
        return json({ data: JSON.parse(textOf(res)) }, 200, origin);
      }

      case "embed": {
        // p.texts: string[]  ·  p.task: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
        const res = await gemini(`models/gemini-embedding-001:batchEmbedContents`, {
          requests: p.texts.map((t: string) => ({
            model: "models/gemini-embedding-001",
            content: { parts: [{ text: t.slice(0, 8000) }] },
            taskType: p.task ?? "RETRIEVAL_DOCUMENT",
            outputDimensionality: 768,
          })),
        });
        return json({ embeddings: res.embeddings.map((e: any) => e.values) }, 200, origin);
      }

      case "search": {
        const emb = await gemini(`models/gemini-embedding-001:embedContent`, {
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: p.query }] },
          taskType: "RETRIEVAL_QUERY",
          outputDimensionality: 768,
        });
        const { data, error } = await asUser.rpc("match_notas", {
          query_embedding: emb.embedding.values,
          match_count: p.count ?? 8,
          min_similarity: p.min ?? 0.3,
        });
        if (error) throw error;
        return json({ results: data }, 200, origin);
      }

      case "tts": {
        const voice = p.voice ?? "Kore";
        const ttsModel = Deno.env.get("GEMINI_TTS_MODEL") ?? "gemini-3.8-flash-tts";
        const res = await gemini(`models/${ttsModel}:generateContent`, {
          contents: [{ parts: [{ text: `Lee con tono de locutor de radio, claro y cálido:\n${p.text.slice(0, 5000)}` }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        });
        const b64 = res?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!b64) throw new Error("La IA no devolvió audio");
        const wav = pcmToWav(b64ToBytes(b64));
        const path = `${p.produccionId ?? "suelto"}/${Date.now()}.wav`;
        const up = await admin.storage.from("podcasts").upload(path, wav, { contentType: "audio/wav" });
        if (up.error) throw up.error;
        const signed = await admin.storage.from("podcasts").createSignedUrl(path, 3600);
        if (p.produccionId) await admin.from("producciones").update({ audio_path: path }).eq("id", p.produccionId);
        return json({ path, url: signed.data?.signedUrl }, 200, origin);
      }

      case "transcribe": {
        // p.base64, p.mimeType (audio/mpeg, audio/ogg, audio/wav, audio/mp4...)
        if (typeof p.base64 !== "string" || p.base64.length > 20_000_000) {
          return json({ error: "Audio inválido o superior al límite de 15 MB" }, 413, origin);
        }
        const res = await gemini(`models/${MODEL}:generateContent`, {
          contents: [{
            parts: [
              { text: "Transcribe fielmente este audio en español. Indica cambios de hablante como 'Hablante 1:', 'Hablante 2:'. Marca [inaudible] donde corresponda. No resumas ni corrijas el contenido." },
              { inlineData: { mimeType: p.mimeType, data: p.base64 } },
            ],
          }],
        });
        const texto = textOf(res);
        await asUser.from("transcripciones").insert({ origen: p.origen ?? "entrevista", archivo: p.archivo ?? null, texto });
        return json({ texto }, 200, origin);
      }

      case "wp_draft": {
        if (p.revisadoHumano !== true) {
          return json({ error: "Confirma la revisión humana antes de crear el borrador" }, 400, origin);
        }
        const { data: rol, error: roleError } = await asUser.rpc("rol_actual");
        if (roleError) return json({ error: "No se pudo comprobar el rol editorial" }, 502, origin);
        if (rol !== "editor" && rol !== "director") {
          return json({ error: "Solo un editor o el director puede enviar borradores a WordPress" }, 403, origin);
        }
        const base = Deno.env.get("WP_URL"), user = Deno.env.get("WP_USER"), pass = Deno.env.get("WP_APP_PASSWORD");
        if (!base || !user || !pass) return json({ error: "Faltan secrets WP_URL, WP_USER o WP_APP_PASSWORD" }, 500, origin);
        const r = await fetch(`${base.replace(/\/$/, "")}/wp-json/wp/v2/posts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Basic " + btoa(`${user}:${pass}`) },
          body: JSON.stringify({
            title: p.titulo,
            content: p.contenido_html,
            excerpt: p.excerpt ?? "",
            slug: p.slug ?? undefined,
            status: "draft", // SIEMPRE borrador: la publicación la decide un humano
          }),
        });
        const out = await r.json();
        if (!r.ok) return json({ error: out?.message ?? "Error de WordPress" }, r.status, origin);
        if (p.produccionId) await admin.from("producciones").update({ wp_post_id: out.id, estado: "en_revision" }).eq("id", p.produccionId);
        return json({ id: out.id, edit_url: `${base.replace(/\/$/, "")}/wp-admin/post.php?post=${out.id}&action=edit`, link: out.link }, 200, origin);
      }

      default:
        return json({ error: `Acción desconocida: ${action}` }, 400, origin);
    }
  } catch (e) {
    console.error("madre-ai:", e instanceof Error ? e.message : "error");
    return json({ error: "La operación no pudo completarse. Revisa los registros de la función." }, 500, origin);
  }
});
