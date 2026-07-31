-- ============================================================================
-- Per-location required rosters — global default + per-location overrides.
--
-- The required roster was a single global template applied to every restaurant.
-- Real sites differ (a flagship's kitchen line is bigger than a neighbourhood
-- spot's), so requirements become scoped: a GLOBAL default (location_id null)
-- plus per-location OVERRIDES that store only what differs. Resolution is
-- most-specific-wins, per item: a location uses its own row for a given
-- position/pool if present, otherwise inherits the global one. A site with no
-- overrides uses the global roster unchanged.
--
--   * role_requirements: was keyed by position_id alone (one global row per
--     role). Re-base the PK onto a surrogate id and add location_id so a role
--     can have a global row AND a per-location row. Partial unique indexes keep
--     "one global per position" and "one per (location, position)".
--   * requirement_groups: location_id was already reserved (null = global);
--     give it a real FK now, and add overrides_group_id so a location pool can
--     declare which global pool it replaces (null = a location-only pool).
-- RLS is unchanged (any app user reads; admin/executive write) — scoping is by
-- data, not by policy, in this phase.
-- Idempotent.
-- ============================================================================

-- --- Single-role requirements: add surrogate id + location scope -------------

alter table public.people_center_role_requirements
  add column if not exists id uuid not null default gen_random_uuid();
alter table public.people_center_role_requirements
  add column if not exists location_id uuid
    references public.people_center_locations (id) on delete cascade;

alter table public.people_center_role_requirements
  drop constraint if exists people_center_role_requirements_pkey;
alter table public.people_center_role_requirements
  add constraint people_center_role_requirements_pkey primary key (id);

create unique index if not exists people_center_role_requirements_global_uniq
  on public.people_center_role_requirements (position_id)
  where location_id is null;
create unique index if not exists people_center_role_requirements_location_uniq
  on public.people_center_role_requirements (location_id, position_id)
  where location_id is not null;

-- --- Pools: real FK on the reserved location_id + the override link -----------

alter table public.people_center_requirement_groups
  add column if not exists overrides_group_id uuid
    references public.people_center_requirement_groups (id) on delete cascade;

do $$
begin
  alter table public.people_center_requirement_groups
    add constraint people_center_requirement_groups_location_fk
    foreign key (location_id)
    references public.people_center_locations (id) on delete cascade;
exception
  when duplicate_object then null;
end $$;

create index if not exists people_center_requirement_groups_location_idx
  on public.people_center_requirement_groups (location_id);
create index if not exists people_center_requirement_groups_overrides_idx
  on public.people_center_requirement_groups (overrides_group_id);
