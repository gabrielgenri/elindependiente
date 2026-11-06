# Tutorial de implementación · Madre Ecosistema

Esta guía instala el paquete en un proyecto Supabase nuevo y publica el frontend en un mismo origen. Las API keys de Gemini y WordPress se guardan como secretos de Supabase; el navegador recibe solamente la URL del proyecto y la clave publicable.

## 1. Requisitos

- Proyecto Supabase y acceso de administrador.
- Supabase CLI. El paquete fue preparado con migraciones que creó `supabase migration new`.
- Clave de Google AI Studio con acceso a los modelos Gemini configurados.
- Opcional: sitio WordPress con una contraseña de aplicación para crear borradores.
- Hosting estático que publique completa la carpeta `MODULOS/madre-ecosistema`.

## 2. Preparar Supabase

1. Crea un proyecto y guarda su Project Reference.
2. Abre una terminal en `MODULOS/madre-ecosistema`.
3. Autentica la CLI y vincula el proyecto:

   ```powershell
   supabase login
   supabase link --project-ref TU_PROJECT_REF
   ```

4. Aplica las migraciones en orden:

   ```powershell
   supabase db push
   ```

   `20261106070009_madre_base.sql` crea perfiles, roles, control de publicación y tablas compatibles. `20261106070010_madre_modulos.sql` crea producciones, transcripciones, archivo vectorial, Biblioteca y buckets privados. RLS queda habilitado en todas las tablas expuestas.

5. En Authentication, desactiva el registro público. Crea las cuentas del equipo manualmente.
6. Desde SQL Editor, asigna los roles de dirección y edición. Reemplaza los correos:

   ```sql
   update public.profiles set rol = 'director' where email = 'direccion@eldiario.com';
   update public.profiles set rol = 'editor' where email = 'editor@eldiario.com';
   ```

   Los demás usuarios empiezan como `redactor`. La base impide que publiquen fichas de la Biblioteca.

## 3. Configurar secretos del servidor

Carga las credenciales en Supabase; nunca las pegues en `index.html`, en el navegador ni en el repositorio:

```powershell
supabase secrets set GEMINI_API_KEY=TU_CLAVE_GEMINI
supabase secrets set GEMINI_MODEL=gemini-3.8-flash
supabase secrets set GEMINI_TTS_MODEL=gemini-3.8-flash-tts
supabase secrets set ALLOWED_MODELS=gemini-3.8-flash
supabase secrets set ALLOWED_ORIGINS="https://TU_USUARIO.github.io,http://localhost:5500,http://127.0.0.1:5500"
```

Para habilitar WordPress, añade los tres secretos siguientes. Usa una cuenta editorial de permisos limitados y una contraseña de aplicación:

```powershell
supabase secrets set WP_URL=https://TU_SITIO
supabase secrets set WP_USER=USUARIO_EDITORIAL
supabase secrets set WP_APP_PASSWORD="XXXX XXXX XXXX XXXX XXXX XXXX"
```

El envío permanece bloqueado hasta marcar la revisión humana en la interfaz y validar el rol `editor` o `director` en Supabase. La Edge Function fija `status: draft` en cada envío.

## 4. Desplegar Edge Functions

Con el proyecto aún vinculado:

```powershell
supabase functions deploy madre-ai
supabase functions deploy ia-proxy
```

Las dos funciones mantienen `verify_jwt = true`. `madre-ai` atiende las acciones de Madre; `ia-proxy` ofrece la llamada estructurada compartida por la Biblioteca. Ambas validan sesión antes de aceptar el trabajo y leen Gemini desde secretos del servidor.

## 5. Publicar el frontend

Publica el contenido completo de `MODULOS/madre-ecosistema` como una carpeta estática en un único origen. Para GitHub Pages, puedes copiarla a una carpeta `madre-ecosistema/` en la raíz del sitio. Las rutas relativas del shell cargan `madre/` y `biblioteca/` sin una configuración de bundler.

Para probar en local, ejecuta desde la raíz de esta carpeta:

