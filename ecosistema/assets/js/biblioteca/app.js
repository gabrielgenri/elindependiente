/* Biblioteca riojana · fichas explicativas atemporales. */

import { $, esc, isHttp, slugify, toast, download } from '../core/utils.js';
import { DEPARTAMENTOS } from '../core/config.js';
import {
    ctx, loadCfg, initSupabase, refreshSession, onChange,
    isRemote, needsLogin, isEditorial, role, login, magicLink, logout
} from '../core/auth.js';
import { callIA } from '../core/ia.js';
import { listPiezas } from '../core/storage.js';
import { GUIA_ESTILO_INDEPENDIENTE } from '../core/estilo.js';
import { OBJ, parseModelJSON } from '../madre/formatos.js';
import { persistFicha, listFichas, getFicha, removeFicha } from './storage.js';
import {
    CATEGORIAS, CHECKLIST_BASE, nuevaFicha, puedeCambiarEstado, coincide,
    fichaToText, fichaToWordHtml
} from './fichas.js';

const state = { ficha: null, piezas: [], saveTimer: null, busy: false };

/* ---------- Pantallas ---------- */
function showView(name) {
    for (const v of ['auth', 'lista', 'editor']) $('view-' + v).classList.toggle('hidden', v !== name);
    $('btn-nueva').classList.toggle('hidden', name === 'auth');
    if (name === 'lista') renderLista();
}

function refreshChrome() {
    const email = ctx.session?.user?.email || '';
    $('user-badge').textContent = email ? `${email}${role() ? ' · ' + role() : ''}` : '';
    $('user-badge').classList.toggle('hidden', !email);
    $('btn-logout').classList.toggle('hidden', !email);
    $('mode-banner').textContent = isRemote()
        ? 'Fichas compartidas del equipo (Supabase).'
        : ctx.sb
            ? 'Sin sesión: las fichas se guardan solo en este dispositivo.'
            : 'Sin conexión configurada: las fichas se guardan solo en este dispositivo. Configurá Supabase desde Madre → Ajustes.';
}

function setBusy(on, text = '') {
    state.busy = on;
    $('btn-ia').disabled = on;
    $('loading').classList.toggle('hidden', !on);
    $('loading-text').textContent = text;
}

const setSaveState = (m) => { $('save-state').textContent = m; };

/* ---------- Autoguardado ---------- */
async function saveNow() {
    clearTimeout(state.saveTimer);
    await persistFicha(state.ficha);
    setSaveState('Guardado ✓ ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }));
}

function queueSave() {
    if (!state.ficha) return;
    setSaveState('Guardando…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
        try { await saveNow(); }
        catch (e) { setSaveState('Error al guardar'); toast('No se pudo guardar: ' + e.message); }
    }, 800);
}

/* ---------- Lista ---------- */
async function renderLista() {
    const box = $('fichas-list');
    box.innerHTML = '<p class="text-xs font-mono text-swiss-500 p-4">Cargando…</p>';
    let list = [];
    try { list = await listFichas(); }
    catch (e) { box.innerHTML = `<p class="text-sm text-red-600 p-4">${esc(e.message)}</p>`; return; }
    $('f-count').textContent = list.length ? `(${list.length})` : '';
    const est = $('f-estado').value;
    const q = $('f-buscar').value;
    list = list.filter((f) => (!est || f.estado === est) && coincide(f, q));

    if (!list.length) {
        box.innerHTML = `<div class="bg-white border border-swiss-200 rounded-2xl p-8 text-center space-y-1">
            <p class="text-swiss-500 text-xs font-mono">No hay fichas${est || q ? ' con esos filtros' : ''}.</p>
            <p class="text-sm">Creá una con “+ Nueva ficha”.</p></div>`;
        return;
    }
    const badge = { borrador: 'bg-swiss-100 text-swiss-700', revisado: 'bg-amber-100 text-amber-800', publicado: 'bg-emerald-100 text-emerald-800' };
    box.innerHTML = list.map((f) => `
        <button data-open="${esc(f.id)}" class="w-full text-left bg-white border border-swiss-200 hover:border-black rounded-xl p-4 shadow-sm min-h-[44px]">
            <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[10px] font-medium px-2 py-0.5 rounded-full ${badge[f.estado] || badge.borrador}">${esc(f.estado)}</span>
                <span class="text-[10px] text-swiss-500">${esc(f.categoria || '')}</span>
                ${f.departamento ? `<span class="text-[10px] text-swiss-500">· ${esc(f.departamento)}</span>` : ''}
                ${(f.piezas || []).length ? `<span class="text-[10px] text-swiss-500">· ${(f.piezas || []).length} producción(es)</span>` : ''}
            </div>
            <h3 class="font-serif font-bold text-base mt-1">${esc(f.titulo || 'Sin título')}</h3>
            ${f.resumen ? `<p class="text-xs text-swiss-600 mt-1 line-clamp-2">${esc(f.resumen)}</p>` : ''}
        </button>`).join('');
}

