-- ============================================================================
-- Migration: create_org_reference
-- Phase 1 — local copies of the CGOPS org vocabulary + People Center
-- eligibility configuration.
--
-- Contract: PRODUCT_BRIEF.md §5 (org reference), CGOPS_FOUNDATIONS.md §5/§7
-- (CGOPS is the vocabulary master; reference by id + external_ref, never
-- free-text), ADR 0004 (People Center eligibility is position-level
-- configuration, not code).
--
-- Creates concepts, regions, locations, departments, positions — all with
-- external_ref (the CGOPS uuid, NULLABLE here: seeds are best-effort local
-- copies; external_refs are backfilled when verified against the live CGOPS
-- tables, at which point CGOPS becomes read-only master for these rows).
--
-- Eligibility model (ADR 0004):
--   * positions.people_center_eligible — "does holding this position put a
--     person in the People Center population?" The sync pipeline asks THIS,
--     never salary status. HQ grows the leadership population by flipping
--     this flag / adding positions — no importer changes.
--   * positions.default_person_kind — what person_kind the pipeline assigns
--     when importing a holder of this position (e.g. Chef de Partie holders
--     enter as 'emerging_leader'; General Managers as 'manager').
--
-- Seeds (guarded, idempotent):
--   * regions — the five CGOPS regions. Locations are seeded with NULL
--     region_id: region membership is assigned by an admin from CGOPS
--     values, not guessed here.
--   * departments — the ten CGOPS departments.
--   * concepts — the five brands observed in the platform + Push roster.
--   * locations — the 16 business units, canonical names (Concept + City,
--     no punctuation). Codes are provisional slugs pending CGOPS codes.
--   * positions — the HQ-approved leadership pipeline positions
--     (eligible) + Supervisor (explicitly NOT eligible: supervisors enter
--     People Center only as HQ-approved emerging leaders, per D4).
--     Note: HEAD CHEF is the platform vocabulary (not Executive Chef /
--     Chef de Cuisine — those are Push spellings, mapped in the
--     position_mappings table, next migration).
--
-- Security: RLS enabled, deny-by-default; SELECT for authenticated, writes
-- admin-only. Idempotent: IF NOT EXISTS, guarded seeds, drop-then-create.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.concepts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order int not null default 0,
  external_ref uuid, -- CGOPS concepts.id, backfilled when verified
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

create table if not exists public.regions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order int not null default 0,
  external_ref uuid, -- CGOPS regions.id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order int not null default 0,
  external_ref uuid, -- CGOPS departments.id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique, -- canonical: Concept + City, no punctuation
  code text not null unique, -- provisional slug; replaced by CGOPS code when synced
  concept_id uuid references public.concepts (id),
  region_id uuid references public.regions (id), -- assigned by admin from CGOPS values
  status text not null default 'open'
    check (status in ('open', 'opening', 'closed')),
  external_ref uuid, -- CGOPS locations.id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  department_id uuid references public.departments (id),
  level int, -- hierarchy level; semantics defined with CGOPS, null until then
  is_key_position boolean not null default false,
  people_center_eligible boolean not null default false, -- ADR 0004
  default_person_kind text not null default 'manager'
    check (default_person_kind in ('manager', 'emerging_leader', 'key_team_member')),
  success_profile text,
  external_ref uuid, -- CGOPS positions.id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

drop trigger if exists set_concepts_updated_at on public.concepts;
create trigger set_concepts_updated_at
  before update on public.concepts
  for each row execute function public.set_updated_at();

drop trigger if exists set_regions_updated_at on public.regions;
create trigger set_regions_updated_at
  before update on public.regions
  for each row execute function public.set_updated_at();

drop trigger if exists set_departments_updated_at on public.departments;
create trigger set_departments_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

drop trigger if exists set_locations_updated_at on public.locations;
create trigger set_locations_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

drop trigger if exists set_positions_updated_at on public.positions;
create trigger set_positions_updated_at
  before update on public.positions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seeds (guarded)
-- ---------------------------------------------------------------------------

