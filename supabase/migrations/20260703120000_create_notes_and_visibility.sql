-- ============================================================================
-- Migration: create_notes_and_visibility
-- Phase 2 — the four... THREE-category note system with database-enforced
-- visibility, audited sensitive reads, and the app-access tightening.
--
-- ⚠ Apply to the CGOPS Platform Supabase project. Standalone against the
-- current people_center_* state; never replay the historical lineage there.
--
-- Contract: ARCHITECTURE_REVIEW.md C1/D5/D8/D3/D6 as approved 2026-07-03
-- (ADR 0007):
--   * Categories are CONTENT TYPES: 'leadership' | 'development' |
--     'relationship'. 'Restricted' is a VISIBILITY level, not a category.
--   * Visibility levels: 'leadership' (regional leaders and above), 'hq'
--     (executives + admins), 'restricted' (author + admins + executives).
--     'chain' is deferred until reporting lines are populated (D3).
--   * Relationship notes: minimum visibility 'hq' (D5 default), and
--     voluntarily_shared must be true — enforced by CHECK, not UI.
--   * Self-view (D6): nobody reads notes about themselves (except notes
--     they authored) — enforced in RLS and in the definer functions.
--   * Read audit (D8): relationship and restricted notes are readable ONLY
--     through definer functions that write a 'view' row to
--     people_center_audit_log — one row per person-panel fetch. Direct
--     SELECT on the table never returns them (except to their author).
--   * Append-only: INSERT + SELECT policies only. No UPDATE/DELETE. The
--     audited relationship purge ships with the retention policy (owner:
--     Michael; restricted stays admin/executive-only until then).
--
-- Also creates:
--   * people_center_current_role() — role via the Phase A bridge: CGOPS
--     platform admins are 'admin'; otherwise the compat profile role.
--   * people_center_has_app_access() — closes the runbook's "shared
--     authenticated pool" gap: directory/org/assignment SELECT policies are
--     re-scoped from `using (true)` to People-Center-role-holders only.
--
-- Events note (ADR 0003): leadership/development note creation emits a
-- pointers-only event from app code; relationship and restricted-visibility
-- notes emit NO events.
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, drop-then-create policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.people_center_current_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select case
    when public.people_center_is_admin() then 'admin'
    else (
      select role from public.people_center_user_profiles
      where auth_user_id = auth.uid()
    )
  end;
$$;

create or replace function public.people_center_has_app_access()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.people_center_current_role() is not null;
$$;

grant execute on function public.people_center_current_role() to authenticated;
grant execute on function public.people_center_has_app_access() to authenticated;

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------

create table if not exists public.people_center_notes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people_center_people (id),
  -- Author: people.id when the author is a roster person; HQ authors may not
  -- be. author_auth_uid + author_name make attribution complete either way
  -- (pragmatic extension of ADR 0002 for the shared-project world).
  author_person_id uuid references public.people_center_people (id),
  author_auth_uid uuid not null default auth.uid(),
  author_name text not null,
  category text not null
    check (category in ('leadership', 'development', 'relationship')),
  visibility text not null
    check (visibility in ('leadership', 'hq', 'restricted')),
  body text not null check (length(trim(body)) > 0),
  noted_on date not null default current_date,
  voluntarily_shared boolean not null default false,
  created_at timestamptz not null default now(),
  -- Relationship notes are hq-minimum and voluntary BY CONSTRAINT (C1/D5)
  constraint people_center_notes_relationship_visibility
    check (category <> 'relationship' or visibility in ('hq', 'restricted')),
  constraint people_center_notes_relationship_voluntary
    check (category <> 'relationship' or voluntarily_shared)
);

create index if not exists people_center_notes_person_idx
  on public.people_center_notes (person_id, noted_on desc);
create index if not exists people_center_notes_author_idx
  on public.people_center_notes (author_auth_uid);

alter table public.people_center_notes enable row level security;

-- INSERT: note-writer roles only; the author binding is not falsifiable.
drop policy if exists people_center_notes_insert on public.people_center_notes;
create policy people_center_notes_insert on public.people_center_notes
  for insert to authenticated
  with check (
    public.people_center_current_role()
      in ('admin', 'executive', 'regional_leader', 'location_leader')
    and author_auth_uid = auth.uid()
  );

