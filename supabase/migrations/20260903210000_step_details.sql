-- Structured step logistics (Michael, 2026-09-03: "add those as structured
-- fields like the reference form"). One row per (application, stage) holding
-- the small fill-ins from the CG Mgmt Interview Process tabs that aren't
-- immutable records: Where (In person / Zoom) on the culture, financial and
-- final interviews, the TAIS link, and the offer's Signed back?. Logistics
-- change (a Zoom call becomes in-person), so unlike interviews and reference
-- checks this row is UPDATABLE by the same people who may write it; every
-- save is audited. No delete policy.

create table if not exists public.people_center_step_details (
  application_id uuid not null references public.people_center_applications(id) on delete cascade,
  stage text not null,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text not null default '',
  primary key (application_id, stage)
);

alter table public.people_center_step_details enable row level security;

create policy people_center_step_details_select
  on public.people_center_step_details for select
  using (
    public.people_center_current_role() in ('admin', 'executive')
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_step_details.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  );

create policy people_center_step_details_insert
  on public.people_center_step_details for insert
  with check (
    public.people_center_current_role() in ('admin', 'executive')
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_step_details.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  );

create policy people_center_step_details_update
  on public.people_center_step_details for update
  using (
    public.people_center_current_role() in ('admin', 'executive')
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_step_details.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  )
  with check (
    public.people_center_current_role() in ('admin', 'executive')
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_step_details.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  );
