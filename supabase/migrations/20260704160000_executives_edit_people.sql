-- ============================================================================
-- Migration: executives_edit_people
-- HQ profile editing (Michael, 2026-07-03): executives may edit people
-- profiles and manage position assignments, not just admins.
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- Widens from admin-only to admin + executive:
--   * people_center_people UPDATE  — profile fields, kind/status,
--     review-flag clearing, departure marking, reporting lines.
--   * people_center_position_assignments INSERT/UPDATE — the panel's
--     primary reassignment (end current, start new).
--
-- Unchanged, deliberately:
--   * people INSERT/DELETE stay admin-only (population entry is the sync
--     pipeline + admin; people never get deleted, only departed).
--   * position_assignments DELETE stays admin-only (corrections end
--     assignments; deleting history is an admin repair).
--   * Note purges stay admin-only (NOTE_RETENTION_POLICY.md: "only admins
--     may purge").
--
-- Idempotent: drop-then-create policies. Safe to run twice.
-- ============================================================================

drop policy if exists people_center_people_update on public.people_center_people;
create policy people_center_people_update on public.people_center_people
  for update to authenticated
  using (public.people_center_current_role() in ('admin', 'executive'))
  with check (public.people_center_current_role() in ('admin', 'executive'));

drop policy if exists people_center_position_assignments_insert on public.people_center_position_assignments;
create policy people_center_position_assignments_insert on public.people_center_position_assignments
  for insert to authenticated
  with check (public.people_center_current_role() in ('admin', 'executive'));

drop policy if exists people_center_position_assignments_update on public.people_center_position_assignments;
create policy people_center_position_assignments_update on public.people_center_position_assignments
  for update to authenticated
  using (public.people_center_current_role() in ('admin', 'executive'))
  with check (public.people_center_current_role() in ('admin', 'executive'));
