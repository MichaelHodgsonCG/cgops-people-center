-- ============================================================================
-- Migration: create_people_and_assignments
-- Phase 1 — the people master (talent view) and position assignments.
--
-- Contract: PRODUCT_BRIEF.md §5; CGOPS_FOUNDATIONS.md §7 (people references:
-- a People Center person requires neither a CGOPS login nor a Push record);
-- ADR 0002 (actor identity).
--
-- Creates:
--   * people — the master record for the talent/relationship view of a
--     person. person ≠ auth user ≠ employee record: auth_user_id is nullable
--     (linked when the person gets a login); external_refs jsonb carries
--     { cgops_user_id, push_employee_id } when known. No salary, no payroll,
--     no employment-record fields — that is Push's domain, permanently.
--     home_city is voluntary personal geography — NEVER populated from
--     import company/business-unit fields.
--   * position_assignments — person ↔ position ↔ location, with history
--     (ended_on null = current). started_on is NULLABLE: assignments created
--     from the initial roster sync predate the system and have unknown start
--     dates. At most one CURRENT PRIMARY assignment per person (partial
--     unique index).
--   * FK backfill: user_profiles.person_id → people(id). audit_log and
--     events actor/person columns intentionally stay UNCONSTRAINED — they
--     are append-only logs and log writes must never fail on referential
--     grounds; people rows are never deleted anyway (status transitions).
--
-- Security: RLS deny-by-default; SELECT for authenticated (Phase 1
-- population is admins + a few leaders; role/scope-based visibility arrives
-- in Phase 2 behind the person-visibility helper, review S2). Writes
-- admin-only. No DELETE policy on people — people leave via
-- status = 'departed'; the audited relationship-notes purge (Phase 2) does
-- not delete people rows.
-- Idempotent: IF NOT EXISTS, drop-then-create, guarded DO blocks.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- people
-- ---------------------------------------------------------------------------

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,          -- display name (the name they go by)
  preferred_name text,              -- given-name form for warm address
  email citext,                     -- unique when present (partial index below)
  phone text,
  photo_url text,
  status text not null default 'active'
    check (status in ('active', 'leave', 'departed')),
  person_kind text not null default 'manager'
    check (person_kind in ('manager', 'emerging_leader', 'key_team_member')),
  hire_date date,
  manager_person_id uuid references public.people (id), -- reporting line
  home_city text,                   -- voluntary; never from import data
  relocation_interest text not null default 'unknown'
    check (relocation_interest in ('open', 'preferred', 'not_open', 'unknown')),
  career_goals text,
  strengths text,
  risks text,                       -- leadership-visible signal (flight risk, gaps)
  mentor_person_id uuid references public.people (id),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  external_refs jsonb not null default '{}'::jsonb, -- { cgops_user_id, push_employee_id }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,                  -- people.id of the editor (ADR 0002)
  updated_by_name text
);

create unique index if not exists people_email_unique
  on public.people (email) where email is not null;
create index if not exists people_status_idx on public.people (status);
create index if not exists people_manager_idx on public.people (manager_person_id);

-- ---------------------------------------------------------------------------
-- position_assignments
-- ---------------------------------------------------------------------------

create table if not exists public.position_assignments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id),
  position_id uuid not null references public.positions (id),
  location_id uuid not null references public.locations (id),
  is_primary boolean not null default false,
  started_on date,                  -- null = predates the system / unknown
  ended_on date,                    -- null = current
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

-- one CURRENT PRIMARY assignment per person
create unique index if not exists position_assignments_one_current_primary
  on public.position_assignments (person_id)
  where is_primary and ended_on is null;

create index if not exists position_assignments_person_idx
  on public.position_assignments (person_id);
create index if not exists position_assignments_location_idx
  on public.position_assignments (location_id);

-- ---------------------------------------------------------------------------
-- FK backfill from Phase 0
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_profiles_person_id_fkey'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_person_id_fkey
      foreign key (person_id) references public.people (id) on delete set null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists set_people_updated_at on public.people;
create trigger set_people_updated_at
  before update on public.people
  for each row execute function public.set_updated_at();

drop trigger if exists set_position_assignments_updated_at on public.position_assignments;
create trigger set_position_assignments_updated_at
  before update on public.position_assignments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.people enable row level security;
alter table public.position_assignments enable row level security;

drop policy if exists people_select on public.people;
create policy people_select on public.people
  for select to authenticated
  using (true); -- Phase 2 replaces with role/scope visibility (review S2)

drop policy if exists people_insert on public.people;
create policy people_insert on public.people
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists people_update on public.people;
create policy people_update on public.people
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
-- no DELETE policy: people leave via status = 'departed'

drop policy if exists position_assignments_select on public.position_assignments;
create policy position_assignments_select on public.position_assignments
  for select to authenticated
  using (true);

drop policy if exists position_assignments_insert on public.position_assignments;
create policy position_assignments_insert on public.position_assignments
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists position_assignments_update on public.position_assignments;
create policy position_assignments_update on public.position_assignments
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists position_assignments_delete on public.position_assignments;
create policy position_assignments_delete on public.position_assignments
  for delete to authenticated
  using (public.is_admin());
