-- ============================================================================
-- 'departing' person status — notice given, last day known, still working.
-- (Michael's ask: Josh Purich gave notice for Sept 13; 'departed' would drop
-- him from the directory/org chart while he's still in seat.)
--
-- The date reuses departed_on: for status='departing' it is the SCHEDULED last
-- day; for status='departed' it remains the actual one. Departing people keep
-- counting as in-seat everywhere (they are, until the date) — the app displays
-- the countdown; flipping to 'departed' on/after the day stays a manual step.
-- Idempotent.
-- ============================================================================

alter table public.people_center_people
  drop constraint if exists people_status_check;
alter table public.people_center_people
  drop constraint if exists people_center_people_status_check;
alter table public.people_center_people
  add constraint people_center_people_status_check
  check (status in ('active', 'leave', 'departed', 'incoming', 'candidate', 'departing'));

comment on column public.people_center_people.departed_on is
  'Last day: scheduled when status=departing (notice given), actual when status=departed.';