/* ---------- Editor ---------- */
async function abrir(f) {
    state.ficha = f;
    $('ed-titulo').value = f.titulo || '';
    $('ed-categoria').value = f.categoria || CATEGORIAS[0];
    $('ed-dep').value = f.departamento || '';
    $('ed-resumen').value = f.resumen || '';
    $('ed-contenido').value = f.contenido || '';
    $('ed-fuentes').value = f.fuentes || '';
    setSaveState('');
    renderEstado(); renderChecklist();
    showView('editor');
    $('rel-buscar').value = '';
    try { state.piezas = await listPiezas(); } catch { state.piezas = []; }
    renderRel();
}

async function nueva() {
    const f = nuevaFicha();
    await abrir(f);
    $('ed-titulo').focus();
}

function renderEstado() {
    const cur = state.ficha?.estado || 'borrador';
    $('estado-group').innerHTML = [['borrador', 'Borrador'], ['revisado', 'Revisado'], ['publicado', 'Publicado']].map(([k, l]) => `
        <button data-estado="${k}" aria-pressed="${k === cur}" class="text-xs font-medium px-3 py-2 rounded-full min-h-[44px] border ${k === cur ? 'bg-black text-white border-black' : 'bg-white text-swiss-700 border-swiss-300 hover:border-black'}">${l}</button>`).join('');
}

function setEstado(nuevo) {
    const f = state.ficha;
    if (!f || f.estado === nuevo) return;
    const r = puedeCambiarEstado(f, nuevo, { esEditorial: isEditorial(), remoto: isRemote() });
    if (!r.ok) return toast(r.motivo);
    f.estado = nuevo;
    renderEstado();
    queueSave();
}

function renderChecklist() {
    const list = state.ficha?.verificacion || [];
    $('checklist').innerHTML = list.length ? list.map((v, i) => `
        <li class="flex items-start gap-2">
            <label class="flex-1 flex items-start gap-3 text-xs text-swiss-800 cursor-pointer py-2 min-h-[44px]">
                <input type="checkbox" data-check="${i}" ${v.ok ? 'checked' : ''} class="mt-0.5 w-4 h-4 rounded border-swiss-300 text-black focus:ring-black shrink-0">
                <span class="${v.ok ? 'line-through text-swiss-400' : ''}">${esc(v.texto)}</span>
            </label>
            <button data-chk-del="${i}" aria-label="Quitar punto" class="text-swiss-400 hover:text-red-600 text-lg leading-none px-2 min-h-[44px]">×</button>
        </li>`).join('') : '<li class="text-xs text-swiss-500">Sin puntos de verificación. Agregá al menos uno.</li>';
}

function bajarDeEstadoSiHaceFalta(motivo) {
    const f = state.ficha;
    if (f.estado !== 'borrador') {
        f.estado = 'borrador';
        renderEstado();
        toast(motivo);
    }
}

