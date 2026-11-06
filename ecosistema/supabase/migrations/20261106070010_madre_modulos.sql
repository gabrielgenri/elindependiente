-- Madre v3 + Biblioteca Riojana · Modelo integrado
-- Requiere 20261106070009_madre_base.sql (perfiles, roles y set_updated_at).

create extension if not exists vector with schema extensions;

-- Archivo histórico: embeddings de Gemini gemini-embedding-001 (768 dimensiones).
create table if not exists public.notas (
  id bigint generated always as identity primary key,
  titulo text not null,
  cuerpo text not null,
  fecha date,
  seccion text,
  url text,
  embedding extensions.vector(768),
  created_at timestamptz not null default now()
);
create index if not exists notas_embedding_idx
  on public.notas using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists notas_fecha_idx on public.notas (fecha desc);
alter table public.notas enable row level security;
drop policy if exists "redaccion lee notas" on public.notas;
create policy "redaccion lee notas" on public.notas
  for select to authenticated using (true);
drop policy if exists "redaccion escribe notas" on public.notas;
create policy "redaccion escribe notas" on public.notas
  for insert to authenticated with check (true);
grant select, insert on public.notas to authenticated;

create or replace function public.match_notas(
  query_embedding extensions.vector(768),
  match_count int default 8,
  min_similarity float default 0.3
)
returns table (
  id bigint, titulo text, cuerpo text, fecha date, seccion text, url text, similarity float
)
language sql stable
set search_path = public, extensions
as $$
  select n.id, n.titulo, n.cuerpo, n.fecha, n.seccion, n.url,
         1 - (n.embedding <=> query_embedding) as similarity
  from public.notas n
  where n.embedding is not null
    and 1 - (n.embedding <=> query_embedding) >= min_similarity
  order by n.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 50);
$$;
revoke all on function public.match_notas(extensions.vector, int, float) from public, anon;
grant execute on function public.match_notas(extensions.vector, int, float) to authenticated;

-- Producciones Madre: los usuarios autenticados de la redacción comparten el archivo.
create table if not exists public.producciones (
  id bigint generated always as identity primary key,
  tema text not null,
  tono text,
  departamento text,
  formatos jsonb not null default '{}'::jsonb,
  evaluacion jsonb,
  audio_path text,
  wp_post_id bigint,
  estado text not null default 'borrador'
    check (estado in ('borrador','en_revision','aprobado','publicado')),
  created_at timestamptz not null default now()
);
alter table public.producciones add column if not exists departamento text;
create index if not exists producciones_created_idx on public.producciones (created_at desc);
alter table public.producciones enable row level security;
drop policy if exists "redaccion producciones" on public.producciones;
create policy "redaccion producciones" on public.producciones
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.producciones to authenticated;

-- Transcripciones de entrevistas y reporteros ciudadanos.
create table if not exists public.transcripciones (
  id bigint generated always as identity primary key,
  origen text,
  archivo text,
  texto text not null,
  created_at timestamptz not null default now()
);
create index if not exists transcripciones_created_idx on public.transcripciones (created_at desc);
alter table public.transcripciones enable row level security;
drop policy if exists "redaccion transcripciones" on public.transcripciones;
create policy "redaccion transcripciones" on public.transcripciones
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.transcripciones to authenticated;

-- Biblioteca: el vínculo apunta a producciones Madre v3 (id bigint).
create table if not exists public.biblioteca_fichas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null default '',
  slug text not null,
  cluster text not null default 'sociedad'
    check (cluster in ('energia','vitivinicultura','turismo','mineria','produccion',
                       'cultura','politica','sociedad','ambiente')),
  tramo text not null default 'activo'
    check (tramo in ('flujo','profundidad','activo')),
  departamento text,
  resumen text not null default '',
  estructura jsonb not null default '{}'::jsonb,
  fuentes jsonb not null default '[]'::jsonb,
  verificacion jsonb not null default '[]'::jsonb,
  estado text not null default 'borrador'
    check (estado in ('borrador','revisado','publicado')),
  pieza_id bigint references public.producciones(id) on delete set null,
  relacionadas text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists biblioteca_fichas_slug_uidx on public.biblioteca_fichas (slug);
create index if not exists biblioteca_fichas_cluster_idx on public.biblioteca_fichas (cluster, estado);
create index if not exists biblioteca_fichas_user_idx on public.biblioteca_fichas (user_id);
drop trigger if exists biblioteca_fichas_updated_at on public.biblioteca_fichas;
create trigger biblioteca_fichas_updated_at before update on public.biblioteca_fichas
  for each row execute function public.set_updated_at();
alter table public.biblioteca_fichas enable row level security;
drop policy if exists "fichas_lectura_equipo" on public.biblioteca_fichas;
create policy "fichas_lectura_equipo" on public.biblioteca_fichas
  for select to authenticated using (true);
drop policy if exists "fichas_alta_propia" on public.biblioteca_fichas;
create policy "fichas_alta_propia" on public.biblioteca_fichas
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "fichas_edicion" on public.biblioteca_fichas;
create policy "fichas_edicion" on public.biblioteca_fichas
  for update to authenticated
  using ((user_id = (select auth.uid()) and estado <> 'publicado')
         or public.rol_actual() in ('editor','director'))
  with check ((user_id = (select auth.uid()) and estado <> 'publicado')
              or public.rol_actual() in ('editor','director'));
drop policy if exists "fichas_baja" on public.biblioteca_fichas;
create policy "fichas_baja" on public.biblioteca_fichas
  for delete to authenticated
  using ((user_id = (select auth.uid()) and estado <> 'publicado')
         or public.rol_actual() = 'director');

create or replace function public.fichas_control_publicacion()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.estado = 'publicado' then
    if tg_op = 'INSERT' or old.estado is distinct from 'publicado' then
      if tg_op = 'INSERT' or old.estado is distinct from 'revisado' then
        raise exception 'La ficha debe pasar por revisado antes de publicarse';
      end if;
      if coalesce(public.rol_actual(), '') not in ('editor','director') then
        raise exception 'Solo un editor o el director puede publicar una ficha';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists fichas_publicacion on public.biblioteca_fichas;
create trigger fichas_publicacion before insert or update on public.biblioteca_fichas
  for each row execute function public.fichas_control_publicacion();
revoke all on function public.fichas_control_publicacion() from public, anon, authenticated;
grant select, insert, update, delete on public.biblioteca_fichas to authenticated;

-- Audios privados; el acceso queda limitado a usuarios autenticados del equipo.
insert into storage.buckets (id, name, public)
values ('podcasts', 'podcasts', false), ('entrevistas', 'entrevistas', false)
on conflict (id) do update set public = false;
drop policy if exists "redaccion audios" on storage.objects;
create policy "redaccion audios" on storage.objects for all to authenticated
  using (bucket_id in ('podcasts','entrevistas'))
  with check (bucket_id in ('podcasts','entrevistas'));
