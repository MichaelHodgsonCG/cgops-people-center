-- ============================================================================
-- One person-keyed location-assignment store + conforming resolver.
-- Standard: bus artifact d98cb0cf (Michael's ruling, 2026-08-27): CGOPS owns
-- locations; People Center owns people and location assignments. Work order:
-- bus artifact 3dd10fe6.
--
-- WHAT THIS DOES (additive; nothing here can shrink anyone's coverage):
--   1. people_center_location_assignments — coverage keyed on
--      people_center_people.id (a fact about a person, not a login). Two
--      grains, matching what exists today: a whole region (our region id) or
--      a single restaurant (CGOPS locations.id — the location's identity
--      under the ruling; we deliberately do NOT key on our mirror table).
--   2. Backfills the two legacy account-keyed sources as a union:
--      people_center_user_scopes (auth-keyed) and CGOPS user_locations
--      (login-row-keyed), translated to person via the auth bridge. CGOPS
--      rows already implied by a region the person leads are skipped (no
--      latent duplicates). Region-derived coverage itself stays DERIVED from
--      people_center_regions.leader_person_id — already person-keyed, not
--      copied. Legacy rows are LEFT IN PLACE (additive rule); the coverage
--      admin UI now deletes from both stores on removal, and CGOPS retires
--      user_locations in its own step.
--   3. resolve_my_locations() — the conforming resolver: security definer,
--      stable, keyed auth.uid() -> people_center_user_profiles.person_id,
--      RETURNS location_id (CGOPS locations.id) with the name for display
--      only, empty-not-error, fail-closed (no view-all shortcut here —
--      can_view_all remains a separate signal consumers check explicitly).
--   4. people_center_my_coverage() keeps its exact signature (SETOF text,
--      names) for existing consumers, widened to also read the new store so
--      the two resolvers agree during the transition.
--   5. people_center_coverage_exceptions() — the fail-closed follow-through:
--      logins that resolve to NO coverage (or aren't linked to a person),
--      visible to admin/executive. Absence of permission becomes visible to
--      someone who can fix it.
-- Idempotent.
-- ============================================================================

create table if not exists public.people_center_location_assignments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people_center_people (id) on delete cascade,
  region_id uuid references public.people_center_regions (id) on delete cascade,
  cgops_location_id uuid references public.locations (id) on delete cascade,
  source text not null default 'manual'
    check (source in ('manual', 'scopes_backfill', 'cgops_backfill')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  constraint people_center_location_assignments_one_grain
    check (num_nonnulls(region_id, cgops_location_id) = 1)
);

create unique index if not exists people_center_location_assignments_region_uq
  on public.people_center_location_assignments (person_id, region_id)
  where region_id is not null;
create unique index if not exists people_center_location_assignments_loc_uq
  on public.people_center_location_assignments (person_id, cgops_location_id)
  where cgops_location_id is not null;
create index if not exists people_center_location_assignments_person
  on public.people_center_location_assignments (person_id);

alter table public.people_center_location_assignments enable row level security;

drop policy if exists people_center_location_assignments_select on public.people_center_location_assignments;
create policy people_center_location_assignments_select
  on public.people_center_location_assignments for select to authenticated
  using (
    public.people_center_current_role() = any (array['admin', 'executive'])
    or person_id = public.people_center_current_person_id()
  );

drop policy if exists people_center_location_assignments_write on public.people_center_location_assignments;
create policy people_center_location_assignments_write
  on public.people_center_location_assignments for all to authenticated
  using (public.people_center_current_role() = any (array['admin', 'executive']))
  with check (public.people_center_current_role() = any (array['admin', 'executive']));

-- --- Backfill (union of both legacy sources; conflicts = already present) ---

-- Legacy People Center scopes, region grain.
insert into public.people_center_location_assignments
  (person_id, region_id, source, updated_by_name)
select distinct up.person_id, s.region_id, 'scopes_backfill', 'migration 20260829140000'
from public.people_center_user_scopes s
join public.people_center_user_profiles up on up.auth_user_id = s.auth_user_id
where up.person_id is not null and s.region_id is not null
on conflict (person_id, region_id) where region_id is not null do nothing;

-- Legacy People Center scopes, location grain (translated to the CGOPS id;
-- a scope on an unmapped location cannot be translated and is left in the
-- legacy table — my_coverage still honours it, so nothing is lost).
insert into public.people_center_location_assignments
  (person_id, cgops_location_id, source, updated_by_name)
select distinct up.person_id, pl.cgops_location_id, 'scopes_backfill', 'migration 20260829140000'
from public.people_center_user_scopes s
join public.people_center_user_profiles up on up.auth_user_id = s.auth_user_id
join public.people_center_locations pl on pl.id = s.location_id
where up.person_id is not null and pl.cgops_location_id is not null
on conflict (person_id, cgops_location_id) where cgops_location_id is not null do nothing;

-- CGOPS user_locations, translated login-row -> auth -> person. Rows already
-- implied by a region the person leads are skipped. The eight Charcoal Group
-- HQ ('CG') rows ARE migrated: that preserves today's resolved coverage
-- exactly (hard rule) while Michael decides whether HQ-ness belongs in a
-- coverage list — dropping them later is a deliberate, per-row act.
insert into public.people_center_location_assignments
  (person_id, cgops_location_id, source, updated_by_name)
select distinct pup.person_id, ul.location_id, 'cgops_backfill', 'migration 20260829140000'
from public.user_locations ul
join public.user_profiles cp on cp.id = ul.user_id
join public.people_center_user_profiles pup on pup.auth_user_id = cp.auth_user_id
where pup.person_id is not null
  and not exists (
    select 1
    from public.people_center_regions r
    join public.people_center_locations pl2 on pl2.region_id = r.id
    where r.leader_person_id = pup.person_id
      and pl2.cgops_location_id = ul.location_id
  )
on conflict (person_id, cgops_location_id) where cgops_location_id is not null do nothing;

-- --- The conforming resolver: ids out, names for display only --------------

create or replace function public.resolve_my_locations()
returns table (location_id uuid, location_name text)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select up.person_id
    from public.people_center_user_profiles up
    where up.auth_user_id = auth.uid() and up.person_id is not null
    limit 1
  )
  select distinct cl.id, cl.name
  from me
  join public.people_center_regions r on r.leader_person_id = me.person_id
  join public.people_center_locations l on l.region_id = r.id
  join public.locations cl on cl.id = l.cgops_location_id
  union
  select distinct cl.id, cl.name
  from me
  join public.people_center_location_assignments a
    on a.person_id = me.person_id and a.region_id is not null
  join public.people_center_locations l on l.region_id = a.region_id
  join public.locations cl on cl.id = l.cgops_location_id
  union
  select distinct cl.id, cl.name
  from me
  join public.people_center_location_assignments a
    on a.person_id = me.person_id and a.cgops_location_id is not null
  join public.locations cl on cl.id = a.cgops_location_id;
$$;

revoke all on function public.resolve_my_locations() from public;
grant execute on function public.resolve_my_locations() to authenticated;

-- --- Keep the legacy resolver honest during the transition ------------------
-- Same signature (SETOF text — names), same sources, PLUS the new store, so a
-- grant made in either place resolves identically everywhere until CGOPS
-- migrates onto resolve_my_locations() and the legacy paths retire.

create or replace function public.people_center_my_coverage()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select up.auth_user_id, up.person_id
    from public.people_center_user_profiles up
    where up.auth_user_id = auth.uid()
    limit 1
  )
  select distinct cl.name
  from me
  join public.people_center_regions r on r.leader_person_id = me.person_id
  join public.people_center_locations l on l.region_id = r.id
  join public.locations cl on cl.id = l.cgops_location_id
  union
  select distinct cl.name
  from me
  join public.people_center_user_scopes s on s.auth_user_id = me.auth_user_id
  join public.people_center_locations l
    on (s.location_id is not null and l.id = s.location_id)
    or (s.region_id is not null and l.region_id = s.region_id)
  join public.locations cl on cl.id = l.cgops_location_id
  union
  select distinct cl.name
  from me
  join public.people_center_location_assignments a on a.person_id = me.person_id
  left join public.people_center_locations l
    on a.region_id is not null and l.region_id = a.region_id
  join public.locations cl on cl.id = coalesce(a.cgops_location_id, l.cgops_location_id);
$$;

-- --- Fail-closed, finished: make empty scope visible ------------------------

create or replace function public.people_center_coverage_exceptions()
returns table (email text, display_name text, person_id uuid, reason text)
language sql
stable
security definer
set search_path = public
as $$
  select up.email, up.display_name, up.person_id,
    case when up.person_id is null then 'login not linked to a person'
         else 'no coverage resolves' end
  from public.people_center_user_profiles up
  where public.people_center_current_role() = any (array['admin', 'executive'])
    and up.role <> 'admin'
    and coalesce(up.can_view_all, false) = false
    and (
      up.person_id is null
      or (
        not exists (
          select 1 from public.people_center_regions r
          where r.leader_person_id = up.person_id
        )
        and not exists (
          select 1 from public.people_center_location_assignments a
          where a.person_id = up.person_id
        )
        and not exists (
          select 1 from public.people_center_user_scopes s
          where s.auth_user_id = up.auth_user_id
        )
      )
    )
  order by up.email;
$$;

revoke all on function public.people_center_coverage_exceptions() from public;
grant execute on function public.people_center_coverage_exceptions() to authenticated;

comment on table public.people_center_user_scopes is
  'LEGACY (account-keyed). Superseded by people_center_location_assignments (person-keyed) per ruling d98cb0cf; rows kept during transition, removed only via the coverage admin UI. Do not add new readers.';
