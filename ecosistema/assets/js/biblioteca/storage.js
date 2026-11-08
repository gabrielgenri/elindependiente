/* Persistencia de fichas: Supabase (equipo) o localStorage (solo este dispositivo). */

import { ctx, isRemote } from '../core/auth.js';
import { KEY } from '../core/config.js';
import { loadJSON, saveJSON } from '../core/utils.js';

// El cliente usa `piezas`; la base guarda `pieza_ids`.
const toRow = (f) => ({
    id: f.id, titulo: f.titulo, categoria: f.categoria, departamento: f.departamento,
    resumen: f.resumen, contenido: f.contenido, fuentes: f.fuentes, estado: f.estado,
    verificacion: f.verificacion, pieza_ids: f.piezas || []
});
const fromRow = (r) => { const { pieza_ids, ...rest } = r; return { ...rest, piezas: pieza_ids || [] }; };

export async function persistFicha(f) {
    f.updated_at = new Date().toISOString();
    if (isRemote()) {
        const { error } = await ctx.sb.from('fichas').upsert(toRow(f));
        if (error) throw new Error(error.message);
    } else {
        const list = loadJSON(KEY.fichas, []);
        const i = list.findIndex((x) => x.id === f.id);
        if (i >= 0) list[i] = f; else list.unshift(f);
        saveJSON(KEY.fichas, list.slice(0, 200));
    }
}

export async function listFichas() {
    if (isRemote()) {
        const { data, error } = await ctx.sb.from('fichas').select('*')
            .order('updated_at', { ascending: false }).limit(300);
        if (error) throw new Error(error.message);
        return (data || []).map(fromRow);
    }
    return loadJSON(KEY.fichas, []);
}

export async function getFicha(id) {
    if (isRemote()) {
        const { data } = await ctx.sb.from('fichas').select('*').eq('id', id).maybeSingle();
        return data ? fromRow(data) : null;
    }
    return loadJSON(KEY.fichas, []).find((x) => x.id === id) || null;
}

export async function removeFicha(id) {
    if (isRemote()) {
        const { error } = await ctx.sb.from('fichas').delete().eq('id', id);
        if (error) throw new Error(error.message);
    } else {
        saveJSON(KEY.fichas, loadJSON(KEY.fichas, []).filter((x) => x.id !== id));
    }
}
