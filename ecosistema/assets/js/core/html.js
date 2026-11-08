/* Conversión segura de texto a HTML para WordPress (sin DOM: se prueba con `npm test`). */

export const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Markdown mínimo (## / ### y párrafos) → HTML, siempre escapando el texto antes. */
export function cuerpoAHtml(md) {
    return String(md ?? '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((b) => {
        const h = b.match(/^(#{2,3})\s+([\s\S]*)$/);
        if (h) return `<h${h[1].length}>${esc(h[2].trim())}</h${h[1].length}>`;
        return `<p>${esc(b).replace(/\n/g, '<br>')}</p>`;
    }).join('\n');
}
