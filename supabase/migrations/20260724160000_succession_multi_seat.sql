-- ============================================================================
-- Allow MULTIPLE succession seats for the same role at one location.
--
-- A restaurant can need several of the same role — e.g. Beertown Peterborough
-- requires 3 Sous Chefs. The one-seat-per-role unique index
-- (people_center_succession_slots_unique_seat on position + location + region)
-- blocked planning a second, and the failure surfaced in the Bench as an
-- opaque "[object Object]" (unique_violation). The required roster
-- (people_center_role_requirements) already carries the per-role count, so the
-- Bench should be free to plan that many seats.
--
-- Dropping the index only removes a restriction — existing rows stay valid, and
-- setting a seat's incumbent still targets a specific slot id. Downstream fill
-- counts already accumulate multiple incumbents per role (gap views), so this
-- makes "3 Sous slated" possible where it was capped at 1.
-- ============================================================================

drop index if exists public.people_center_succession_slots_unique_seat;
