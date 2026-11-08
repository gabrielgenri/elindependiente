/* Utilidades compartidas por todos los módulos. Sin dependencias del DOM al importar. */

export const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const isHttp = (u) => /^https?:\/\//i.test(String(u || ''));

export const loadJSON = (k, fb) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; }
};
export const saveJSON = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio */ }
};

export const slugify = (s) => String(s || 'pieza').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60) || 'pieza';

let toastTimer;
export function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('opacity-0');
    t.classList.add('opacity-100');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        t.classList.add('opacity-0');
        t.classList.remove('opacity-100');
    }, 3200);
}

export function download(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text, ok) {
    try { await navigator.clipboard.writeText(text); toast(ok); }
    catch {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast(ok); } catch { toast('No se pudo copiar.'); }
        ta.remove();
    }
}

/** Lee un File y devuelve su contenido en base64 (sin el prefijo data:). */
export function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.readAsDataURL(file);
    });
}
