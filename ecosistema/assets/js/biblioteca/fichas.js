/* Lógica pura de las fichas de la Biblioteca Riojana (sin DOM): se prueba con `npm test`. */

import { esc } from '../core/utils.js';

export const CATEGORIAS = [
    'Historia', 'Territorio', 'Cultura y tradiciones', 'Economía y producción',
    'Instituciones', 'Ambiente y patrimonio', 'Otra'
];

// Checklist base para fichas atemporales; se puede editar en cada ficha.
export const CHECKLIST_BASE = [
    'Datos, fechas y cifras contrastados con una fuente primaria',
    'Nombres oficiales de lugares, instituciones y cargos verificados',
    'Sin referencias temporales relativas (hoy, este año, recientemente)',
    'Fuentes y referencias citadas',
    'Sin datos personales innecesarios ni afirmaciones sin respaldo'
];

export function nuevaFicha(now = new Date().toISOString(), id = crypto.randomUUID()) {
    return {
        id, titulo: '', categoria: CATEGORIAS[0], departamento: '', resumen: '', contenido: '',
        fuentes: '', estado: 'borrador', piezas: [],
        verificacion: CHECKLIST_BASE.map((texto) => ({ texto, ok: false })),
        created_at: now, updated_at: now
    };
}

export const tieneVerificar = (f) => /\[VERIFICAR\]/i.test(`${f.titulo}\n${f.resumen}\n${f.contenido}`);

/** Reglas de transición de estado. Devuelve { ok, motivo }. */
export function puedeCambiarEstado(f, nuevo, { esEditorial = false, remoto = false } = {}) {
    if (f.estado === nuevo) return { ok: true, motivo: '' };
    if (nuevo === 'revisado') {
        if (!f.titulo.trim() || !f.contenido.trim()) return { ok: false, motivo: 'La ficha necesita título y contenido.' };
        if (tieneVerificar(f)) return { ok: false, motivo: 'Todavía hay marcas [VERIFICAR] en el texto.' };
        if (f.verificacion.some((v) => !v.ok)) return { ok: false, motivo: 'Completá la checklist de verificación.' };
    }
    if (nuevo === 'publicado') {
        if (f.estado !== 'revisado') return { ok: false, motivo: 'Una ficha debe estar revisada antes de publicarse.' };
        if (remoto && !esEditorial) return { ok: false, motivo: 'Solo un editor o el director puede publicar fichas.' };
    }
    return { ok: true, motivo: '' };
}

export function coincide(f, q) {
    const t = String(q || '').trim().toLowerCase();
    if (!t) return true;
    return `${f.titulo} ${f.categoria} ${f.departamento} ${f.resumen}`.toLowerCase().includes(t);
}

const titulosDe = (f, titulos) => (f.piezas || []).map((id) => titulos[id] || '(producción no disponible)');

export function fichaToText(f, titulos = {}) {
    const rel = titulosDe(f, titulos);
    return [
        f.titulo || '(sin título)',
        `Categoría: ${f.categoria || '-'} · Departamento: ${f.departamento || 'Toda la provincia'} · Estado: ${f.estado}`,
        '',
        'RESUMEN', f.resumen || '', '',
        'CONTENIDO', f.contenido || '', '',
        'FUENTES', f.fuentes || '', '',
        'PRODUCCIONES RELACIONADAS', rel.length ? rel.map((t) => `- ${t}`).join('\n') : '(ninguna)'
    ].join('\n');
}

export function fichaToWordHtml(f, titulos = {}) {
    const rel = titulosDe(f, titulos);
    const bloque = (t) => `<div style="white-space:pre-wrap;font-family:Calibri,Arial,sans-serif">${esc(t || '')}</div>`;
    return `<html><head><meta charset="utf-8"><title>${esc(f.titulo)}</title></head><body>` +
        `<h1>${esc(f.titulo)}</h1><p>${esc(f.categoria)} · ${esc(f.departamento || 'Toda la provincia')} · ${esc(f.estado)}</p>` +
        `<h2>Resumen</h2>${bloque(f.resumen)}<h2>Contenido</h2>${bloque(f.contenido)}<h2>Fuentes</h2>${bloque(f.fuentes)}` +
        `<h2>Producciones relacionadas</h2>${rel.length ? '<ul>' + rel.map((t) => `<li>${esc(t)}</li>`).join('') + '</ul>' : '<p>(ninguna)</p>'}` +
        `</body></html>`;
}
