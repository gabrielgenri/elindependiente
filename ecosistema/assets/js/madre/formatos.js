/* Los seis formatos de Madre: schemas, guías de generación y renderizado a texto.
   Módulo puro (sin DOM): se puede probar con `npm test`. */

const STR = { type: 'STRING' };
const ARR = (items) => ({ type: 'ARRAY', items });
const OBJ = (props) => ({ type: 'OBJECT', properties: props, required: Object.keys(props) });

export { OBJ };

export const FORMATS = {
    articulo: {
        label: 'Artículo Web & SEO',
        schema: OBJ({ titulo: STR, bajada: STR, slug: STR, meta_descripcion: STR, palabras_clave: ARR(STR), cuerpo: STR }),
        guia: 'Nota web de 450 a 700 palabras, pirámide invertida, subtítulos H2/H3 conversacionales (formato ## y ###). Slug en minúsculas con guiones, incluyendo la geolocalización si corresponde. meta_descripcion de hasta 155 caracteres. palabras_clave son las etiquetas de la nota.',
        render: (o) => `${o.titulo || ''}\n${o.bajada || ''}\n\nSlug: ${o.slug || ''}\nMeta descripción: ${o.meta_descripcion || ''}\nPalabras clave: ${(o.palabras_clave || []).join(', ')}\n\n${o.cuerpo || ''}`
    },
    reel: {
        label: 'Guión de Reel (60 s)',
        schema: OBJ({ gancho: STR, escenas: ARR(OBJ({ tiempo: STR, visual: STR, locucion: STR })), cta: STR }),
        guia: 'Reel vertical de aproximadamente 60 segundos: gancho de 3 segundos, 5 a 7 escenas con marca de tiempo (ej. 00:03-00:12), indicación visual y locución, y un cierre con llamada a la acción.',
        render: (o) => `GANCHO: ${o.gancho || ''}\n\n` + (o.escenas || []).map((e) => `[${e.tiempo}]\nVISUAL: ${e.visual}\nLOCUCIÓN: ${e.locucion}`).join('\n\n') + `\n\nCTA: ${o.cta || ''}`
    },
    podcast: {
        label: 'Guión de Podcast',
        schema: OBJ({ titulo: STR, intro: STR, desarrollo: STR, outro: STR }),
        guia: 'Guion hablado listo para locución, de 3 a 5 minutos, con lenguaje oral. intro de 20 segundos, desarrollo analítico con contexto y voces involucradas, outro con cierre y llamada a suscribirse.',
        render: (o) => `${o.titulo || ''}\n\nINTRO\n${o.intro || ''}\n\nDESARROLLO\n${o.desarrollo || ''}\n\nOUTRO\n${o.outro || ''}`
    },
    carrusel: {
        label: 'Carrusel Instagram',
        schema: OBJ({ placas: ARR(OBJ({ n: { type: 'INTEGER' }, titulo: STR, texto: STR })) }),
        guia: 'Exactamente 8 placas: 1 portada con gancho, 2 a 3 contexto, 4 a 6 datos clave, 7 cierre, 8 llamada a la acción. Texto de cada placa de máximo 35 palabras.',
        render: (o) => (o.placas || []).map((p) => `PLACA ${p.n}: ${p.titulo}\n${p.texto}`).join('\n\n')
    },
    newsletter: {
        label: 'Newsletter',
        schema: OBJ({ asunto: STR, preheader: STR, cuerpo: STR }),
        guia: 'Newsletter ejecutivo: asunto de hasta 60 caracteres, preheader de hasta 90, cuerpo con resumen de 3 ideas clave, por qué importa, y un enlace sugerido a la nota completa como [ENLACE].',
        render: (o) => `ASUNTO: ${o.asunto || ''}\nPREHEADER: ${o.preheader || ''}\n\n${o.cuerpo || ''}`
    },
    whatsapp: {
        label: 'WhatsApp Masivo',
        schema: OBJ({ mensaje: STR }),
        guia: 'Mensaje de difusión de hasta 700 caracteres, con formato de WhatsApp (*negrita*), 1 o 2 emojis sobrios, y un cierre con [ENLACE].',
        render: (o) => o.mensaje || ''
    }
};

export const FORMAT_KEYS = Object.keys(FORMATS);

export const FULL_SCHEMA = (() => {
    const props = {};
    for (const k of FORMAT_KEYS) props[k] = FORMATS[k].schema;
    props.verificacion = ARR(STR);
    return OBJ(props);
})();

export function parseModelJSON(text) {
    const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(clean); } catch { throw new Error('La IA devolvió un formato inválido. Reintentá.'); }
}

/** Vuelve a descomponer el texto editado del artículo (inverso de FORMATS.articulo.render). */
export function parseArticuloTexto(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const out = { titulo: (lines[0] || '').trim(), bajada: (lines[1] || '').trim(), slug: '', meta_descripcion: '', palabras_clave: [], cuerpo: '' };
    let i = 2;
    const re = /^(Slug|Meta descripción|Palabras clave):\s*(.*)$/i;
    while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === '') { i++; continue; }
        const m = l.match(re);
        if (!m) break;
        const k = m[1].toLowerCase();
        if (k === 'slug') out.slug = m[2].trim();
        else if (k.startsWith('meta')) out.meta_descripcion = m[2].trim();
        else out.palabras_clave = m[2].split(',').map((s) => s.trim()).filter(Boolean);
        i++;
    }
    out.cuerpo = lines.slice(i).join('\n').trim();
    return out;
}

export const hasVerificar = (text) => /\[VERIFICAR\]/i.test(String(text || ''));

/** Todos los formatos como un único texto. Ignora formatos heredados de piezas antiguas. */
export function allText(p) {
    return FORMAT_KEYS.map((k) => `=== ${FORMATS[k].label.toUpperCase()} ===\n\n${p.formatos?.[k] || ''}`).join('\n\n\n');
}

/** Marcado schema.org NewsArticle a partir del texto actual (ya editado) del artículo. */
export function jsonLd(p) {
    const a = parseArticuloTexto(p.formatos?.articulo || '');
    return {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: String(a.titulo || p.titulo || '').slice(0, 110),
        description: a.meta_descripcion || '',
        keywords: a.palabras_clave.join(', '),
        inLanguage: 'es-AR',
        articleBody: a.cuerpo || '',
        // Reemplazar datePublished por la fecha real de publicación al subir la nota a la web.
        datePublished: p.created_at,
        dateModified: p.updated_at,
        author: { '@type': 'Organization', name: 'El Independiente' },
        publisher: { '@type': 'Organization', name: 'El Independiente' }
    };
}
