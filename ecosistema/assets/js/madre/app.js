/* Madre v2.1 · Módulo de contenido madre (Eje 3). */

import {
    $, esc, isHttp, loadJSON, saveJSON, slugify, toast, download, copyText, fileToBase64
} from '../core/utils.js';
import {
    KEY, EJE_MADRE, DEPARTAMENTOS, MAX_AUDIO_BYTES, AUDIO_MIMES
} from '../core/config.js';
import {
    ctx, loadCfg, saveCfg, initSupabase, refreshSession, onChange,
    isRemote, needsLogin, isEditorial, role, login, magicLink, logout
} from '../core/auth.js';
import { callIA, transcribirAudio, enviarBorradorWP } from '../core/ia.js';
import { persist, listPiezas, getPieza, removePieza, marcarBorradorWP } from '../core/storage.js';
import { cuerpoAHtml, esc as escHtml } from '../core/html.js';
import { GUIA_ESTILO_INDEPENDIENTE } from '../core/estilo.js';
import {
    FORMATS, FORMAT_KEYS, FULL_SCHEMA, OBJ, parseModelJSON, parseArticuloTexto,
    hasVerificar, allText, jsonLd
} from './formatos.js';

const state = { pieza: null, tab: 'articulo', busy: false, saveTimer: null };

/* ---------- Prompts ---------- */
const extraStyle = () => (localStorage.getItem(KEY.style) || '').trim();

const SYS_INVESTIGACION = `Sos el investigador de la redacción de El Independiente, diario de La Rioja, Argentina.
Buscá información actual y verificable sobre el hecho indicado. Devolvé un informe en español de hasta 500 palabras con estas secciones: CONTEXTO, DATOS DUROS (cada uno con su fuente), ANTECEDENTES, ACTORES INVOLUCRADOS y NO CONFIRMADO (lo que no pudiste verificar). No redactes la nota ni inventes datos: si no encontrás algo, decilo.`;

function sysEditorial(tono) {
    const extra = extraStyle();
    return `Sos el motor editorial de El Independiente, diario de La Rioja, Argentina. Escribís en español rioplatense neutro, con rigor periodístico y sin sensacionalismo.
REGLAS INNEGOCIABLES:
1. Usá únicamente datos presentes en el HECHO o en la INVESTIGACIÓN. Nunca inventes citas textuales, cifras, nombres, cargos ni fechas.
2. Si un dato es dudoso o no está respaldado, escribilo con la marca [VERIFICAR].
3. Priorizá el contexto riojano y el departamento indicado.
4. En "verificacion" listá entre 3 y 8 datos puntuales (cifras, nombres, fechas, declaraciones) que el periodista debe chequear antes de publicar. Incluí allí también los puntos de la guía de estilo que requieran decisión humana (por ejemplo: respuesta de la parte aludida, etapa procesal real, datos que identifiquen a menores).
5. Tono pedido: ${tono}. Si el tono pedido contradice la guía de estilo, prevalece la guía.
6. Aplicá la siguiente guía de estilo institucional en TODOS los formatos. Prevalece sobre cualquier otra preferencia de estilo.

${GUIA_ESTILO_INDEPENDIENTE}
${extra ? `\nINSTRUCCIONES ADICIONALES DE LA REDACCIÓN (complementan la guía, nunca la contradicen):\n${extra}\n` : ''}`;
}

const contextoPrompt = (hecho, meta) =>
    `HECHO O TITULAR:\n${hecho}\n\nDEPARTAMENTO: ${meta.departamento || 'No especificado'}`;

/* ---------- Estado de pantalla ---------- */
function setSaveState(msg) { $('save-state').textContent = msg; }

function setBusy(on, text = '') {
    state.busy = on;
    $('btn-generate').disabled = on;
    $('btn-transcribir').disabled = on;
    $('loading').classList.toggle('hidden', !on);
    $('loading-text').textContent = text;
}

function refreshChrome() {
    const email = ctx.session?.user?.email || '';
    $('user-badge').textContent = email ? `${email}${role() ? ' · ' + role() : ''}` : '';
    $('user-badge').classList.toggle('hidden', !email);
    $('btn-logout').classList.toggle('hidden', !email);
    $('hist-mode').textContent = isRemote()
        ? 'Piezas compartidas del equipo (Supabase).'
        : 'Piezas guardadas solo en este dispositivo (localStorage).';
    if (state.pieza) renderWp();
}

