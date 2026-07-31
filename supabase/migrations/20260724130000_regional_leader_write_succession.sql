-- ============================================================================
-- Scoped regional-leader access — Phase 3: region-scoped WRITES on the bench.
--
-- A Regional Ops Leader can create/edit/delete succession seats (and their
-- candidates) ONLY for locations in the region(s) they lead — this is where
-- people_center_covers_location (Phase 1) finally does work. Reads stayed
-- company-wide (Phase 2); writes are region-scoped here.
--
-- These are ADDITIVE permissive policies: the existing admin/executive write
-- policies are untouched, and Postgres OR-combines permissive policies, so
-- admin/executive behavior is unchanged. A regional_leader gets a write only
-- when covers_location() is true for the seat's location.
--
-- Deliberately NOT granted here (least privilege — no ROL UI path needs them):
--   * people INSERT/UPDATE — Bench incumbent/successor pickers reference
--     EXISTING people only; person creation stays executive/admin. (If the
--     ROL Excel round-trip is opened up later, add a narrow status='candidate'
--     INSERT then.)
--   * position_assignments writes — staff reassignment stays executive/admin.
--
-- covers_location(loc) is security-definer + stable and already returns false
-- for a null/uncovered location, so the location_id IS NOT NULL guard is belt
-- and suspenders. Candidate rows carry no location of their own, so they scope
-- through their parent slot.
-- ============================================================================

-- Idempotent: drop the ROL write policies first so re-applying is safe.
drop policy if exists people_center_succession_slots_regional_insert on public.people_center_succession_slots;
drop policy if exists people_center_succession_slots_regional_update on public.people_center_succession_slots;
drop policy if exists people_center_succession_slots_regional_delete on public.people_center_succession_slots;
drop policy if exists people_center_succession_candidates_regional_insert on public.people_center_succession_candidates;
drop policy if exists people_center_succession_candidates_regional_update on public.people_center_succession_candidates;
drop policy if exists people_center_succession_candidates_regional_delete on public.people_center_succession_candidates;

-- ---- succession_slots: create / edit / delete within covered regions --------

create policy people_center_succession_slots_regional_insert
  on public.people_center_succession_slots
  for insert
  with check (
    public.people_center_current_role() = 'regional_leader'
    and location_id is not null
    and public.people_center_covers_location(location_id)
  );

create policy people_center_succession_slots_regional_update
  on public.people_center_succession_slots
  for update
  using (
    public.people_center_current_role() = 'regional_leader'
    and location_id is not null
    and public.people_center_covers_location(location_id)
  )
  with check (
    public.people_center_current_role() = 'regional_leader'
    and location_id is not null
    and public.people_center_covers_location(location_id)
  );

create policy people_center_succession_slots_regional_delete
  on public.people_center_succession_slots
  for delete
  using (
    public.people_center_current_role() = 'regional_leader'
    and location_id is not null
    and public.people_center_covers_location(location_id)
  );

-- ---- succession_candidates: scoped through their parent slot's location -----

create policy people_center_succession_candidates_regional_insert
  on public.people_center_succession_candidates
  for insert
  with check (
    public.people_center_current_role() = 'regional_leader'
    and exists (
      select 1 from public.people_center_succession_slots s
      where s.id = slot_id
        and s.location_id is not null
        and public.people_center_covers_location(s.location_id)
    )
  );

create policy people_center_succession_candidates_regional_update
  on public.people_center_succession_candidates
  for update
  using (
    public.people_center_current_role() = 'regional_leader'
    and exists (
      select 1 from public.people_center_succession_slots s
      where s.id = slot_id
        and s.location_id is not null
        and public.people_center_covers_location(s.location_id)
    )
  )
  with check (
    public.people_center_current_role() = 'regional_leader'
    and exists (
      select 1 from public.people_center_succession_slots s
      where s.id = slot_id
        and s.location_id is not null
        and public.people_center_covers_location(s.location_id)
    )
  );

create policy people_center_succession_candidates_regional_delete
  on public.people_center_succession_candidates
  for delete
  using (
    public.people_center_current_role() = 'regional_leader'
    and exists (
      select 1 from public.people_center_succession_slots s
      where s.id = slot_id
        and s.location_id is not null
        and public.people_center_covers_location(s.location_id)
    )
  );