insert into public.regions (name, sort_order)
select v.name, v.sort_order
from (values
  ('Greater Toronto Area', 1),
  ('Hamilton–Niagara', 2),
  ('Waterloo Region', 3),
  ('London & Southwest', 4),
  ('Ottawa & East', 5)
) as v (name, sort_order)
where not exists (select 1 from public.regions r where r.name = v.name);

insert into public.departments (name, sort_order)
select v.name, v.sort_order
from (values
  ('Front of House', 1),
  ('Back of House', 2),
  ('Kitchen', 3),
  ('Bar', 4),
  ('Management', 5),
  ('Finance', 6),
  ('Marketing', 7),
  ('People & Culture', 8),
  ('Facilities', 9),
  ('Technology', 10)
) as v (name, sort_order)
where not exists (select 1 from public.departments d where d.name = v.name);

insert into public.concepts (name, sort_order)
select v.name, v.sort_order
from (values
  ('Beertown', 1),
  ('Wildcraft', 2),
  ('Sociable Kitchen Tavern', 3),
  ('The Bauer Kitchen', 4),
  ('Sole', 5)
) as v (name, sort_order)
where not exists (select 1 from public.concepts c where c.name = v.name);

insert into public.locations (name, code, concept_id)
select v.name, v.code, c.id
from (values
  ('Beertown Waterloo',           'beertown-waterloo',    'Beertown'),
  ('Beertown Barrie',             'beertown-barrie',      'Beertown'),
  ('Beertown Burlington',         'beertown-burlington',  'Beertown'),
  ('Beertown Cambridge',          'beertown-cambridge',   'Beertown'),
  ('Beertown Etobicoke',          'beertown-etobicoke',   'Beertown'),
  ('Beertown Guelph',             'beertown-guelph',      'Beertown'),
  ('Beertown London',             'beertown-london',      'Beertown'),
  ('Beertown London White Oaks',  'beertown-london-white-oaks', 'Beertown'),
  ('Beertown Newmarket',          'beertown-newmarket',   'Beertown'),
  ('Beertown Oakville',           'beertown-oakville',    'Beertown'),
  ('Beertown Toronto',            'beertown-toronto',     'Beertown'),
  ('Beertown Whitby',             'beertown-whitby',      'Beertown'),
  ('Wildcraft',                   'wildcraft',            'Wildcraft'),
  ('Sociable Kitchen Tavern',     'sociable-kitchen-tavern', 'Sociable Kitchen Tavern'),
  ('The Bauer Kitchen',           'the-bauer-kitchen',    'The Bauer Kitchen'),
  ('Sole',                        'sole',                 'Sole')
) as v (name, code, concept)
join public.concepts c on c.name = v.concept
where not exists (select 1 from public.locations l where l.name = v.name);

insert into public.positions
  (name, department_id, is_key_position, people_center_eligible, default_person_kind)
select v.name, d.id, v.is_key, v.eligible, v.kind
from (values
  ('General Manager',             'Management', true,  true,  'manager'),
  ('Assistant General Manager',   'Management', false, true,  'manager'),
  ('General Manager in Training', 'Management', false, true,  'manager'),
  ('Head Chef',                   'Kitchen',    true,  true,  'manager'),
  ('Sous Chef',                   'Kitchen',    false, true,  'manager'),
  ('Chef de Partie',              'Kitchen',    false, true,  'emerging_leader'),
  ('Beverage Manager',            'Bar',        false, true,  'manager'),
  ('Service Manager',             'Front of House', false, true, 'manager'),
  ('Guest Service Manager',       'Front of House', false, true, 'manager'),
  ('Events Manager',              'Management', false, true,  'manager'),
  ('Supervisor',                  'Front of House', false, false, 'emerging_leader')
) as v (name, department, is_key, eligible, kind)
join public.departments d on d.name = v.department
where not exists (select 1 from public.positions p where p.name = v.name);

-- ---------------------------------------------------------------------------
-- RLS — SELECT for authenticated; writes admin-only
-- ---------------------------------------------------------------------------

alter table public.concepts enable row level security;
alter table public.regions enable row level security;
alter table public.departments enable row level security;
alter table public.locations enable row level security;
alter table public.positions enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['concepts', 'regions', 'departments', 'locations', 'positions']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.is_admin())', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.is_admin())', t, t);
  end loop;
end;
$$;