function showView(name) {
    for (const v of ['auth', 'motor', 'historial', 'ajustes']) {
        $('view-' + v).classList.toggle('hidden', v !== name);
    }
    document.querySelectorAll('.nav-btn').forEach((b) => {
        const on = b.dataset.view === name || (name === 'auth' && b.dataset.view === 'motor');
        b.className = 'nav-btn text-xs font-medium px-3 py-2 rounded-full min-h-[44px] ' +
            (on ? 'bg-black text-white' : 'text-swiss-700 hover:bg-swiss-100');
    });
    if (name === 'historial') renderHistory();
    if (name === 'ajustes') fillSettings();
}

/* ---------- Persistencia con autoguardado ---------- */
async function persistNow() {
    clearTimeout(state.saveTimer);
    await persist(state.pieza);
    setSaveState('Guardado ✓ ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }));
}

function queueSave() {
    if (!state.pieza) return;
    setSaveState('Guardando…');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
        try { await persistNow(); }
        catch (e) { setSaveState('Error al guardar'); toast('No se pudo guardar: ' + e.message); }
    }, 800);
}

async function restoreCurrent() {
    const id = localStorage.getItem(KEY.current);
    if (!id || state.pieza) return;
    try { const p = await getPieza(id); if (p) openPieza(p); } catch { /* se parte de cero */ }
}

/* ---------- Generación ---------- */
function metaFromForm() {
    return { tono: $('in-tono').value, eje: EJE_MADRE, departamento: $('in-dep').value };
}

async function generar() {
    if (state.busy) return;
    const hecho = $('in-hecho').value.trim();
    if (!hecho) return toast('Ingresá un hecho o titular.');
    if (hecho.length > 20000) return toast('El texto supera los 20.000 caracteres. Resumilo o dividilo.');
    if (!isRemote()) {
        showView(needsLogin() ? 'auth' : 'ajustes');
        return toast(needsLogin() ? 'Iniciá sesión para usar la IA.' : 'Configurá la conexión en Ajustes.');
    }
    const meta = metaFromForm();

    setBusy(true, 'Investigando el hecho…');
    try {
        let informe = '';
        let fuentes = [];
        if ($('in-search').checked) {
            const r = await callIA({
                system: SYS_INVESTIGACION, prompt: contextoPrompt(hecho, meta),
                search: true, temperature: 0.3, modulo: 'madre-investigacion'
            });
            informe = r.text;
            fuentes = r.sources || [];
        }

        setBusy(true, 'Redactando los 6 formatos…');
        const guias = Object.entries(FORMATS).map(([k, f]) => `- ${k}: ${f.guia}`).join('\n');
        const prompt = `${contextoPrompt(hecho, meta)}\n\nINVESTIGACIÓN:\n${informe || '(sin investigación: usá solo el hecho)'}\n\nGENERÁ TODOS LOS FORMATOS según estas guías:\n${guias}`;
        const r2 = await callIA({
            system: sysEditorial(meta.tono), prompt, schema: FULL_SCHEMA,
            temperature: 0.7, modulo: 'madre'
        });
        const est = parseModelJSON(r2.text);

        const now = new Date().toISOString();
        const p = {
            id: crypto.randomUUID(),
            titulo: (est.articulo?.titulo || hecho).slice(0, 140),
            hecho, ...meta, estado: 'borrador',
            formatos: {}, estructura: { ...est, _investigacion: informe },
            fuentes,
            verificacion: (est.verificacion || []).map((t) => ({ texto: String(t), ok: false })),
            created_at: now, updated_at: now
        };
        for (const k of FORMAT_KEYS) p.formatos[k] = FORMATS[k].render(est[k] || {});

        state.tab = 'articulo';
        openPieza(p);
        queueSave();
        toast('¡Formatos creados! Revisá y editá antes de publicar.');
        $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        toast(e.message || 'Error al generar.');
    } finally {
        setBusy(false);
    }
}

