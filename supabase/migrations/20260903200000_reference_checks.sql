-- Reference Check Form (Michael, 2026-09-03: the fillable right half of the
-- "2. Reference Checks" tab in CG Mgmt Interview Process Mar 2026 was not
-- yet baked in). One row per reference call, recorded inside the Reference
-- check step of the guided workflow — both flows use it (mgmt needs a
-- minimum of 2 positive, at least 1 self-sourced; TM needs 2 positive).
--
-- Same access shape as recorded interviews (they are the same kind of
-- record): admin/executive plus the configured reviewer for the position may
-- read and insert; UPDATE is admin/executive only; no delete policy — a
-- completed reference check is part of the legal hiring record.

create table if not exists public.people_center_reference_checks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.people_center_applications(id) on delete cascade,
  source text not null default '',              -- 'Candidate provided' | 'CG sourced'
  contact_person text not null default '',
  company text not null default '',
  phone text not null default '',
  contact_position text not null default '',    -- the reference's own position
  position_confirmed text not null default '',  -- "Confirm Position" — what they confirmed the candidate did
  job_performance text not null default '',
  attendance text not null default '',          -- attendance / punctuality
  attitude text not null default '',
  opportunities_concerns text not null default '',
  would_rehire text not null default '',        -- 'Yes' | 'No'
  other_comments text not null default '',
  checked_on date,
  checked_by uuid,
  checked_by_name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.people_center_reference_checks enable row level security;

create policy people_center_reference_checks_select
  on public.people_center_reference_checks for select
  using (
    public.people_center_current_role() in ('admin', 'executive')
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_reference_checks.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  );

create policy people_center_reference_checks_insert
  on public.people_center_reference_checks for insert
  with check (
    public.people_center_current_role() in ('admin', 'executive')
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_reference_checks.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  );

create policy people_center_reference_checks_update
  on public.people_center_reference_checks for update
  using (public.people_center_current_role() in ('admin', 'executive'))
  with check (public.people_center_current_role() in ('admin', 'executive'));
