-- ============================================================================
-- Uniform & grooming standards — the second document of the hiring
-- acknowledgement pair (people_center_application_acks doc='uniform_grooming'),
-- stored digitally per BRAND + audience (FOH/BOH): unlike job descriptions
-- these differ by restaurant brand (Wildcraft, The Bauer Kitchen, … more
-- coming). Editable in the Hiring section; every save bumps the version.
-- Seed ran via execute_sql (data, not DDL).
--
-- RLS matches job descriptions: any signed-in user reads, executive/admin
-- writes, ZERO anon policies (applicants get the document via the intake
-- edge function when it goes live).
-- Idempotent.
-- ============================================================================

create table if not exists public.people_center_uniform_standards (
  id uuid primary key default gen_random_uuid(),
  brand text not null,            -- e.g. Wildcraft, The Bauer Kitchen
  audience text not null default '', -- FOH / BOH / '' (whole-house)
  title text not null,
  body text not null,
  source_file text not null default '', -- original document this was digitised from
  effective text not null default '',   -- as printed on the document, e.g. 'Feb 2026'
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);
create unique index if not exists people_center_uniform_standards_uq
  on public.people_center_uniform_standards (lower(brand), lower(audience), lower(title));

alter table public.people_center_uniform_standards enable row level security;

drop policy if exists people_center_uniform_standards_select on public.people_center_uniform_standards;
create policy people_center_uniform_standards_select
  on public.people_center_uniform_standards for select to authenticated
  using (true);

drop policy if exists people_center_uniform_standards_write on public.people_center_uniform_standards;
create policy people_center_uniform_standards_write
  on public.people_center_uniform_standards for all to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));