function renderRel() {
    const f = state.ficha;
    if (!f) return;
    const q = $('rel-buscar').value.trim().toLowerCase();
    const sel = new Set(f.piezas || []);
    $('rel-count').textContent = sel.size ? `(${sel.size} seleccionada${sel.size > 1 ? 's' : ''})` : '';
    const conocidos = new Set(state.piezas.map((p) => p.id));
    const huerfanas = [...sel].filter((id) => !conocidos.has(id));
    const items = state.piezas.filter((p) => !q || String(p.titulo || '').toLowerCase().includes(q));
    const li = (id, titulo, extra = '') => `
        <li><label class="flex items-start gap-3 text-xs text-swiss-800 cursor-pointer py-2 min-h-[44px]">
            <input type="checkbox" data-rel="${esc(id)}" ${sel.has(id) ? 'checked' : ''} class="mt-0.5 w-4 h-4 rounded border-swiss-300 text-black focus:ring-black shrink-0">
            <span>${esc(titulo)}${extra}</span></label></li>`;
    $('rel-list').innerHTML = (items.length || huerfanas.length)
        ? items.map((p) => li(p.id, p.titulo || 'Sin título', ` <span class="text-swiss-400">· ${esc(p.estado || '')}</span>`)).join('') +
          huerfanas.map((id) => li(id, '(producción no disponible)')).join('')
        : '<li class="text-xs text-swiss-500 py-2">No hay producciones para relacionar todavía.</li>';
}

/* ---------- Borrador asistido ---------- */
async function redactarIA() {
    const f = state.ficha;
    if (!f || state.busy) return;
    const titulo = f.titulo.trim();
    if (!titulo) return toast('Escribí primero el título de la ficha.');
    if (!isRemote()) return toast('El borrador asistido requiere conexión y sesión iniciada.');
    if (f.contenido.trim() && !confirm('Se reemplazarán el resumen y el contenido actuales. ¿Continuar?')) return;

    const ctxTxt = `FICHA: ${titulo}\nCATEGORÍA: ${f.categoria}\nDEPARTAMENTO: ${f.departamento || 'Toda la provincia'}`;
    setBusy(true, 'Investigando el tema…');
    try {
        let informe = '';
        let fuentes = [];
        if ($('ia-search').checked) {
            const r = await callIA({
                system: `Sos el investigador de la Biblioteca riojana de El Independiente (La Rioja, Argentina). Buscá información verificable y estable sobre el tema. Devolvé un informe de hasta 500 palabras con: DATOS DUROS (cada uno con su fuente), CONTEXTO HISTÓRICO, TÉRMINOS Y NOMBRES OFICIALES y NO CONFIRMADO. No inventes datos: si no encontrás algo, decilo.`,
                prompt: ctxTxt, search: true, temperature: 0.3, modulo: 'biblioteca-investigacion'
            });
            informe = r.text;
            fuentes = r.sources || [];
        }

        setBusy(true, 'Redactando el borrador…');
        const STR = { type: 'STRING' };
        const r2 = await callIA({
            system: `Sos redactor de la Biblioteca riojana de El Independiente (La Rioja, Argentina). Escribís fichas explicativas ATEMPORALES, en español rioplatense neutro: explican qué es algo, su origen, su contexto y por qué importa, sin depender de la actualidad.
REGLAS INNEGOCIABLES:
1. Usá solo datos presentes en la INVESTIGACIÓN o ampliamente establecidos. Nunca inventes fechas, cifras, nombres, citas ni fuentes.
2. Todo dato dudoso o sin respaldo va con la marca [VERIFICAR].
3. Evitá referencias temporales relativas ("hoy", "este año", "recientemente", "actualmente"); usá fechas absolutas cuando hagan falta.
4. resumen: hasta 300 caracteres. contenido: 300 a 600 palabras, con subtítulos "## ".
5. En "verificacion" listá entre 3 y 6 datos puntuales que el periodista debe contrastar.

${GUIA_ESTILO_INDEPENDIENTE}`,
            prompt: `${ctxTxt}\n\nINVESTIGACIÓN:\n${informe || '(sin investigación: usá solo conocimiento ampliamente establecido y marcá lo dudoso)'}`,
            schema: OBJ({ resumen: STR, contenido: STR, verificacion: { type: 'ARRAY', items: STR } }),
            temperature: 0.6, modulo: 'biblioteca'
        });
        const est = parseModelJSON(r2.text);
        f.resumen = String(est.resumen || '').slice(0, 600);
        f.contenido = String(est.contenido || '');
        const srcLines = fuentes.filter((s) => isHttp(s.uri)).map((s) => `${s.title || s.uri} — ${s.uri}`);
        if (srcLines.length) {
            f.fuentes = [f.fuentes.trim(), 'Consultadas por la IA (contrastar antes de citar):', ...srcLines].filter(Boolean).join('\n');
        }
        const extra = (est.verificacion || []).map((t) => String(t)).filter((t) => !f.verificacion.some((v) => v.texto === t));
        f.verificacion = [...CHECKLIST_BASE.map((texto) => ({ texto, ok: false })), ...extra.map((texto) => ({ texto, ok: false }))];
        f.estado = 'borrador';
        $('ed-resumen').value = f.resumen;
        $('ed-contenido').value = f.contenido;
        $('ed-fuentes').value = f.fuentes;
        renderEstado(); renderChecklist();
        queueSave();
        toast('Borrador listo. Revisalo y verificá cada dato.');
    } catch (e) {
        toast(e.message || 'No se pudo redactar el borrador.');
    } finally {
        setBusy(false);
    }
}

