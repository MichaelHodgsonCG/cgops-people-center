-- ============================================================================
-- Script (NOT a migration): reset_population
-- Clears the imported population and sync lineage for a clean re-import.
--
-- ⚠ PRE-LAUNCH ONLY. Valid while People Center holds nothing but synced
-- roster data. Once Phase 2 ships (notes, development plans — leadership-
-- entered knowledge), this script must not be run: it would destroy real
-- data and violate the append-only rules. Corrections then go through the
-- duplicate-safe re-sync instead.
--
-- Deletes: people, position_assignments, import_batches, import_rows.
-- Keeps:   org reference (concepts/regions/locations/departments/positions),
--          location/position mappings, user_profiles + user_scopes,
--          audit_log (append-only, never cleared), events.
-- user_profiles.person_id links are nulled automatically (FK on delete
-- set null).
--
-- Run in the Supabase SQL editor (postgres role).
-- ============================================================================

begin;

delete from public.position_assignments;
delete from public.import_rows;
delete from public.import_batches;
delete from public.people;

commit;

-- verify empty:
select
  (select count(*) from public.people)               as people,
  (select count(*) from public.position_assignments) as assignments,
  (select count(*) from public.import_batches)       as batches,
  (select count(*) from public.import_rows)          as import_rows;
