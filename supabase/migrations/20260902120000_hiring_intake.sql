-- ============================================================================
-- Team Member hiring — Phase 1: the record and the retention.
-- Work order: bus artifact a1164da2 (Ember, 2026-09-02); governing design note
-- 3c1695b7 incl. addendum + correction. TEAM MEMBER flow only — the
-- management flow is undocumented and explicitly out of scope.
--
-- SECURITY SHAPE (non-negotiable per the work order):
--   * ZERO policies for the anon role. The public form posts to an edge
--     function holding the service role; the database is never reachable
--     from the public surface. Tables that only the edge function touches
--     (tokens, rate hits) have RLS enabled and NO policies at all.
--   * An applicant is NOT a person and NOT a user: nothing here references
--     or creates people_center_people rows. Promotion to a person happens
--     deliberately, on hire (Phase 2+).
--
-- RETENTION (ruled, with a caveat):
--   * Clock = DATE OF SUBMISSION for every application in every state —
--     Michael's corrected ruling. First receipt stamps submitted_at; even a
--     draft/abandoned application has one, so nothing escapes the clock.
--   * The 3-YEAR figure comes from Michael's statement (ESA), NOT from a
--     verified read of the source PDF (its digits didn't decode). The purge
--     function exists but is NOT SCHEDULED: nothing deletes until the number
--     is verified against the original document and the written standard
--     (which currently mandates in-restaurant paper) is re-issued.
-- Idempotent.
-- ============================================================================

-- The human. Dedupe key for "have they applied here before" — never a person.
create table if not exists public.people_center_applicants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists people_center_applicants_email_uq
  on public.people_center_applicants (lower(email)) where email is not null;

-- The legal artifact under retention.
create table if not exists public.people_center_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.people_center_applicants (id) on delete cascade,
  location_id uuid references public.people_center_locations (id) on delete set null,
  location_name text not null, -- snapshot: the record outlives location rows
  desired_position text not null,
  position_id uuid references public.people_center_positions (id) on delete set null,
  source text not null default 'website'
    check (source in ('indeed', 'website', 'in_person', 'other')),
  status text not null default 'submitted'
    check (status in ('draft', 'submitted', 'screening', 'interview',
                      'reference_check', 'decision_pending', 'hired',
                      'not_hired', 'withdrawn')),
  complete boolean not null default false, -- "in full" verified server-side
  form jsonb not null default '{}'::jsonb, -- the application answers
  submitted_at timestamptz not null default now(), -- THE retention anchor
  -- 3 years pending verification against the original document; recorded per
  -- row so a corrected figure can be re-stamped without schema change.
  retention_purge_after date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);
create index if not exists people_center_applications_applicant
  on public.people_center_applications (applicant_id);
create index if not exists people_center_applications_status
  on public.people_center_applications (status);
create index if not exists people_center_applications_purge
  on public.people_center_applications (retention_purge_after);

-- Timestamped acknowledgements — first-class legal evidence, not checkboxes.
create table if not exists public.people_center_application_acks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.people_center_applications (id) on delete cascade,
  doc text not null check (doc in ('job_description', 'uniform_grooming')),
  acknowledged_at timestamptz not null default now(),
  unique (application_id, doc)
);

-- Who did what, when — the compliance evidence paper cannot produce.
create table if not exists public.people_center_application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.people_center_applications (id) on delete cascade,
  event text not null,
  actor_person_id uuid,
  actor_name text not null default 'system',
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists people_center_application_events_app
  on public.people_center_application_events (application_id, created_at);

-- Single-use, expiring return links. ONLY the hash is stored — a leaked table
-- cannot reconstruct a link. Edge-function-only: RLS on, no policies.
create table if not exists public.people_center_application_tokens (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.people_center_applications (id) on delete cascade,
  token_hash text not null unique, -- sha256 hex of the raw token
  purpose text not null default 'complete_form',
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Rate limiting for the public intake. Edge-function-only.
create table if not exists public.people_center_intake_hits (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index if not exists people_center_intake_hits_ip_at
  on public.people_center_intake_hits (ip, at);

-- The reviewer is DATA, not a role rule (Michael's ruling): hiring manager
-- varies by position, configured here.
create table if not exists public.people_center_hiring_reviewers (
  position_id uuid primary key references public.people_center_positions (id) on delete cascade,
  reviewer_person_id uuid not null references public.people_center_people (id) on delete cascade,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

-- --- RLS: no anon anywhere; internal read/write for HQ + configured reviewers

alter table public.people_center_applicants enable row level security;
alter table public.people_center_applications enable row level security;
alter table public.people_center_application_acks enable row level security;
alter table public.people_center_application_events enable row level security;
alter table public.people_center_application_tokens enable row level security;
alter table public.people_center_intake_hits enable row level security;
alter table public.people_center_hiring_reviewers enable row level security;
-- tokens + intake_hits: RLS on, NO policies — service role (edge fn) only.

drop policy if exists people_center_applications_select on public.people_center_applications;
create policy people_center_applications_select
  on public.people_center_applications for select to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or exists (
      select 1 from public.people_center_hiring_reviewers r
      where r.reviewer_person_id = public.people_center_current_person_id()
        and r.position_id = people_center_applications.position_id
    )
  );

drop policy if exists people_center_applications_update on public.people_center_applications;
create policy people_center_applications_update
  on public.people_center_applications for update to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or exists (
      select 1 from public.people_center_hiring_reviewers r
      where r.reviewer_person_id = public.people_center_current_person_id()
        and r.position_id = people_center_applications.position_id
    )
  )
  with check (true);

drop policy if exists people_center_applicants_select on public.people_center_applicants;
create policy people_center_applicants_select
  on public.people_center_applicants for select to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.applicant_id = people_center_applicants.id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  );

drop policy if exists people_center_application_acks_select on public.people_center_application_acks;
create policy people_center_application_acks_select
  on public.people_center_application_acks for select to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_application_acks.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  );

drop policy if exists people_center_application_events_select on public.people_center_application_events;
create policy people_center_application_events_select
  on public.people_center_application_events for select to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_application_events.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  );

drop policy if exists people_center_application_events_insert on public.people_center_application_events;
create policy people_center_application_events_insert
  on public.people_center_application_events for insert to authenticated
  with check (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or exists (
      select 1
      from public.people_center_applications a
      join public.people_center_hiring_reviewers r on r.position_id = a.position_id
      where a.id = people_center_application_events.application_id
        and r.reviewer_person_id = public.people_center_current_person_id()
    )
  );

drop policy if exists people_center_hiring_reviewers_select on public.people_center_hiring_reviewers;
create policy people_center_hiring_reviewers_select
  on public.people_center_hiring_reviewers for select to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or reviewer_person_id = public.people_center_current_person_id()
  );

drop policy if exists people_center_hiring_reviewers_write on public.people_center_hiring_reviewers;
create policy people_center_hiring_reviewers_write
  on public.people_center_hiring_reviewers for all to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));

-- --- Retention purge: built, admin-only, NOT scheduled (see header) ---------

create or replace function public.people_center_purge_expired_applications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if public.people_center_current_role() <> 'admin' then
    raise exception 'admin only';
  end if;
  delete from public.people_center_applications
  where retention_purge_after < current_date;
  get diagnostics n = row_count;
  -- applicants with no remaining applications carry no legal basis to keep
  delete from public.people_center_applicants ap
  where not exists (
    select 1 from public.people_center_applications a where a.applicant_id = ap.id
  );
  return n;
end;
$$;

revoke all on function public.people_center_purge_expired_applications() from public;
grant execute on function public.people_center_purge_expired_applications() to authenticated;
