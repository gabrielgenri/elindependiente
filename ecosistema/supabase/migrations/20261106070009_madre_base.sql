-- ============================================================
-- El Independiente 2030 · Base compartida (Madre v2 + proxy IA)
-- Ejecutar en Supabase > SQL Editor. Es idempotente.
-- ============================================================

-- 1) PERFILES Y ROLES -----------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  rol text not null default 'redactor'
    check (rol in ('director','editor','redactor','reportero')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "perfil_propio_lectura" on public.profiles;
create policy "perfil_propio_lectura" on public.profiles
  for select to authenticated using (id = auth.uid());

-- Alta automática del perfil al crear un usuario
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Perfiles de usuarios que ya existían
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Rol del usuario actual (para usar en políticas de todos los módulos)
create or replace function public.rol_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.profiles where id = auth.uid()
$$;

-- 2) USO DE IA (solo el service role del proxy escribe/lee) ---
create table if not exists public.ia_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  modulo text,
  model text,
  prompt_tokens integer,
  output_tokens integer,
  search boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ia_usage_user_fecha_idx
  on public.ia_usage (user_id, created_at desc);

alter table public.ia_usage enable row level security;
-- Sin políticas a propósito: los clientes no pueden leer ni escribir.

-- 3) PIEZAS (contrato JSON "Pieza") ----------------------------
create table if not exists public.piezas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  titulo text not null default '',
  hecho text not null default '',
  tono text,
  eje smallint check (eje between 1 and 7),
  departamento text,
  estado text not null default 'borrador'
    check (estado in ('borrador','revisado','publicado')),
  formatos jsonb not null default '{}'::jsonb,
  estructura jsonb not null default '{}'::jsonb,
  fuentes jsonb not null default '[]'::jsonb,
  verificacion jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists piezas_estado_idx on public.piezas (estado, created_at desc);
create index if not exists piezas_user_idx on public.piezas (user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists piezas_updated_at on public.piezas;
create trigger piezas_updated_at
  before update on public.piezas
  for each row execute function public.set_updated_at();

alter table public.piezas enable row level security;

-- Todo el equipo autenticado puede leer las piezas
drop policy if exists "piezas_lectura_equipo" on public.piezas;
create policy "piezas_lectura_equipo" on public.piezas
  for select to authenticated using (true);

-- Cada usuario crea piezas a su nombre
drop policy if exists "piezas_alta_propia" on public.piezas;
create policy "piezas_alta_propia" on public.piezas
  for insert to authenticated with check (user_id = auth.uid());

-- Edita el autor, o un editor/director
drop policy if exists "piezas_edicion" on public.piezas;
create policy "piezas_edicion" on public.piezas
  for update to authenticated
  using (user_id = auth.uid() or public.rol_actual() in ('editor','director'))
  with check (user_id = auth.uid() or public.rol_actual() in ('editor','director'));

-- Elimina el autor, o el director
drop policy if exists "piezas_baja" on public.piezas;
create policy "piezas_baja" on public.piezas
  for delete to authenticated
  using (user_id = auth.uid() or public.rol_actual() = 'director');

-- Solo editor/director pueden dejar una pieza en "publicado"
create or replace function public.piezas_control_publicacion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'publicado'
     and (tg_op = 'INSERT' or old.estado is distinct from 'publicado')
     and coalesce(public.rol_actual(), '') not in ('editor','director') then
    raise exception 'Solo un editor o el director puede publicar una pieza';
  end if;
  return new;
end;
$$;

drop trigger if exists piezas_publicacion on public.piezas;
create trigger piezas_publicacion
  before insert or update on public.piezas
  for each row execute function public.piezas_control_publicacion();

-- 4) ASCENSO DE ROLES (ejecutar a mano para tu equipo) ---------
-- update public.profiles set rol = 'director' where email = 'tu-correo@dominio.com';
-- update public.profiles set rol = 'editor'   where email = 'editor@dominio.com';

-- Privilegios mínimos: el control de rol solo lo consulta el equipo autenticado.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.piezas_control_publicacion() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon;
revoke all on function public.rol_actual() from public, anon;
grant execute on function public.rol_actual() to authenticated;
revoke all on table public.ia_usage from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.piezas to authenticated;
grant execute on function public.set_updated_at() to authenticated;