async function regenerar() {
    const p = state.pieza;
    if (!p || state.busy) return;
    const key = state.tab;
    if (!confirm(`Se reemplazará el texto actual de "${FORMATS[key].label}". ¿Continuar?`)) return;
    if (!isRemote()) return toast('Iniciá sesión para usar la IA.');
    setBusy(true, `Regenerando ${FORMATS[key].label}…`);
    try {
        const meta = { tono: p.tono, eje: p.eje, departamento: p.departamento };
        const prompt = `${contextoPrompt(p.hecho, meta)}\n\nINVESTIGACIÓN:\n${p.estructura?._investigacion || '(sin investigación)'}\n\nGenerá SOLO el formato "${key}" con un enfoque distinto al anterior. Guía: ${FORMATS[key].guia}`;
        const r = await callIA({
            system: sysEditorial(p.tono || 'informativo'), prompt,
            schema: OBJ({ [key]: FORMATS[key].schema }), temperature: 0.9, modulo: 'madre-regenerar'
        });
        const est = parseModelJSON(r.text);
        p.estructura[key] = est[key];
        p.formatos[key] = FORMATS[key].render(est[key] || {});
        renderEditor();
        renderWp();
        queueSave();
        toast('Formato regenerado.');
    } catch (e) {
        toast(e.message || 'No se pudo regenerar.');
    } finally {
        setBusy(false);
    }
}

/* ---------- Transcripción de audio ---------- */
function onAudioChange() {
    const f = $('in-audio').files[0];
    $('audio-name').textContent = f ? `${f.name} · ${(f.size / 1048576).toFixed(1)} MB` : 'Ningún archivo seleccionado';
    $('btn-transcribir').disabled = !f || state.busy;
}

async function transcribir() {
    if (state.busy) return;
    const f = $('in-audio').files[0];
    if (!f) return toast('Elegí un archivo de audio.');
    if (!isRemote()) {
        showView(needsLogin() ? 'auth' : 'ajustes');
        return toast(needsLogin() ? 'Iniciá sesión para transcribir.' : 'Configurá la conexión en Ajustes.');
    }
    if (f.size > MAX_AUDIO_BYTES) return toast('El audio supera los 12 MB. Recortalo o comprimilo.');
    const mime = (f.type || '').toLowerCase();
    if (!AUDIO_MIMES.includes(mime)) return toast('Formato de audio no admitido (usá MP3, M4A, WAV, OGG, WEBM, AAC o FLAC).');

    setBusy(true, 'Transcribiendo el audio…');
    try {
        const data = await fileToBase64(f);
        const r = await transcribirAudio(mime, data, f.name);
        if (!r.texto || !String(r.texto).trim()) throw new Error('La transcripción volvió vacía.');
        const prev = $('in-hecho').value.trim();
        $('in-hecho').value = (prev ? prev + '\n\n' : '') +
            'TRANSCRIPCIÓN DE AUDIO (revisar contra la grabación original):\n' + String(r.texto).trim();
        saveDraft();
        toast('Transcripción agregada al hecho. Revisala antes de generar.');
    } catch (e) {
        toast(e.message || 'No se pudo transcribir.');
    } finally {
        setBusy(false);
        onAudioChange();
    }
}

/* ---------- Render de resultados ---------- */
function openPieza(p) {
    state.pieza = p;
    localStorage.setItem(KEY.current, p.id);
    $('res-title').textContent = p.titulo || 'Pieza sin título';
    $('in-hecho').value = p.hecho || '';
    if (p.tono) $('in-tono').value = p.tono;
    if (p.departamento) $('in-dep').value = p.departamento;
    $('results').classList.remove('hidden');
    setSaveState('');
    renderEstado(); renderChecklist(); renderSources(); renderTabs(); renderEditor(); renderWp();
}

function renderTabs() {
    $('tabs').innerHTML = FORMAT_KEYS.map((k, i) => {
        const on = k === state.tab;
        return `<button role="tab" aria-selected="${on}" data-tab="${k}" class="tab shrink-0 min-h-[44px] px-4 py-2 rounded-xl border text-xs font-medium text-left ${on ? 'bg-black text-white border-black' : 'bg-white text-swiss-900 border-swiss-300 hover:border-black'}">
            <span class="block text-[10px] font-mono ${on ? 'opacity-70' : 'text-swiss-500'}">Formato 0${i + 1}</span>${esc(FORMATS[k].label)}</button>`;
    }).join('');
}

function renderEditor() {
    const p = state.pieza;
    if (!p) return;
    $('editor').value = p.formatos[state.tab] || '';
    $('ed-title').textContent = FORMATS[state.tab].label;
    $('btn-jsonld').classList.toggle('hidden', state.tab !== 'articulo');
    updateCount();
}