-- SELECT: own-authored notes always; otherwise only leadership/development
-- content, never restricted visibility, never about yourself (D6), at the
-- role the visibility level demands. Relationship and restricted content is
-- NOT readable here — it flows through the audited functions below.
drop policy if exists people_center_notes_select on public.people_center_notes;
create policy people_center_notes_select on public.people_center_notes
  for select to authenticated
  using (
    author_auth_uid = auth.uid()
    or (
      person_id is distinct from public.people_center_current_person_id()
      and category in ('leadership', 'development')
      and (
        (visibility = 'leadership'
          and public.people_center_current_role()
            in ('admin', 'executive', 'regional_leader'))
        or (visibility = 'hq'
          and public.people_center_current_role() in ('admin', 'executive'))
      )
    )
  );
-- no UPDATE/DELETE policies: append-only.

-- ---------------------------------------------------------------------------
-- Audited sensitive reads (D8)
-- ---------------------------------------------------------------------------

-- Relationship panel (cheat sheet): hq audience; ONE 'view' audit row per
-- fetch. Returns hq-visibility relationship notes; restricted-visibility
-- ones come only from the restricted function below.
create or replace function public.people_center_get_relationship_notes(p_person_id uuid)
returns setof public.people_center_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.people_center_current_role();
  v_self boolean := p_person_id is not distinct from public.people_center_current_person_id();
begin
  -- POSITIVE access check only — a NULL role (no People Center access) must
  -- never fall through to the audited full read. Self-view (D6) and non-hq
  -- callers get exactly the relationship notes they authored, nothing more.
  if v_self or v_role is null or v_role not in ('admin', 'executive') then
    return query
      select * from public.people_center_notes
      where person_id = p_person_id and category = 'relationship'
        and author_auth_uid = auth.uid()
      order by noted_on desc, created_at desc;
    return;
  end if;

  insert into public.people_center_audit_log
    (actor_person_id, actor_auth_uid, actor_name, action,
     entity_type, entity_id, entity_label, summary)
  select
    public.people_center_current_person_id(), auth.uid(),
    coalesce(
      (select coalesce(display_name, email::text)
       from public.people_center_user_profiles where auth_user_id = auth.uid()),
      (select email from auth.users where id = auth.uid()),
      'unknown'),
    'view', 'person_relationship_panel', p_person_id,
    (select full_name from public.people_center_people where id = p_person_id),
    'Viewed relationship notes panel';

  return query
    select * from public.people_center_notes
    where person_id = p_person_id
      and category = 'relationship'
      and visibility = 'hq'
    order by noted_on desc, created_at desc;
end;
$$;

-- Restricted notes (any category, visibility = 'restricted'): author +
-- admins + executives; ONE 'view' audit row per fetch.
create or replace function public.people_center_get_restricted_notes(p_person_id uuid)
returns setof public.people_center_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.people_center_current_role();
  v_self boolean := p_person_id is not distinct from public.people_center_current_person_id();
begin
  -- Positive access check only (see relationship function).
  if v_self or v_role is null or v_role not in ('admin', 'executive') then
    return query
      select * from public.people_center_notes
      where person_id = p_person_id and visibility = 'restricted'
        and author_auth_uid = auth.uid()
      order by noted_on desc, created_at desc;
    return;
  end if;

  insert into public.people_center_audit_log
    (actor_person_id, actor_auth_uid, actor_name, action,
     entity_type, entity_id, entity_label, summary)
  select
    public.people_center_current_person_id(), auth.uid(),
    coalesce(
      (select coalesce(display_name, email::text)
       from public.people_center_user_profiles where auth_user_id = auth.uid()),
      (select email from auth.users where id = auth.uid()),
      'unknown'),
    'view', 'person_restricted_notes', p_person_id,
    (select full_name from public.people_center_people where id = p_person_id),
    'Viewed restricted notes';

  return query
    select * from public.people_center_notes
    where person_id = p_person_id
      and visibility = 'restricted'
    order by noted_on desc, created_at desc;
end;
$$;

grant execute on function public.people_center_get_relationship_notes(uuid) to authenticated;
grant execute on function public.people_center_get_restricted_notes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Close the shared-authenticated-pool gap (runbook "known consequences"):
-- SELECT on people/org/assignment/mapping tables now requires a People
-- Center role (compat profile row or CGOPS platform admin), not merely any
-- CGOPS-authenticated session.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'people_center_people',
    'people_center_position_assignments',
    'people_center_concepts',
    'people_center_regions',
    'people_center_departments',
    'people_center_locations',
    'people_center_positions',
    'people_center_location_mappings',
    'people_center_position_mappings'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.people_center_has_app_access())',
      t || '_select', t);
  end loop;
end;
$$;
