-- ============================================================================
-- Consolidate onto succession (revert 20260716120000).
--
-- The upcoming restaurants already exist in people_center_locations
-- (status='opening'), and the Bench / succession model
-- (people_center_succession_slots + _candidates) already plots slated leaders
-- into them. people_center_opening_placements was a redundant parallel store
-- (it was built on the wrong assumption that upcoming sites had no People
-- Center location row). Drop it; the Upcoming view now REFLECTS the succession
-- plan read-only, and all leader planning stays in the Bench (one source of
-- truth). The table was empty, so no data is lost.
-- ============================================================================

drop table if exists public.people_center_opening_placements;
