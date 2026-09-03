-- ============================================================================
-- Scope granting becomes ADMIN-ONLY (work order 8f520e1e; governing standard
-- 77ca34f4; Michael's ruling verbatim: "executive isn't an admin user.
-- Executives should not able to expand scope of other users. That should be
-- admin only.")
--
-- Exactly the change the work order specs and NO MORE: the executive branch
-- is removed from the three WRITE policies on people_center_user_scopes.
-- SELECT is deliberately untouched — reading a scope is not expanding one;
-- executives keep visibility and lose the write. Pre-check (2026-09-03)
-- confirmed no executive has ever written a scope row (all 20 rows came from
-- the legacy self-service default-filter path, last on 2026-07-25), so no
-- daily task is being taken away from anyone.
-- Idempotent.
-- ============================================================================

drop policy if exists people_center_user_scopes_insert on public.people_center_user_scopes;
create policy people_center_user_scopes_insert
  on public.people_center_user_scopes for insert to authenticated
  with check (people_center_is_admin());

drop policy if exists people_center_user_scopes_update on public.people_center_user_scopes;
create policy people_center_user_scopes_update
  on public.people_center_user_scopes for update to authenticated
  using (people_center_is_admin())
  with check (people_center_is_admin());

drop policy if exists people_center_user_scopes_delete on public.people_center_user_scopes;
create policy people_center_user_scopes_delete
  on public.people_center_user_scopes for delete to authenticated
  using (people_center_is_admin());
