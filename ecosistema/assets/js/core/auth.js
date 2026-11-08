/* Conexión con Supabase y sesión. Estado compartido en `ctx`.
   Usa la librería UMD cargada por <script> (window.supabase). */

import { KEY, ROLES_EDITORIALES } from './config.js';
import { loadJSON, saveJSON } from './utils.js';

export const ctx = { cfg: {}, sb: null, session: null, profile: null };

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); };
const emit = () => listeners.forEach((fn) => fn(ctx));

export function loadCfg() {
    ctx.cfg = loadJSON(KEY.cfg, {});
    // Limpieza del modo desarrollo anterior: las keys de Gemini ya no viven en el navegador.
    try { sessionStorage.removeItem(KEY.legacyDevKey); } catch { /* no disponible */ }
}

export function saveCfg(cfg) {
    ctx.cfg = cfg;
    saveJSON(KEY.cfg, cfg);
}

let authSub = null;

export function initSupabase() {
    authSub?.data?.subscription?.unsubscribe?.();
    authSub = null;
    ctx.sb = null;
    const { url, anon } = ctx.cfg;
    if (url && anon && window.supabase) {
        ctx.sb = window.supabase.createClient(url.replace(/\/+$/, ''), anon);
        authSub = ctx.sb.auth.onAuthStateChange((_ev, session) => {
            ctx.session = session;
            // No se hacen consultas dentro del callback (evita bloqueos de supabase-js).
            setTimeout(async () => { await loadProfile(); emit(); }, 0);
        });
    }
}

async function loadProfile() {
    ctx.profile = null;
    const user = ctx.session?.user;
    if (!ctx.sb || !user) return;
    // La columna real es "rol"; se expone como { role } al resto de la app.
    const { data } = await ctx.sb.from('profiles').select('rol,email').eq('id', user.id).maybeSingle();
    ctx.profile = data ? { role: data.rol, email: data.email } : null;
}

export async function refreshSession() {
    if (!ctx.sb) { ctx.session = null; ctx.profile = null; return; }
    const { data } = await ctx.sb.auth.getSession();
    ctx.session = data?.session || null;
    await loadProfile();
}

export const isRemote = () => !!ctx.sb && !!ctx.session;
export const needsLogin = () => !!ctx.sb && !ctx.session;
export const role = () => ctx.profile?.role || null;
export const isEditorial = () => ROLES_EDITORIALES.includes(role());

export async function login(email, password) {
    if (!ctx.sb) return { error: { message: 'Configurá la conexión en Ajustes.' } };
    const r = await ctx.sb.auth.signInWithPassword({ email, password });
    if (!r.error) { await refreshSession(); emit(); }
    return r;
}

export async function magicLink(email) {
    if (!ctx.sb) return { error: { message: 'Configurá la conexión en Ajustes.' } };
    return ctx.sb.auth.signInWithOtp({
        email, options: { emailRedirectTo: location.origin + location.pathname }
    });
}

export async function logout() {
    if (ctx.sb) await ctx.sb.auth.signOut();
    ctx.session = null;
    ctx.profile = null;
    emit();
}
