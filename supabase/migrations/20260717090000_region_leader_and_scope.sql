-- ============================================================================
-- Scoped regional-leader access — Phase 1: explicit region ownership + the one
-- scope helper. NO policy changes here (Phases 2/3 wire it in), so this
-- migration changes no access behavior on its own.
--
-- A region already clusters a Regional Ops Leader's restaurants (and their
-- upcoming sites, tagged in via region_id). We make that ownership first-class:
--   * people_center_regions.leader_person_id — the ROL for the region,
--     seeded from who the region's OPEN-restaurant GMs report to (1:1 today).
--   * people_center_covers_location(loc) — the single check Phase 2/3 policies
--     reuse: admin/executive cover everything; a regional_leader covers only
--     locations in the region(s) they lead (existing + upcoming); others none.
-- Idempotent.
-- ============================================================================

alter table public.people_center_regions
  add column if not exists leader_person_id uuid
    references public.people_center_people (id) on delete set null;

-- Seed: each region's leader = the ROL its open restaurants' GMs report to.
update public.people_center_regions reg
set leader_person_id = sub.rol
from (
  select distinct on (loc.region_id) loc.region_id, gm.manager_person_id as rol
  from public.people_center_locations loc
  join public.people_center_position_assignments pa
    on pa.location_id = loc.id and pa.ended_on is null and pa.is_primary
  join public.people_center_positions pos
    on pos.id = pa.position_id and pos.name = 'General Manager'
  join public.people_center_people gm on gm.id = pa.person_id
  where loc.status = 'open' and gm.manager_person_id is not null
  order by loc.region_id, gm.manager_person_id
) sub
where reg.id = sub.region_id;

create or replace function public.people_center_covers_location(p_location_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.people_center_is_admin()
    or public.people_center_current_role() = 'executive'
    or (
      public.people_center_current_role() = 'regional_leader'
      and public.people_center_current_person_id() is not null
      and public.people_center_current_person_id() = (
        select reg.leader_person_id
        from public.people_center_locations loc
        join public.people_center_regions reg on reg.id = loc.region_id
        where loc.id = p_location_id
      )
    );
$$;
