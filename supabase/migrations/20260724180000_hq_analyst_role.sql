-- ============================================================================
-- hq_analyst — a view-only HQ tier for the Gap Analysis.
--
-- Executives already view AND edit the gap analysis; there was no HQ tier that
-- could look without touching the required roster or pools. hq_analyst fills
-- that: it can open the gap analysis (company-wide, like the other viewers) but
-- has no write path — the role_requirements / requirement_groups write policies
-- stay admin/executive, and the app's can() gate mirrors that.
--
-- One read grant is required for correctness, not convenience: the gap math
-- reads succession slots (slated leaders fill upcoming sites; movers out of a
-- seat drive backfill at the origin). Without this an hq_analyst wouldn't get an
-- empty view — they'd get WRONG numbers (opening sites all-unstaffed, no
-- backfill rows). So hq_analyst joins the existing slot readers. This exposes
-- slot rows to the role, consistent with the gap view already naming slated
-- leaders at opening sites. It is NOT granted succession_candidates (the gap
-- view never reads them) — least privilege.
-- Idempotent: drop/add constraint, ALTER POLICY resets the expression.
-- ============================================================================

alter table public.people_center_user_profiles
  drop constraint if exists people_center_user_profiles_role_check;
alter table public.people_center_user_profiles
  add constraint people_center_user_profiles_role_check
  check (role in ('admin', 'executive', 'regional_leader', 'location_leader', 'viewer', 'hq_analyst'));

alter policy people_center_succession_slots_select
  on public.people_center_succession_slots
  using (
    public.people_center_current_role()
      = any (array['admin', 'executive', 'regional_leader', 'hq_analyst'])
  );
