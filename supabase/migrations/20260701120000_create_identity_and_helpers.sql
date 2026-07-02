-- ============================================================================
-- Migration: create_identity_and_helpers
-- Phase 0 (Skeleton) — identity layer and RLS helpers.
--
-- Contract: docs/ARCHITECTURE_REVIEW.md §8 deliverable 3 (decisions D1/D2
-- approved 2026-07-01); patterns per docs/CGOPS_FOUNDATIONS.md §3 and §10.
--
-- Creates:
--   * citext extension — case-insensitive email uniqueness.
--   * user_profiles — the app-level login record: auth link, email, app role
--       (text CHECK, five-role vocabulary; only 'admin' is enforced in
--       Phase 0). people-records-separate-from-auth: person_id will reference
--       people(id) once Phase 1 creates that table (FK added then).
--   * user_scopes — region/location scope rows per auth user. region_id and
--       location_id are bare uuids until Phase 1 creates the org reference
--       tables (FKs added then).
--       user_profiles + user_scopes are the LOCAL PROJECTION MODEL: when
--       CGOPS becomes the permission authority, these become a synced
--       projection of CGOPS grants; RLS remains the local enforcement layer.
--   * handle_new_user() + on_auth_user_created trigger — profile row created
--       on signup, default role 'viewer'.
--   * is_admin() — SECURITY DEFINER STABLE, SET search_path = public; the
--       recursion-safe RLS helper (the CGOPS is_admin() lesson).
--   * current_person_id() — resolves auth.uid() → user_profiles.person_id.
--       Actor-identity convention (review C2): domain actor columns store
--       people.id, resolved through this helper — attribution survives the
--       future CGOPS SSO swap.
--   * set_updated_at() — touch trigger for the audit columns house style.
--
-- Security: RLS enabled on every table, deny-by-default; policies grant to
-- 'authenticated' only; no anon policies of any kind.
-- Idempotent: IF NOT EXISTS guards, CREATE OR REPLACE, drop-then-create for
-- triggers and policies. Safe to run twice.
-- ============================================================================

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  email citext not null unique,
  display_name text,
  role text not null default 'viewer'
    check (role in ('admin', 'executive', 'regional_leader', 'location_leader', 'viewer')),
  person_id uuid, -- → people(id); FK added in Phase 1 when people exists
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

create table if not exists public.user_scopes (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  region_id uuid,   -- → regions(id); FK added in Phase 1
  location_id uuid, -- → locations(id); FK added in Phase 1
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  constraint user_scopes_has_scope check (region_id is not null or location_id is not null)
);

create index if not exists user_scopes_auth_user_id_idx
  on public.user_scopes (auth_user_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where auth_user_id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.current_person_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select person_id
  from public.user_profiles
  where auth_user_id = auth.uid();
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (auth_user_id, email)
  values (new.id, new.email)
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_user_scopes_updated_at on public.user_scopes;
create trigger set_user_scopes_updated_at
  before update on public.user_scopes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — deny-by-default; authenticated only
-- ---------------------------------------------------------------------------

alter table public.user_profiles enable row level security;
alter table public.user_scopes enable row level security;

-- user_profiles: read own row or admin; only admins change profiles (role
-- grants are admin acts). No client INSERT policy — rows are created by the
-- handle_new_user() trigger. No DELETE policy — profiles leave via the
-- auth.users cascade.
drop policy if exists user_profiles_select on public.user_profiles;
create policy user_profiles_select on public.user_profiles
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin());

drop policy if exists user_profiles_update on public.user_profiles;
create policy user_profiles_update on public.user_profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- user_scopes: read own rows or admin; all writes admin only.
drop policy if exists user_scopes_select on public.user_scopes;
create policy user_scopes_select on public.user_scopes
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin());

drop policy if exists user_scopes_insert on public.user_scopes;
create policy user_scopes_insert on public.user_scopes
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists user_scopes_update on public.user_scopes;
create policy user_scopes_update on public.user_scopes
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists user_scopes_delete on public.user_scopes;
create policy user_scopes_delete on public.user_scopes
  for delete to authenticated
  using (public.is_admin());
