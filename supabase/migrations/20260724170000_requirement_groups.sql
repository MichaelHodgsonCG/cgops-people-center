-- ============================================================================
-- Pooled requirement groups for the gap analysis.
--
-- The required roster today is one fixed count per role. Real staffing rules
-- are pooled: e.g. a kitchen line = 5 across {Senior Sous, Sous, Chef de Partie}
-- with a MINIMUM of 2 Sous. A group is a named set of roles + a total minimum +
-- optional per-role minimums; the gap for a group is
--   max( total_min - filledAcrossGroup,  Σ per-role-minimum shortfalls ).
-- This is config, not code — new rules (incl. a FOH pool) are just new rows.
--
-- concept_id / location_id are the scope for a later phase (null = global, which
-- is all that Phase 1 uses); adding them now keeps that phase additive.
-- Mirrors role_requirements RLS: any app user reads; admin/executive write.
-- ============================================================================

create table if not exists public.people_center_requirement_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  total_min integer not null default 0,
  concept_id uuid,
  location_id uuid,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

create table if not exists public.people_center_requirement_group_roles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.people_center_requirement_groups(id) on delete cascade,
  position_id uuid not null references public.people_center_positions(id) on delete cascade,
  min_count integer not null default 0,
  unique (group_id, position_id)
);

alter table public.people_center_requirement_groups enable row level security;
alter table public.people_center_requirement_group_roles enable row level security;

drop policy if exists people_center_requirement_groups_select on public.people_center_requirement_groups;
drop policy if exists people_center_requirement_groups_write on public.people_center_requirement_groups;
drop policy if exists people_center_requirement_group_roles_select on public.people_center_requirement_group_roles;
drop policy if exists people_center_requirement_group_roles_write on public.people_center_requirement_group_roles;

create policy people_center_requirement_groups_select
  on public.people_center_requirement_groups for select using (true);
create policy people_center_requirement_groups_write
  on public.people_center_requirement_groups for all
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));

create policy people_center_requirement_group_roles_select
  on public.people_center_requirement_group_roles for select using (true);
create policy people_center_requirement_group_roles_write
  on public.people_center_requirement_group_roles for all
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));
