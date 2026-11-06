# Madre · Ecosistema editorial

SPA mobile-first para la redacción de El Independiente. Reúne el motor Madre v3 y la Biblioteca Riojana en una interfaz; ambos módulos comparten proyecto, sesión de Supabase y configuración local.

## Incluye

- Generación de artículo SEO, reel de 60 segundos, podcast, carrusel de ocho placas, newsletter y WhatsApp.
- Investigación web, editor crítico, archivo histórico con búsqueda semántica, transcripción, síntesis de voz y exportación a WordPress como borrador.
- Biblioteca de fichas atemporales con checklist, edición por campo, estados editoriales, sugerencias de enlaces y exportación Markdown, HTML, JSON y JSON-LD.
- Autenticación de redacción, persistencia en Supabase, respaldo local y secretos de IA/WordPress únicamente en Edge Functions.

## Estructura

```text
index.html                         Shell SPA
madre/index.html                   Motor Madre v3
biblioteca/index.html              Biblioteca Riojana
supabase/config.toml
supabase/functions/madre-ai/       Acciones de Madre v3
supabase/functions/ia-proxy/       Proxy seguro usado por la Biblioteca
supabase/migrations/               Esquema, RLS, roles, pgvector y Storage
TUTORIAL_IMPLEMENTACION.md         Instalación y puesta en marcha
```

## Inicio rápido

Lee [TUTORIAL_IMPLEMENTACION.md](TUTORIAL_IMPLEMENTACION.md) antes de conectar el frontend. La aplicación necesita un proyecto Supabase configurado, las dos Edge Functions desplegadas y una cuenta autenticada. No incluye credenciales de producción.

Para una vista local, sirve esta carpeta desde un servidor HTTP; no abras `index.html` como `file://`. Por ejemplo, desde esta carpeta ejecuta `python -m http.server 5500` y visita `http://localhost:5500`.

## Fuentes incorporadas

El módulo Madre parte de `fuentes/Madre/madre-v3.html`, el tutorial y la migración v3. La Biblioteca parte de `fuentes/Madre/biblioteca/` y se adapta a las producciones v3. El proxy genérico y el esquema de perfiles/roles parten de `fuentes/Madre/v2/`. Los archivos de referencia originales permanecen en `fuentes/Madre/`.

## Operación editorial

La IA prepara borradores y sugiere verificaciones. El Editor Crítico orienta la revisión; no reemplaza la decisión del periodista. La integración WordPress crea siempre publicaciones en estado `draft`. Las fichas de la Biblioteca solo pueden pasar a `publicado` por un usuario con rol `editor` o `director`.
