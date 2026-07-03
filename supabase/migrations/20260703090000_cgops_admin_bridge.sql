-- ============================================================================
-- Migration: cgops_admin_bridge
-- Phase A compatibility bridge (2026-07-03): CGOPS platform admins are
-- People Center admins.
--
-- ⚠ Apply to the CGOPS Platform Supabase project (People Center's database
-- lives there since the lift-and-shift). This file is part of the repo's
-- record; it is NOT part of the pre-migration source lineage.
--
-- Context: admin status was decided solely by the Phase A compatibility
-- table people_center_user_profiles (role = 'admin'), which requires a
-- manually inserted row per admin. CGOPS is the identity/role authority
-- (ADR direction, runbook rev. 3), so a CGOPS platform admin should be a
-- People Center admin without a duplicate row.
--
-- What this changes — ONE function body. Every RLS policy binds
-- public.people_center_is_admin() by OID, so all 40 admin-gated policies
-- pick this up with zero policy edits:
--   1. Legacy compat row (people_center_user_profiles.role = 'admin')
--      still grants admin — the bridge is additive, nothing revokes.
--   2. OTHERWISE a CGOPS profile row with role = 'admin' grants admin.
--      ASSUMPTION (verify with the diagnostic below before applying):
--      CGOPS profiles live in public.user_profiles keyed by auth_user_id
--      with role values including 'admin'. If the table or column differs,
--      edit the second EXISTS accordingly.
--   3. If the CGOPS profile table/column does not exist as assumed, the
--      exception handler fails SAFE to the legacy answer instead of
--      breaking every policy in the app.
--
-- security definer (owner: postgres) means the CGOPS profile read is not
-- subject to that table's RLS — no CGOPS policy changes are needed.
-- language plpgsql (was sql) solely for the exception guard.
--
-- The app side asks THIS function via rpc when no compat row exists
-- (src/features/auth/useSession.ts), so database and UI cannot disagree.
--
-- Diagnostic — run FIRST in the CGOPS SQL editor and adjust if needed:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'user_profiles';
--   select distinct role from public.user_profiles;
--
-- Phase B still replaces the compat layer entirely; this bridge is the
-- admin-only subset pulled forward and is deleted along with it.
-- Idempotent: CREATE OR REPLACE + grant. Safe to run twice.
-- ============================================================================

create or replace function public.people_center_is_admin()
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  -- 1. Legacy Phase A compat row
  if exists (
    select 1
    from public.people_center_user_profiles
    where auth_user_id = auth.uid()
      and role = 'admin'
  ) then
    return true;
  end if;

  -- 2. CGOPS platform admins (the bridge)
  return exists (
    select 1
    from public.user_profiles
    where auth_user_id = auth.uid()
      and role = 'admin'
  );
exception
  when undefined_table or undefined_column then
    -- CGOPS profile table not shaped as assumed — fail safe to the legacy
    -- answer (step 1 already returned true if it applied).
    return false;
end;
$$;

-- Explicit for clarity; Supabase grants EXECUTE to authenticated by default.
grant execute on function public.people_center_is_admin() to authenticated;
