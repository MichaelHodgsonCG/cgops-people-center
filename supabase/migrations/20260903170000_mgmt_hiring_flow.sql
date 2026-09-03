-- ============================================================================
-- Management hiring flow (Michael's direction, 2026-09-03) — the guided
-- workflow over the digitised CG Mgmt Interview Process (Mar 2026) with
-- CHECKS AND ACCOUNTABILITY at each step:
--
--   * Applications gain flow ('tm' | 'mgmt') and track ('foh' | 'boh' for
--     mgmt). Management stages join the status vocabulary: screening →
--     culture_interview → reference_check → financial_interview → tais →
--     final_interview → approvals → offer, then hired / not_hired /
--     withdrawn. One record system: retention, acks, events, watch-list all
--     apply to managers exactly as to TMs.
--   * Interview templates gain kind: 'scored' (patterned, points) or
--     'questionnaire' (free-text answers — the screening call). Recorded
--     answers snapshot the template as before.
--   * APPROVALS, per Michael: Megan and John approve all FOH managers; Todd
--     and Michael approve all BOH chefs; the executive step is final.
--     Required approvers are DATA (people_center_mgmt_approvers, per track).
--     An approval row can be inserted ONLY by the named approver themselves —
--     enforced by RLS, not UI courtesy — so the accountability is real and
--     personal. Approvals are immutable (no update/delete policies).
-- Seeds (approvers + Chef Screening Questions) ran via execute_sql.
-- Idempotent.
-- ============================================================================

alter table public.people_center_applications
  add column if not exists flow text not null default 'tm'
    check (flow in ('tm', 'mgmt'));
alter table public.people_center_applications
  add column if not exists track text
    check (track in ('foh', 'boh'));

alter table public.people_center_applications
  drop constraint if exists people_center_applications_status_check;
alter table public.people_center_applications
  add constraint people_center_applications_status_check
  check (status in (
    'draft', 'submitted', 'screening', 'interview', 'reference_check',
    'decision_pending', 'hired', 'not_hired', 'withdrawn',
    'culture_interview', 'financial_interview', 'tais', 'final_interview',
    'approvals', 'offer'
  ));

alter table public.people_center_interview_templates
  add column if not exists kind text not null default 'scored'
    check (kind in ('scored', 'questionnaire'));

-- Who must approve, per track — data, editable by executive/admin.
create table if not exists public.people_center_mgmt_approvers (
  id uuid primary key default gen_random_uuid(),
  track text not null check (track in ('foh', 'boh')),
  person_id uuid not null references public.people_center_people (id) on delete cascade,
  person_name text not null,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  unique (track, person_id)
);

alter table public.people_center_mgmt_approvers enable row level security;

drop policy if exists people_center_mgmt_approvers_select on public.people_center_mgmt_approvers;
create policy people_center_mgmt_approvers_select
  on public.people_center_mgmt_approvers for select to authenticated
  using (true);

drop policy if exists people_center_mgmt_approvers_write on public.people_center_mgmt_approvers;
create policy people_center_mgmt_approvers_write
  on public.people_center_mgmt_approvers for all to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));

-- The signatures. Personal by construction: INSERT requires that the row's
-- approver IS the signed-in person AND that person is a configured approver
-- for the application's track. Nobody signs for anybody else — not even an
-- admin. No UPDATE/DELETE policies: a recorded decision is immutable
-- (corrections = a new row telling the truth about the change).
create table if not exists public.people_center_application_approvals (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.people_center_applications (id) on delete cascade,
  approver_person_id uuid not null,
  approver_name text not null,
  decision text not null check (decision in ('approved', 'rejected')),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (application_id, approver_person_id)
);
create index if not exists people_center_application_approvals_app
  on public.people_center_application_approvals (application_id);

alter table public.people_center_application_approvals enable row level security;

drop policy if exists people_center_application_approvals_select on public.people_center_application_approvals;
create policy people_center_application_approvals_select
  on public.people_center_application_approvals for select to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_application_approvals.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
    or approver_person_id = public.people_center_current_person_id()
  );

drop policy if exists people_center_application_approvals_insert on public.people_center_application_approvals;
create policy people_center_application_approvals_insert
  on public.people_center_application_approvals for insert to authenticated
  with check (
    approver_person_id = public.people_center_current_person_id()
    and exists (
      select 1
      from public.people_center_mgmt_approvers ma
      join public.people_center_applications a on a.id = people_center_application_approvals.application_id
      where ma.person_id = people_center_application_approvals.approver_person_id
        and ma.track = a.track
    )
  );
