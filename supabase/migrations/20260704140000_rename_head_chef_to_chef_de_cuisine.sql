-- ============================================================================
-- Migration: rename_head_chef_to_chef_de_cuisine
-- Vocabulary decision (Michael, 2026-07-03): the position is called
-- CHEF DE CUISINE, matching Push and the restaurant org chart template.
-- Supersedes the earlier platform-vocabulary note (CGOPS_FOUNDATIONS.md §5)
-- that standardized on "Head Chef".
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- Only the display name changes — every reference (assignments, mappings,
-- succession slots, reporting-line derivations) points at the position's id,
-- so history and links are untouched. The Push source mappings
-- ('chef de cuisine' and 'executive chef') already target this position row
-- and keep working unchanged.
--
-- Follow-up outside this database: the CGOPS `positions` vocabulary table
-- seeds "Head Chef" and should receive the same rename when the org
-- reference is reconciled (external_ref backfill).
--
-- Idempotent: guarded UPDATE. Safe to run twice.
-- ============================================================================

update public.people_center_positions
set name = 'Chef de Cuisine',
    updated_by_name = 'migration 20260704140000'
where name = 'Head Chef'
  and not exists (
    select 1 from public.people_center_positions where name = 'Chef de Cuisine'
  );