function updateCount() {
    const len = $('editor').value.length;
    const lim = state.tab === 'whatsapp' ? ' / 700' : '';
    $('ed-count').textContent = `${len}${lim} caracteres`;
    $('ed-count').classList.toggle('text-red-600', state.tab === 'whatsapp' && len > 700);
}

function renderSources() {
    const src = (state.pieza?.fuentes || []).filter((s) => isHttp(s.uri));
    $('sources-box').classList.toggle('hidden', src.length === 0);
    $('sources-list').innerHTML = src.map((s) => `
        <a href="${esc(s.uri)}" target="_blank" rel="noopener noreferrer"
           class="text-[11px] bg-white border border-swiss-300 text-swiss-800 px-2.5 py-1.5 rounded-lg hover:border-black truncate max-w-xs min-h-[32px] inline-flex items-center">
            🔗 <span class="truncate ml-1">${esc(s.title || s.uri)}</span></a>`).join('');
}

function renderChecklist() {
    const list = state.pieza?.verificacion || [];
    $('checklist-empty').classList.toggle('hidden', list.length > 0);
    $('checklist').innerHTML = list.map((v, i) => `
        <li><label class="flex items-start gap-3 text-xs text-swiss-800 cursor-pointer py-2 min-h-[44px]">
            <input type="checkbox" data-check="${i}" ${v.ok ? 'checked' : ''} class="mt-0.5 w-4 h-4 rounded border-swiss-300 text-black focus:ring-black shrink-0">
            <span class="${v.ok ? 'line-through text-swiss-400' : ''}">${esc(v.texto)}</span></label></li>`).join('');
}

function renderEstado() {
    const cur = state.pieza?.estado || 'borrador';
    const estados = [['borrador', 'Borrador'], ['revisado', 'Revisado'], ['publicado', 'Publicado']];
    $('estado-group').innerHTML = estados.map(([k, l]) => `
        <button data-estado="${k}" aria-pressed="${k === cur}" class="text-xs font-medium px-3 py-2 rounded-full min-h-[44px] border ${k === cur ? 'bg-black text-white border-black' : 'bg-white text-swiss-700 border-swiss-300 hover:border-black'}">${l}</button>`).join('');
}

function setEstado(nuevo) {
    const p = state.pieza;
    if (!p || p.estado === nuevo) return;
    if (nuevo === 'revisado' && p.verificacion.some((v) => !v.ok)) {
        return toast('Completá la checklist de verificación antes de marcar como revisado.');
    }
    if (nuevo === 'publicado') {
        if (p.estado !== 'revisado') return toast('Una pieza debe estar revisada antes de publicarse.');
        if (isRemote() && !isEditorial()) return toast('Solo un editor o el director puede marcar una pieza como publicada.');
    }
    p.estado = nuevo;
    renderEstado();
    renderWp();
    queueSave();
}

/* ---------- WordPress (solo borradores) ---------- */
function wpBloqueo(p) {
    if (!isRemote()) return 'Requiere conexión con Supabase e inicio de sesión.';
    if (!isEditorial()) return 'Solo un editor o el director puede enviar borradores a WordPress.';
    if (p.estado !== 'revisado') return 'Marcá la pieza como "Revisado" para habilitar el envío.';
    if (hasVerificar(p.formatos.articulo)) return 'El artículo todavía contiene marcas [VERIFICAR].';
    return '';
}

function renderWp() {
    const p = state.pieza;
    if (!p) return;
    const box = $('wp-box');
    if (p.wp_edit_url && isHttp(p.wp_edit_url)) {
        box.innerHTML = `<p class="text-xs text-swiss-700">Ya existe un borrador en WordPress para esta pieza.</p>
            <a href="${esc(p.wp_edit_url)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center text-xs font-medium bg-swiss-100 hover:bg-swiss-200 px-3 py-2 rounded-lg min-h-[44px]">Abrir borrador en WordPress ↗</a>`;
        return;
    }
    const bloqueo = wpBloqueo(p);
    box.innerHTML = `<button id="btn-wp" ${bloqueo ? 'disabled' : ''} class="text-xs font-medium bg-black text-white hover:bg-swiss-800 disabled:opacity-40 disabled:hover:bg-black px-4 py-2 rounded-lg min-h-[44px]">Enviar a WordPress como borrador</button>
        <p class="text-[11px] text-swiss-500">${esc(bloqueo || 'Se crea solo un borrador: la publicación se decide dentro de WordPress.')}</p>`;
    const b = $('btn-wp');
    if (b) b.addEventListener('click', enviarWP);
}