/* ---------- Acciones y exportaciones ---------- */
const titulosMap = () => Object.fromEntries(state.piezas.map((p) => [p.id, p.titulo || 'Sin título']));

async function handleAction(act) {
    const f = state.ficha;
    if (!f) return;
    const base = slugify(f.titulo || 'ficha');
    if (act === 'export-txt') { download(`${base}.txt`, fichaToText(f, titulosMap()), 'text/plain;charset=utf-8'); toast('.txt descargado.'); }
    else if (act === 'export-doc') { download(`${base}.doc`, fichaToWordHtml(f, titulosMap()), 'application/msword'); toast('Documento Word descargado.'); }
    else if (act === 'export-json') { download(`${base}.json`, JSON.stringify(f, null, 2), 'application/json'); toast('JSON descargado.'); }
    else if (act === 'delete') {
        if (!confirm('¿Eliminar esta ficha? No se puede deshacer.')) return;
        try {
            clearTimeout(state.saveTimer);
            await removeFicha(f.id);
            state.ficha = null;
            toast('Ficha eliminada.');
            showView('lista');
        } catch (e) { toast(e.message); }
    }
}

/* ---------- Acceso ---------- */
async function doLogin() {
    const email = $('auth-email').value.trim();
    const password = $('auth-pass').value;
    if (!email || !password) return toast('Completá correo y contraseña.');
    const { error } = await login(email, password);
    if (error) return toast('No se pudo ingresar: ' + error.message);
    $('auth-pass').value = '';
    refreshChrome();
    showView('lista');
}

async function doMagic() {
    const email = $('auth-email').value.trim();
    if (!email) return toast('Ingresá tu correo.');
    const { error } = await magicLink(email);
    toast(error ? 'No se pudo enviar el enlace: ' + error.message : 'Te enviamos un enlace de acceso. Revisá tu correo.');
}

