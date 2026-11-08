/* Constantes compartidas. Las claves de localStorage se mantienen respecto de Madre v2
   para no perder el historial ni los ajustes ya guardados. */

export const KEY = {
    cfg: 'madre2_cfg',
    hist: 'madre2_hist',
    style: 'madre2_style',
    draft: 'madre2_draft',
    current: 'madre2_current',
    fichas: 'biblioteca_fichas',
    legacyDevKey: 'madre2_devkey'   // modo desarrollo eliminado: solo se limpia
};

// Debe figurar en ALLOWED_MODELS de ia-proxy (modelo con uso reciente en producción).
export const DEFAULT_MODEL = 'gemini-3.8-flash';

// Una sola Edge Function atiende transcripción y borradores a WordPress (acciones).
export const FN_MADRE_AI = 'madre-ai';

// Este módulo pertenece al Eje 3 del Plan 2030.
export const EJE_MADRE = 3;

// Roles con autoridad editorial para publicar y enviar borradores a WordPress.
// Roles reales de profiles.rol: director, editor, redactor, reportero.
export const ROLES_EDITORIALES = ['editor', 'director'];

export const DEPARTAMENTOS = [
    'Capital', 'Arauco', 'Castro Barros', 'Chamical', 'Chilecito', 'Coronel Felipe Varela',
    'Famatina', 'General Ángel V. Peñaloza', 'General Belgrano', 'General Juan Facundo Quiroga',
    'General Lamadrid', 'General Ocampo', 'General San Martín', 'Independencia',
    'Rosario Vera Peñaloza', 'San Blas de los Sauces', 'Sanagasta', 'Vinchina'
];

// Audio: límite de 12 MB (el base64 resultante queda por debajo de 20 MB de la API).
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
export const AUDIO_MIMES = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a',
    'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/flac'
];
