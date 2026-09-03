-- ============================================================================
-- 1) Hiring watch list — the CG "Black List" (do not interview/hire/re-hire)
--    and "Grey List" (proceed with caution), digitised from Meg's Aug 2026
--    workbook. HIGHLY SENSITIVE: frank notes about named people.
--    * Table RLS: admin + executive ONLY — same altitude as restricted notes.
--    * people_center_watchlist_check(name): SECURITY DEFINER, callable by any
--      signed-in user, returns ONLY (list, matched_name) on an exact
--      case-insensitive name match — enough for the application panel to warn
--      a reviewer "contact HQ before proceeding" without leaking a word of
--      the notes. No fuzzy matching: a false "may be blacklisted" flag is
--      worse than asking HQ.
--
-- 2) Management hiring guides — the CG Mgmt Interview Process (Mar 2026):
--    culture interview, reference checks, tiered financial interviews with
--    the Gourmet Haven case study + P&L, TAIS, final interview, offer.
--    Readable by the roles that can open Hiring (manager altitude and up);
--    written by executive/admin. ZERO anon policies on everything here.
--    Seeds ran via execute_sql (data, not DDL).
-- Idempotent.
-- ============================================================================

create table if not exists public.people_center_hiring_watchlist (
  id uuid primary key default gen_random_uuid(),
  list text not null check (list in ('black', 'grey')),
  full_name text not null,
  role text not null default '',
  former_cg text not null default '', -- former CG Mgr/TM? (as recorded)
  notes text not null default '',
  noted_date text not null default '', -- as recorded ('Summer 2023', 'Many'…)
  noted_by text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);
create index if not exists people_center_hiring_watchlist_name
  on public.people_center_hiring_watchlist (lower(full_name));

alter table public.people_center_hiring_watchlist enable row level security;

drop policy if exists people_center_hiring_watchlist_all on public.people_center_hiring_watchlist;
create policy people_center_hiring_watchlist_all
  on public.people_center_hiring_watchlist for all to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));

create or replace function public.people_center_watchlist_check(p_name text)
returns table (list text, matched_name text)
language sql
security definer
stable
set search_path = public
as $$
  select w.list, w.full_name
  from public.people_center_hiring_watchlist w
  where w.active
    and lower(btrim(w.full_name)) = lower(btrim(coalesce(p_name, '')))
$$;
revoke all on function public.people_center_watchlist_check(text) from public;
grant execute on function public.people_center_watchlist_check(text) to authenticated;

create table if not exists public.people_center_hiring_guides (
  id uuid primary key default gen_random_uuid(),
  sort integer not null default 0,
  title text not null,
  subtitle text not null default '', -- e.g. which roles the step applies to
  body text not null,
  source_file text not null default '',
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);
create unique index if not exists people_center_hiring_guides_title_uq
  on public.people_center_hiring_guides (lower(title));

alter table public.people_center_hiring_guides enable row level security;

drop policy if exists people_center_hiring_guides_select on public.people_center_hiring_guides;
create policy people_center_hiring_guides_select
  on public.people_center_hiring_guides for select to authenticated
  using (
    public.people_center_current_role() = any
      (array['admin', 'executive', 'regional_leader', 'location_leader'])
  );

drop policy if exists people_center_hiring_guides_write on public.people_center_hiring_guides;
create policy people_center_hiring_guides_write
  on public.people_center_hiring_guides for all to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));
