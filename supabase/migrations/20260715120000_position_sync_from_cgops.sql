-- ============================================================================
-- Migration: position_sync_from_cgops
-- Michael (2026-07-15): keep People Center's position vocabulary in step with
-- the CGOPS Operational Center → Positions master WITHOUT merging the two
-- tables (ADR 0012). The two lists are deliberately different curations of an
-- overlapping vocabulary — CGOPS is the full operational catalog (Server,
-- Dishwasher, Sous Chef Day/Night/Senior…), People Center is the curated
-- leadership set plus its own eligibility config and a couple of pipeline-only
-- positions. So we sync, not share.
--
-- ⚠ Apply to the CGOPS Platform Supabase project.
--
-- Field ownership (the rule that makes "editable on both ends" safe):
--   * CGOPS owns the SHARED fields — name, description. The sync pulls them.
--   * People Center owns its CONFIG — people_center_eligible,
--     default_person_kind, success_profile, and (new) show_in_people_center.
--     The sync never touches these.
--
-- Two changes:
--
-- 1. people_center_positions.show_in_people_center — controls whether a
--    position is offered in People Center's pickers (Add person, reassign).
--    Existing curated positions stay visible; the 'Needs Position Review'
--    sync placeholder is hidden (it is an internal artifact, never a choice).
--
-- 2. people_center_sync_positions_from_cgops() — admin-only, SECURITY DEFINER.
--    A PULL (People Center reads CGOPS; CGOPS never calls into People Center):
--      * linked rows (external_ref set) → refresh name/description from CGOPS;
--      * an unlinked PC row with the same name → link it (backfill external_ref);
--      * a CGOPS position with no PC counterpart → create it HIDDEN and
--        ineligible, so it appears nowhere until an admin curates it (turns on
--        show_in_people_center, sets eligibility + default kind).
--    Returns {created, updated, linked}.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, create-or-replace function. Running
-- the sync twice is a no-op beyond field refreshes.
-- ============================================================================

alter table public.people_center_positions
  add column if not exists show_in_people_center boolean not null default true;

-- The sync placeholder is an internal parking spot, never a pickable position.
update public.people_center_positions
  set show_in_people_center = false
  where name = 'Needs Position Review' and show_in_people_center;

create or replace function public.people_center_sync_positions_from_cgops()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  match record;
  v_created int := 0;
  v_updated int := 0;
  v_linked int := 0;
begin
  -- Population entry is an admin action; the definer context must not become a
  -- privilege-escalation path.
  if not public.people_center_is_admin() then
    raise exception 'Only People Center admins may sync positions from CGOPS';
  end if;

  for c in select id, name, description from public.positions loop
    -- 1) Already linked by external_ref → refresh the CGOPS-owned fields only.
    --    Rename only when the new name is free (name is unique); PC config is
    --    never touched.
    select id into match from public.people_center_positions
      where external_ref = c.id limit 1;
    if found then
      update public.people_center_positions p
        set description = c.description,
            name = case
              when c.name = p.name then p.name
              when not exists (
                select 1 from public.people_center_positions o
                where o.name = c.name and o.id <> p.id
              ) then c.name
              else p.name
            end
        where p.id = match.id;
      v_updated := v_updated + 1;
      continue;
    end if;

    -- 2) An unlinked PC row with the same name → adopt it as the CGOPS row.
    select id, external_ref into match from public.people_center_positions
      where lower(name) = lower(c.name) limit 1;
    if found then
      if match.external_ref is null then
        update public.people_center_positions
          set external_ref = c.id,
              description = coalesce(description, c.description)
          where id = match.id;
        v_linked := v_linked + 1;
      end if;
      -- already linked to a different CGOPS id: leave it, skip.
      continue;
    end if;

    -- 3) New CGOPS position → materialize HIDDEN + ineligible. An admin turns
    --    it on (and sets eligibility/kind) from the Positions panel.
    insert into public.people_center_positions
      (name, description, external_ref, is_key_position,
       people_center_eligible, default_person_kind, show_in_people_center)
    values
      (c.name, c.description, c.id, false, false, 'manager', false);
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'linked', v_linked);
end;
$$;

grant execute on function public.people_center_sync_positions_from_cgops() to authenticated;
