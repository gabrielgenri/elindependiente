/* Persistencia de piezas: Supabase (equipo) o localStorage (solo este dispositivo). */

import { ctx, isRemote } from './auth.js';
import { KEY } from './config.js';
import { loadJSON, saveJSON } from './utils.js';

// Columnas que escribe el cliente. wp_post_id / wp_edit_url las escribe solo el servidor.
function toRow(p) {
    return {
        id: p.id, titulo: p.titulo, hecho: p.hecho, tono: p.tono, eje: p.eje,
        departamento: p.departamento, estado: p.estado, formatos: p.formatos,
        estructura: p.estructura, fuentes: p.fuentes, verificacion: p.verificacion
    };
}

export async function persist(p) {
    p.updated_at = new Date().toISOString();
    if (isRemote()) {
        const { error } = await ctx.sb.from('piezas').upsert(toRow(p));
        if (error) throw new Error(error.message);
    } else {
        const list = loadJSON(KEY.hist, []);
        const i = list.findIndex((x) => x.id === p.id);
        if (i >= 0) list[i] = p; else list.unshift(p);
        saveJSON(KEY.hist, list.slice(0, 50));
    }
    localStorage.setItem(KEY.current, p.id);
}

export async function listPiezas() {
    if (isRemote()) {
        const { data, error } = await ctx.sb.from('piezas').select('*')
            .order('updated_at', { ascending: false }).limit(100);
        if (error) throw new Error(error.message);
        return data || [];
    }
    return loadJSON(KEY.hist, []);
}

export async function getPieza(id) {
    if (isRemote()) {
        const { data } = await ctx.sb.from('piezas').select('*').eq('id', id).maybeSingle();
        return data || null;
    }
    return loadJSON(KEY.hist, []).find((x) => x.id === id) || null;
}

export async function removePieza(id) {
    if (isRemote()) {
        const { error } = await ctx.sb.from('piezas').delete().eq('id', id);
        if (error) throw new Error(error.message);
    } else {
        saveJSON(KEY.hist, loadJSON(KEY.hist, []).filter((x) => x.id !== id));
    }
}

/** Registra en la pieza el borrador creado en WordPress. Devuelve true si se pudo guardar. */
export async function marcarBorradorWP(id, wpPostId, editUrl) {
    if (!isRemote()) return false;
    const { error } = await ctx.sb.from('piezas').update({ wp_post_id: wpPostId, wp_edit_url: editUrl }).eq('id', id);
    return !error;
}
