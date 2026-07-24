-- ============================================================================
-- Scoped regional-leader access — Phase 2: company-wide READS of the bench.
--
-- Regional Ops Leaders (regional_leader) get to SEE the whole company's
-- succession picture, not just their own region:
--   * succession plans move managers in/out of regions, so a ROL must be able
--     to view seats and candidates everywhere to plan a cross-region move;
--   * ROLs audit restaurants outside their own region and need the same
--     leadership context there.
--
-- So reads are UNRESTRICTED for regional_leader (identical to executive/admin).
-- Region scoping (people_center_covers_location, from Phase 1) is reserved for
-- WRITES in Phase 3 — a ROL will only be able to create/edit seats in the
-- region(s) they lead. This migration widens SELECT only; it grants no writes.
--
-- Everything else the Bench/Gap views read is already open to any app user
-- (locations, positions, position_assignments, people, role_requirements).
-- Development-conversation notes stay chain-visibility gated (ADR 0008) — the
-- Bench "stale conversations" KPI simply reflects what the ROL can already see.
-- Idempotent (ALTER POLICY resets the expression).
-- ============================================================================

alter policy people_center_succession_slots_select
  on public.people_center_succession_slots
  using (
    public.people_center_current_role()
      = any (array['admin', 'executive', 'regional_leader'])
  );

alter policy people_center_succession_candidates_select
  on public.people_center_succession_candidates
  using (
    public.people_center_current_role()
      = any (array['admin', 'executive', 'regional_leader'])
  );
