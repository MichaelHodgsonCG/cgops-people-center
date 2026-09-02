-- ============================================================================
-- Job descriptions — the documents applicants acknowledge in the TM hiring
-- flow (people_center_application_acks doc='job_description'), now stored
-- digitally and editable in the Hiring section. Seeded from the 2017 CG
-- description PDFs (Server, Line/Prep Cook, Host, Dishwasher, Bartender);
-- seed itself ran via execute_sql (data, not DDL).
--
-- One document per role title (company-wide, not per location). No
-- position_id link yet: 'Line/Prep Cook' spans two catalog positions, so the
-- mapping decision waits for the public form work.
--
-- RLS: any signed-in user may read (job descriptions are not sensitive and
-- future features reference them); writes are executive/admin. ZERO anon
-- policies — applicants will get the document through the intake edge
-- function (service role), same shape as the rest of hiring.
-- Idempotent.
-- ============================================================================

create table if not exists public.people_center_job_descriptions (
  id uuid primary key default gen_random_uuid(),
  role_title text not null,
  department text not null default '',
  reports_to text not null default '',
  body text not null,
  source_file text not null default '', -- original PDF this was digitised from
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);
create unique index if not exists people_center_job_descriptions_role_uq
  on public.people_center_job_descriptions (lower(role_title));

alter table public.people_center_job_descriptions enable row level security;

drop policy if exists people_center_job_descriptions_select on public.people_center_job_descriptions;
create policy people_center_job_descriptions_select
  on public.people_center_job_descriptions for select to authenticated
  using (true);

drop policy if exists people_center_job_descriptions_write on public.people_center_job_descriptions;
create policy people_center_job_descriptions_write
  on public.people_center_job_descriptions for all to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));
