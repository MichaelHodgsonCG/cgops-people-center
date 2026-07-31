-- ============================================================================
-- Covered-locations admin picker — widen people_center_user_scopes management
-- from admin-only to admin + executive.
--
-- The RBAC build gated scope grants to admin only. The "Covered locations"
-- picker is an admin/executive HQ surface (executives are the talent altitude
-- that already edit profiles and read restricted notes), so they must be able
-- to read every user's grants and add/remove them. Additive: admin behavior is
-- unchanged; every user still reads their OWN grants (self-SELECT preserved).
-- Idempotent (ALTER POLICY resets the expression).
--
-- Enforcement stays in RLS; verified by simulating as-role (executive may
-- manage; regional_leader/viewer may not).
-- ============================================================================

alter policy people_center_user_scopes_select
  on public.people_center_user_scopes
  using (
    auth_user_id = auth.uid()
    or public.people_center_is_admin()
    or public.people_center_current_role() = 'executive'
  );

alter policy people_center_user_scopes_insert
  on public.people_center_user_scopes
  with check (
    public.people_center_is_admin()
    or public.people_center_current_role() = 'executive'
  );

alter policy people_center_user_scopes_update
  on public.people_center_user_scopes
  using (
    public.people_center_is_admin()
    or public.people_center_current_role() = 'executive'
  )
  with check (
    public.people_center_is_admin()
    or public.people_center_current_role() = 'executive'
  );

alter policy people_center_user_scopes_delete
  on public.people_center_user_scopes
  using (
    public.people_center_is_admin()
    or public.people_center_current_role() = 'executive'
  );