```powershell
python -m http.server 5500
```

Visita `http://localhost:5500`. Incluye ese origen en `ALLOWED_ORIGINS` si vas a invocar funciones desde localhost.

## 6. Primera conexión e inicio de sesión

1. Abre `index.html` desde el sitio publicado.
2. En Madre, pulsa **Conexión**.
3. Ingresa la URL de Supabase y la clave `publishable` (o la clave pública `anon` existente). Se guardan en `localStorage` de ese navegador para compartir la sesión entre módulos.
4. Inicia sesión con una cuenta creada en el panel de Supabase.
5. Abre Biblioteca desde la navegación superior. Usa la misma sesión y configuración.

No uses la `service_role`, la secret key de Supabase ni la clave de Gemini en este formulario.

## 7. Flujo de trabajo

1. En **Motor editorial**, ingresa un hecho, contexto, tono y ubicación; activa la búsqueda web cuando haga falta investigar.
2. Revisa las seis salidas, las fuentes y las marcas `[VERIFICAR]`. Edita el contenido antes de usarlo.
3. Ejecuta **Editor Crítico** para revisar sesgo, claridad y riesgos legales. Es una segunda opinión automatizada.
4. Genera el audio del podcast o transcribe una entrevista desde los módulos correspondientes.
5. En **Archivo Histórico**, importa notas y usa la búsqueda semántica para recuperar contexto relacionado.
6. En **Biblioteca Riojana**, crea una ficha desde texto libre o carga una producción de Madre. Completa la checklist, revisa cada campo y pide a un editor que marque la ficha como publicada.
7. Si WordPress está configurado, un usuario Supabase con rol `editor` o `director` confirma la revisión humana y envía el artículo: quedará guardado como borrador para aprobación final en WordPress.

## 8. Cuidado del archivo semántico

El esquema usa `gemini-embedding-001` con vectores de 768 dimensiones. Si cambias el modelo o la dimensión, actualiza el tipo de la columna y el parámetro de `match_notas`, crea el índice correspondiente y vuelve a generar embeddings para todas las notas. No mezcles vectores de dimensiones o modelos diferentes en el mismo índice.

## 9. Comprobaciones operativas

- Confirma que el equipo puede iniciar sesión y que el rol aparece en `public.profiles`.
- Verifica que Motor y Biblioteca persisten cambios y comparten sesión en el mismo navegador.
- Comprueba que una búsqueda del Archivo devuelve notas solo después de generar sus embeddings.
- Comprueba que el bucket `podcasts` no sea público y que el enlace firmado caduque.
- Intenta publicar una ficha con rol `redactor`: Postgres debe rechazar el cambio. Repite con `editor`.
- Antes de usar WordPress, verifica en su escritorio que la pieza enviada aparece en borradores.
- Revisa los logs de las funciones si Gemini o un servicio externo devuelve un error.

## 10. Límites y mantenimiento

- La investigación con búsqueda web depende del grounding de Gemini; conserva las fuentes y verifica hechos antes de publicar.
- La salida del Editor Crítico es orientativa. No es asesoramiento legal ni autorización de publicación.
- El audio inline está pensado para clips breves; divide archivos extensos antes de transcribirlos.
- Los secretos se administran con `supabase secrets set`. Rótalos si se filtran y no los subas a Git.
- Las fuentes completas de Madre v2, v3 y Biblioteca están en `fuentes/Madre/`; este módulo conserva los HTML adaptados y el proxy original para facilitar futuras mejoras.

## Referencias técnicas vigentes

- [Secretos de Edge Functions en Supabase](https://supabase.com/docs/guides/functions/secrets)
- [Despliegue de Edge Functions](https://supabase.com/docs/guides/functions/deploy)
- [Columnas vectoriales y pgvector](https://supabase.com/docs/guides/ai/vector-columns)
- [Modelos de Gemini](https://ai.google.dev/gemini-api/docs/models)
- [Síntesis de voz de Gemini](https://ai.google.dev/gemini-api/docs/speech-generation)
