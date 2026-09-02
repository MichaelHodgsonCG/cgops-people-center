-- ============================================================================
-- Patterned interviews (TM hiring, Phase 2 slice) — the 2026 BOH/FOH hourly
-- patterned interview instruments, stored as structured templates and used
-- by managers to record scored interviews against applications.
--
--   * Templates: 10 questions, each creditable answer = 1 point; per-role
--     pass thresholds (BOH: D min 20, C min 27; FOH: H min 24, S&B min 30).
--     Editable in the UI by executive/admin; every save bumps the version.
--     Seed ran via execute_sql (data, not DDL).
--   * Recorded interviews SNAPSHOT the template into the row (same pattern
--     as location_name on applications): the legal record stays exactly what
--     the interviewer saw, even after the template is edited.
--
-- RLS: templates readable by any signed-in user, written by executive/admin.
-- Recorded interviews follow the application-events shape: admin/executive
-- plus the configured reviewer for the application's position may read and
-- record; corrections are executive/admin only. ZERO anon policies.
-- Idempotent.
-- ============================================================================

create table if not exists public.people_center_interview_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  audience text not null default '', -- e.g. Back of House / Front of House
  intro text not null default '',    -- interviewer's opening script
  questions jsonb not null default '[]'::jsonb,  -- [{prompt, answers: [text]}]
  thresholds jsonb not null default '[]'::jsonb, -- [{label, min}]
  source_file text not null default '',
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);
create unique index if not exists people_center_interview_templates_name_uq
  on public.people_center_interview_templates (lower(name));

create table if not exists public.people_center_application_interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.people_center_applications (id) on delete cascade,
  template_id uuid references public.people_center_interview_templates (id) on delete set null,
  template jsonb not null, -- snapshot: {name, version, intro, questions, thresholds}
  answers jsonb not null,  -- index-aligned: [{picked: [int], alt_note, alt_credit}]
  score integer not null,
  notes text not null default '',
  interviewer_person_id uuid,
  interviewer_name text not null,
  conducted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists people_center_application_interviews_app
  on public.people_center_application_interviews (application_id, conducted_at);

alter table public.people_center_interview_templates enable row level security;
alter table public.people_center_application_interviews enable row level security;

drop policy if exists people_center_interview_templates_select on public.people_center_interview_templates;
create policy people_center_interview_templates_select
  on public.people_center_interview_templates for select to authenticated
  using (true);

drop policy if exists people_center_interview_templates_write on public.people_center_interview_templates;
create policy people_center_interview_templates_write
  on public.people_center_interview_templates for all to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));

drop policy if exists people_center_application_interviews_select on public.people_center_application_interviews;
create policy people_center_application_interviews_select
  on public.people_center_application_interviews for select to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_application_interviews.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  );

drop policy if exists people_center_application_interviews_insert on public.people_center_application_interviews;
create policy people_center_application_interviews_insert
  on public.people_center_application_interviews for insert to authenticated
  with check (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_application_interviews.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  );

drop policy if exists people_center_application_interviews_update on public.people_center_application_interviews;
create policy people_center_application_interviews_update
  on public.people_center_application_interviews for update to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));