async function enviarWP() {
    const p = state.pieza;
    if (!p || state.busy) return;
    const bloqueo = wpBloqueo(p);
    if (bloqueo) return toast(bloqueo);
    const a = parseArticuloTexto(p.formatos.articulo);
    if (!a.titulo || !a.cuerpo) return toast('El artículo necesita titular y cuerpo.');
    const ok = confirm(`Se creará un BORRADOR en WordPress con la nota:\n\n"${a.titulo}"\n\nNo se publica automáticamente. ¿Confirmás que un humano revisó el contenido y que corresponde enviarlo?`);
    if (!ok) return;

    setBusy(true, 'Enviando borrador a WordPress…');
    try {
        await persistNow();
        const html = (a.bajada ? `<p><strong>${escHtml(a.bajada)}</strong></p>\n` : '') + cuerpoAHtml(a.cuerpo);
        const r = await enviarBorradorWP({
            titulo: a.titulo, contenido_html: html,
            excerpt: a.meta_descripcion || a.bajada || '', slug: a.slug || undefined
        });
        if (typeof r.id !== 'number' || !isHttp(r.edit_url)) throw new Error('Respuesta inesperada de WordPress.');
        p.wp_post_id = r.id;
        p.wp_edit_url = r.edit_url;
        if (!(await marcarBorradorWP(p.id, r.id, r.edit_url))) {
            toast('Borrador creado, pero no se pudo registrar el vínculo en la pieza (¿falta la migración?).');
        }
        renderWp();
        toast('Borrador creado en WordPress.');
    } catch (e) {
        toast(e.message || 'No se pudo enviar a WordPress.');
    } finally {
        setBusy(false);
    }
}

/* ---------- Exportaciones ---------- */
function handleAction(act) {
    const p = state.pieza;
    if (!p) return;
    const base = slugify(p.titulo);
    switch (act) {
        case 'copy': return copyText($('editor').value, 'Formato copiado.');
        case 'export-txt':
            download(`${base}_${state.tab}.txt`, $('editor').value, 'text/plain;charset=utf-8');
            return toast('.txt descargado.');
        case 'export-all-txt':
            download(`${base}_completo.txt`, allText(p), 'text/plain;charset=utf-8');
            return toast('.txt completo descargado.');
        case 'export-doc': {
            const body = FORMAT_KEYS.map((k) =>
                `<h2>${esc(FORMATS[k].label)}</h2><div style="white-space:pre-wrap;font-family:Calibri,Arial,sans-serif">${esc(p.formatos[k] || '')}</div>`).join('<hr>');
            download(`${base}.doc`, `<html><head><meta charset="utf-8"><title>${esc(p.titulo)}</title></head><body><h1>${esc(p.titulo)}</h1>${body}</body></html>`, 'application/msword');
            return toast('Documento Word descargado.');
        }
        case 'export-json':
            download(`${base}.json`, JSON.stringify(p, null, 2), 'application/json');
            return toast('JSON descargado.');
        case 'jsonld':
            return copyText(`<script type="application/ld+json">\n${JSON.stringify(jsonLd(p), null, 2)}\n<\/script>`, 'JSON-LD copiado.');
        case 'regen': return regenerar();
    }
}

