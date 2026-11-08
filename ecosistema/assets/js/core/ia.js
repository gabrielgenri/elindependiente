/* Todas las llamadas a servicios externos (Gemini, WordPress) pasan por Edge Functions
   de Supabase con el JWT del usuario. Ninguna credencial privada vive en el navegador. */

import { ctx } from './auth.js';
import { DEFAULT_MODEL, FN_MADRE_AI } from './config.js';

export async function callFunction(name, body) {
    if (!ctx.sb) throw new Error('Configurá la conexión con Supabase en Ajustes.');
    const { data } = await ctx.sb.auth.getSession();
    const session = data?.session;
    if (!session) throw new Error('Iniciá sesión para usar esta función.');

    const res = await fetch(`${ctx.cfg.url.replace(/\/+$/, '')}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': ctx.cfg.anon
        },
        body: JSON.stringify(body)
    });
    let out = {};
    try { out = await res.json(); } catch { /* sin cuerpo */ }
    if (!res.ok) throw new Error(out.error || `Error ${res.status} al llamar a ${name}`);
    return out;
}

export function callIA({ prompt, system, schema = null, search = false, temperature = 0.7, modulo = 'madre' }) {
    return callFunction('ia-proxy', {
        model: ctx.cfg.model || DEFAULT_MODEL,
        systemInstruction: system, prompt, schema, search, temperature, modulo
    });
}

/** Transcripción: acción "transcribe" de la Edge Function madre-ai. Devuelve { texto }. */
export const transcribirAudio = (mimeType, base64, archivo = null) =>
    callFunction(FN_MADRE_AI, { action: 'transcribe', mimeType, base64, origen: 'madre', archivo });

/** Borrador en WordPress: acción "wp_draft" de madre-ai (siempre status draft en el servidor).
    El servidor exige revisadoHumano === true y rol editor o director. */
export const enviarBorradorWP = ({ titulo, contenido_html, excerpt, slug }) =>
    callFunction(FN_MADRE_AI, { action: 'wp_draft', revisadoHumano: true, titulo, contenido_html, excerpt, slug });