/* ---------- Inicio ---------- */
async function init() {
    $('ed-categoria').innerHTML = CATEGORIAS.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('ed-dep').innerHTML = '<option value="">Toda la provincia</option>' +
        DEPARTAMENTOS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');

    loadCfg();
    initSupabase();
    await refreshSession();
    onChange(refreshChrome);
    refreshChrome();

    $('btn-login').addEventListener('click', doLogin);
    $('btn-magic').addEventListener('click', doMagic);
    $('auth-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $('btn-logout').addEventListener('click', async () => { await logout(); state.ficha = null; refreshChrome(); showView(needsLogin() ? 'auth' : 'lista'); });
    $('btn-nueva').addEventListener('click', nueva);
    $('btn-volver').addEventListener('click', async () => {
        if (state.ficha) { try { await saveNow(); } catch { /* ya se avisó */ } }
        state.ficha = null;
        showView('lista');
    });
    $('btn-ia').addEventListener('click', redactarIA);
    $('f-buscar').addEventListener('input', renderLista);
    $('f-estado').addEventListener('change', renderLista);
    $('fichas-list').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-open]');
        if (!b) return;
        const f = await getFicha(b.dataset.open);
        if (f) abrir(f); else toast('No se encontró la ficha.');
    });

    const campos = { 'ed-titulo': 'titulo', 'ed-categoria': 'categoria', 'ed-dep': 'departamento', 'ed-resumen': 'resumen', 'ed-contenido': 'contenido', 'ed-fuentes': 'fuentes' };
    for (const [id, campo] of Object.entries(campos)) {
        $(id).addEventListener('input', () => {
            if (!state.ficha) return;
            state.ficha[campo] = $(id).value;
            // Si una ficha ya revisada vuelve a tener marcas [VERIFICAR], se baja a borrador.
            if ((campo === 'contenido' || campo === 'resumen' || campo === 'titulo') && state.ficha.estado !== 'borrador' && /\[VERIFICAR\]/i.test($(id).value)) {
                bajarDeEstadoSiHaceFalta('Volvió a borrador: el texto tiene marcas [VERIFICAR].');
            }
            queueSave();
        });
    }

    $('estado-group').addEventListener('click', (e) => {
        const b = e.target.closest('[data-estado]');
        if (b) setEstado(b.dataset.estado);
    });
    $('checklist').addEventListener('click', (e) => {
        const del = e.target.closest('[data-chk-del]');
        if (!del || !state.ficha) return;
        state.ficha.verificacion.splice(Number(del.dataset.chkDel), 1);
        renderChecklist(); queueSave();
    });
    $('checklist').addEventListener('change', (e) => {
        const i = e.target.dataset.check;
        if (i === undefined || !state.ficha) return;
        state.ficha.verificacion[Number(i)].ok = e.target.checked;
        if (!e.target.checked) bajarDeEstadoSiHaceFalta('Volvió a borrador: hay datos sin verificar.');
        renderChecklist(); queueSave();
    });
    const agregarChk = () => {
        const t = $('chk-nuevo').value.trim();
        if (!t || !state.ficha) return;
        state.ficha.verificacion.push({ texto: t, ok: false });
        $('chk-nuevo').value = '';
        bajarDeEstadoSiHaceFalta('Volvió a borrador: se agregó un punto sin verificar.');
        renderChecklist(); queueSave();
    };
    $('btn-chk-add').addEventListener('click', agregarChk);
    $('chk-nuevo').addEventListener('keydown', (e) => { if (e.key === 'Enter') agregarChk(); });

    $('rel-buscar').addEventListener('input', renderRel);
    $('rel-list').addEventListener('change', (e) => {
        const id = e.target.dataset.rel;
        if (!id || !state.ficha) return;
        const s = new Set(state.ficha.piezas || []);
        if (e.target.checked) s.add(id); else s.delete(id);
        state.ficha.piezas = [...s];
        renderRel(); queueSave();
    });
    document.querySelectorAll('.act').forEach((b) => b.addEventListener('click', () => handleAction(b.dataset.act)));

    showView(needsLogin() ? 'auth' : 'lista');
}

document.addEventListener('DOMContentLoaded', init);
