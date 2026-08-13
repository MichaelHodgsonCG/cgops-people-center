-- ============================================================================
-- Gap seat assignments — WHO is responsible for filling each open seat, with a
-- target date. Mirrors Menu Center's launch-task owner model: per-seat OWNER +
-- SUPPORT, each a linked person (person_id) plus a name snapshot so free-text
-- owners (outside parties) are possible. A gap of 3 Sous at one site = seats
-- 1..3, each with its own owner/support ("Chef hires the Sous, ROL supports").
--
-- Gaps themselves stay fully DERIVED (fetchCompanyGaps recomputes them live);
-- this table only annotates a (location, role|pool, seat) cell. Rows whose gap
-- has closed simply stop matching a live gap — nothing here marks "done".
--   * kind role: position_id set (people_center_positions), group_name null
--   * kind pool: group_name set (the pool's NAME, matched case-insensitively —
--     pool ids are recreated on override, names survive), position_id null
--
-- Read: the gap-analysis viewers (admin/executive/regional_leader/hq_analyst)
-- plus ANY authenticated user's own rows (owner or support) — that's what lets
-- a Chef or GM see their assignments in My Tasks without gap-analysis access.
-- Write: admin/executive, like the other gap-planning tables.
-- Idempotent.
-- ============================================================================

create table if not exists public.people_center_gap_assignments (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.people_center_locations (id) on delete cascade,
  position_id uuid references public.people_center_positions (id) on delete cascade,
  group_name text,
  seat_index integer not null default 1 check (seat_index >= 1),
  owner_person_id uuid references public.people_center_people (id) on delete set null,
  owner_name text not null default '',
  support_person_id uuid references public.people_center_people (id) on delete set null,
  support_name text not null default '',
  target_date date,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  constraint people_center_gap_assignments_one_target
    check (num_nonnulls(position_id, group_name) = 1)
);

create unique index if not exists people_center_gap_assignments_role_seat
  on public.people_center_gap_assignments (location_id, position_id, seat_index)
  where position_id is not null;

create unique index if not exists people_center_gap_assignments_group_seat
  on public.people_center_gap_assignments (location_id, lower(group_name), seat_index)
  where group_name is not null;

create index if not exists people_center_gap_assignments_owner
  on public.people_center_gap_assignments (owner_person_id);
create index if not exists people_center_gap_assignments_support
  on public.people_center_gap_assignments (support_person_id);

alter table public.people_center_gap_assignments enable row level security;

drop policy if exists people_center_gap_assignments_select on public.people_center_gap_assignments;
create policy people_center_gap_assignments_select
  on public.people_center_gap_assignments for select to authenticated
  using (
    public.people_center_current_role()
      = any (array['admin', 'executive', 'regional_leader', 'hq_analyst'])
    or (
      public.people_center_current_person_id() is not null
      and (
        owner_person_id = public.people_center_current_person_id()
        or support_person_id = public.people_center_current_person_id()
      )
    )
  );

drop policy if exists people_center_gap_assignments_write on public.people_center_gap_assignments;
create policy people_center_gap_assignments_write
  on public.people_center_gap_assignments for all to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));