/* ---------- Historial ---------- */
async function renderHistory() {
    const box = $('hist-list');
    box.innerHTML = '<p class="text-xs font-mono text-swiss-500 p-4">Cargando…</p>';
    let list = [];
    try { list = await listPiezas(); }
    catch (e) { box.innerHTML = `<p class="text-sm text-red-600 p-4">${esc(e.message)}</p>`; return; }
    $('hist-count').textContent = list.length ? `(${list.length})` : '';
    const f = $('hist-filter').value;
    if (f) list = list.filter((x) => x.estado === f);

    if (!list.length) {
        box.innerHTML = `<div class="bg-white border border-swiss-200 rounded-2xl p-8 text-center space-y-1">
            <p class="text-swiss-500 text-xs font-mono">No hay piezas${f ? ' con ese estado' : ''}.</p>
            <p class="text-sm">Creá contenidos y se guardan automáticamente.</p></div>`;
        return;
    }
    const badge = { borrador: 'bg-swiss-100 text-swiss-700', revisado: 'bg-amber-100 text-amber-800', publicado: 'bg-emerald-100 text-emerald-800' };
    box.innerHTML = list.map((p) => `
        <div class="bg-white border border-swiss-200 rounded-xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-[10px] font-mono text-swiss-400">${esc(new Date(p.updated_at || p.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }))}</span>
                    <span class="text-[10px] font-medium px-2 py-0.5 rounded-full ${badge[p.estado] || badge.borrador}">${esc(p.estado)}</span>
                    ${p.departamento ? `<span class="text-[10px] text-swiss-500">${esc(p.departamento)}</span>` : ''}
                    ${p.wp_post_id ? '<span class="text-[10px] text-swiss-500">· en WordPress (borrador)</span>' : ''}
                </div>
                <h3 class="font-serif font-bold text-sm mt-1 truncate">${esc(p.titulo || 'Sin título')}</h3>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button data-h="open" data-id="${esc(p.id)}" class="text-xs bg-black text-white px-3 py-2 rounded-lg font-medium min-h-[44px] hover:bg-swiss-800">Abrir</button>
                <button data-h="dup" data-id="${esc(p.id)}" class="text-xs bg-swiss-100 px-3 py-2 rounded-lg font-medium min-h-[44px] hover:bg-swiss-200">Duplicar</button>
                <button data-h="del" data-id="${esc(p.id)}" class="text-xs bg-red-50 text-red-700 px-3 py-2 rounded-lg font-medium min-h-[44px] hover:bg-red-100">Eliminar</button>
            </div>
        </div>`).join('');
}

async function historyAction(kind, id) {
    try {
        if (kind === 'open') {
            const p = await getPieza(id);
            if (!p) return toast('No se encontró la pieza.');
            state.tab = 'articulo';
            openPieza(p);
            showView('motor');
        } else if (kind === 'dup') {
            const p = await getPieza(id);
            if (!p) return;
            const copia = JSON.parse(JSON.stringify(p));
            copia.id = crypto.randomUUID();
            copia.titulo = `Copia de ${p.titulo}`.slice(0, 140);
            copia.estado = 'borrador';
            delete copia.wp_post_id; delete copia.wp_edit_url;
            copia.verificacion = (copia.verificacion || []).map((v) => ({ ...v, ok: false }));
            copia.created_at = copia.updated_at = new Date().toISOString();
            await persist(copia);
            toast('Pieza duplicada como borrador.');
            renderHistory();
        } else if (kind === 'del') {
            if (!confirm('¿Eliminar esta pieza? No se puede deshacer.')) return;
            await removePieza(id);
            if (state.pieza?.id === id) { state.pieza = null; $('results').classList.add('hidden'); }
            toast('Pieza eliminada.');
            renderHistory();
        }
    } catch (e) { toast(e.message); }
}

/* ---------- Ajustes ---------- */
function fillSettings() {
    $('cfg-url').value = ctx.cfg.url || '';
    $('cfg-anon').value = ctx.cfg.anon || '';
    $('cfg-model').value = ctx.cfg.model || '';
    $('cfg-style').value = localStorage.getItem(KEY.style) || '';
}

async function saveSettings() {
    const cfg = { url: $('cfg-url').value.trim(), anon: $('cfg-anon').value.trim(), model: $('cfg-model').value.trim() };
    if (cfg.url && !isHttp(cfg.url)) return toast('La URL debe empezar con https://');
    saveCfg(cfg);
    localStorage.setItem(KEY.style, $('cfg-style').value);
    initSupabase();
    await refreshSession();
    refreshChrome();
    toast('Ajustes guardados.');
    showView(needsLogin() ? 'auth' : 'motor');
}

async function testConnection() {
    if (!ctx.sb) return toast('Completá URL y anon key y guardá los ajustes.');
    try {
        const { error } = await ctx.sb.from('piezas').select('id', { head: true, count: 'exact' }).limit(1);
        if (error && !/permission|JWT|row-level/i.test(error.message)) throw new Error(error.message);
        toast(ctx.session ? 'Conexión correcta con sesión activa.' : 'Supabase responde. Falta iniciar sesión.');
    } catch (e) { toast('No se pudo conectar: ' + e.message); }
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
    showView('motor');
    await restoreCurrent();
}

async function doMagic() {
    const email = $('auth-email').value.trim();
    if (!email) return toast('Ingresá tu correo.');
    const { error } = await magicLink(email);
    toast(error ? 'No se pudo enviar el enlace: ' + error.message : 'Te enviamos un enlace de acceso. Revisá tu correo.');
}

async function doLogout() {
    await logout();
    state.pieza = null;
    $('results').classList.add('hidden');
    refreshChrome();
    showView(needsLogin() ? 'auth' : 'motor');
}

/* ---------- Borrador del formulario ---------- */
function saveDraft() {
    saveJSON(KEY.draft, {
        hecho: $('in-hecho').value, tono: $('in-tono').value,
        dep: $('in-dep').value, search: $('in-search').checked
    });
}

function nuevaPieza() {
    state.pieza = null;
    localStorage.removeItem(KEY.current);
    $('results').classList.add('hidden');
    $('in-hecho').value = '';
    saveDraft();
    $('in-hecho').focus();
}

/* ---------- Inicio ---------- */
async function init() {
    $('in-dep').innerHTML = '<option value="">Toda la provincia</option>' +
        DEPARTAMENTOS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('');

    const d = loadJSON(KEY.draft, null);
    if (d) {
        $('in-hecho').value = d.hecho || '';
        if (d.tono) $('in-tono').value = d.tono;
        if (d.dep) $('in-dep').value = d.dep;
        $('in-search').checked = d.search !== false;
    }

    loadCfg();
    initSupabase();
    await refreshSession();
    onChange(refreshChrome);
    refreshChrome();

    document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => {
        showView(b.dataset.view === 'motor' && needsLogin() ? 'auth' : b.dataset.view);
    }));
    $('btn-login').addEventListener('click', doLogin);
    $('btn-magic').addEventListener('click', doMagic);
    $('auth-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
    $('btn-logout').addEventListener('click', doLogout);
    $('btn-generate').addEventListener('click', generar);
    $('btn-new').addEventListener('click', nuevaPieza);
    $('btn-save-cfg').addEventListener('click', saveSettings);
    $('btn-test').addEventListener('click', testConnection);
    $('hist-filter').addEventListener('change', renderHistory);
    $('in-audio').addEventListener('change', onAudioChange);
    $('btn-transcribir').addEventListener('click', transcribir);
    ['in-hecho', 'in-tono', 'in-dep', 'in-search'].forEach((id) => $(id).addEventListener('input', saveDraft));

    $('editor').addEventListener('input', () => {
        if (!state.pieza) return;
        state.pieza.formatos[state.tab] = $('editor').value;
        updateCount();
        if (state.tab === 'articulo') renderWp();
        queueSave();
    });
    $('tabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        state.tab = b.dataset.tab;
        renderTabs();
        renderEditor();
    });
    $('estado-group').addEventListener('click', (e) => {
        const b = e.target.closest('[data-estado]');
        if (b) setEstado(b.dataset.estado);
    });
    $('checklist').addEventListener('change', (e) => {
        const i = e.target.dataset.check;
        if (i === undefined || !state.pieza) return;
        state.pieza.verificacion[Number(i)].ok = e.target.checked;
        if (!e.target.checked && state.pieza.estado !== 'borrador') {
            state.pieza.estado = 'borrador';
            renderEstado();
            toast('Volvió a borrador: hay datos sin verificar.');
        }
        renderChecklist();
        renderWp();
        queueSave();
    });
    document.querySelectorAll('.act').forEach((b) => b.addEventListener('click', () => handleAction(b.dataset.act)));
    $('hist-list').addEventListener('click', (e) => {
        const b = e.target.closest('[data-h]');
        if (b) historyAction(b.dataset.h, b.dataset.id);
    });

    onAudioChange();

    if (!ctx.sb) {
        showView('ajustes');
        toast('Configurá tu proyecto Supabase para empezar.');
    } else if (needsLogin()) {
        showView('auth');
    } else {
        showView('motor');
        await restoreCurrent();
    }
    try {
        const l = await listPiezas();
        $('hist-count').textContent = l.length ? `(${l.length})` : '';
    } catch { /* sin sesión */ }
}

document.addEventListener('DOMContentLoaded', init);
