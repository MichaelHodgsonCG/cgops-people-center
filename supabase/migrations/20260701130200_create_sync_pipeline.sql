-- ============================================================================
-- Migration: create_sync_pipeline
-- Phase 1 — source synchronization pipeline: vocabulary mappings + lineage.
--
-- Contract: docs/imports/PUSH_ROSTER_ANALYSIS.md (rev. 2), ADR 0004
-- (eligibility), ADR 0005 (sync pipeline: transport → normalize → map →
-- eligibility → review → upsert; Excel is today's transport, the Push API is
-- tomorrow's — these tables serve both unchanged).
--
-- Creates:
--   * location_mappings / position_mappings — source vocabulary → local ids,
--     the CGOPS location_mappings lesson applied. source_value is stored
--     LOWERCASED and trimmed; the pipeline looks up lower(trim(value)).
--     Seeded for source 'push_roster' from the May 11 2026 export analysis.
--   * import_batches — one row per sync run (any transport), with counts.
--   * import_rows — per-source-row lineage: REDACTED raw payload (salary /
--     compensation fields are dropped at the normalization stage and can
--     never appear here — redaction is a property of the parser, not a
--     filter), disposition, review note, source_key (normalized legal name;
--     the correlation key until push_employee_id exists), and the person the
--     row produced or matched.
--
-- Security: mappings SELECT authenticated / writes admin; import tables
-- admin-only for everything (they contain legal names and lineage).
-- Idempotent throughout.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Vocabulary mappings
-- ---------------------------------------------------------------------------

create table if not exists public.location_mappings (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,      -- 'push_roster' | 'push_api' | ...
  source_value text not null,       -- lowercased, trimmed
  location_id uuid not null references public.locations (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  unique (source_system, source_value)
);

create table if not exists public.position_mappings (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  source_value text not null,       -- lowercased, trimmed
  position_id uuid not null references public.positions (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  unique (source_system, source_value)
);

drop trigger if exists set_location_mappings_updated_at on public.location_mappings;
create trigger set_location_mappings_updated_at
  before update on public.location_mappings
  for each row execute function public.set_updated_at();

drop trigger if exists set_position_mappings_updated_at on public.position_mappings;
create trigger set_position_mappings_updated_at
  before update on public.position_mappings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Lineage
-- ---------------------------------------------------------------------------

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null,             -- 'push_roster' | 'push_api' | ...
  transport text not null default 'xlsx'
    check (transport in ('xlsx', 'csv', 'api', 'manual')),
  file_name text,
  file_note text,                   -- provenance, e.g. "Push export May 11 2026"
  imported_on timestamptz not null default now(),
  imported_by_person_id uuid references public.people (id),
  imported_by_name text,
  row_count int not null default 0,
  imported_count int not null default 0,
  duplicate_count int not null default 0,
  review_count int not null default 0,
  skipped_count int not null default 0
);

create table if not exists public.import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  row_number int not null,
  source_key text not null,         -- normalized legal name; correlation until push_employee_id
  raw jsonb not null,               -- REDACTED normalized row — no salary fields, ever
  disposition text not null
    check (disposition in ('imported', 'skipped_out_of_scope', 'needs_review', 'duplicate')),
  review_note text,
  person_id uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists import_rows_batch_idx on public.import_rows (batch_id);
create index if not exists import_rows_source_key_idx on public.import_rows (source_key);

-- ---------------------------------------------------------------------------
-- Mapping seeds — source 'push_roster' (May 11 2026 export vocabulary)
-- ---------------------------------------------------------------------------

insert into public.location_mappings (source_system, source_value, location_id)
select 'push_roster', v.source_value, l.id
from (values
  ('beertown waterloo',          'Beertown Waterloo'),
  ('beertown barrie',            'Beertown Barrie'),
  ('beertown burlington',        'Beertown Burlington'),
  ('beertown cambridge',         'Beertown Cambridge'),
  ('beertown etobicoke',         'Beertown Etobicoke'),
  ('beertown guelph',            'Beertown Guelph'),
  ('beertown london',            'Beertown London'),
  ('beertown white oaks mall',   'Beertown London White Oaks'),
  ('beertown newmarket',         'Beertown Newmarket'),
  ('beertown oakville',          'Beertown Oakville'),
  ('beertown toronto',           'Beertown Toronto'),
  ('beertown whitby',            'Beertown Whitby'),
  ('wildcraft waterloo',         'Wildcraft'),
  ('sociable kitchen + tavern',  'Sociable Kitchen Tavern'),
  ('the bauer kitchen',          'The Bauer Kitchen'),
  ('sole',                       'Sole')
) as v (source_value, location_name)
join public.locations l on l.name = v.location_name
where not exists (
  select 1 from public.location_mappings m
  where m.source_system = 'push_roster' and m.source_value = v.source_value
);

insert into public.position_mappings (source_system, source_value, position_id)
select 'push_roster', v.source_value, p.id
from (values
  ('general manager',           'General Manager'),
  ('assistant general manager', 'Assistant General Manager'),
  ('gm in training',            'General Manager in Training'),
  ('chef de cuisine',           'Head Chef'),
  ('executive chef',            'Head Chef'),
  ('sous chef',                 'Sous Chef'),
  ('chef de partie',            'Chef de Partie'),
  ('beverage manager',          'Beverage Manager'),
  ('service manager',           'Service Manager'),
  ('guest service manager',     'Guest Service Manager'),
  ('events manager',            'Events Manager'),
  ('supervisor',                'Supervisor')
) as v (source_value, position_name)
join public.positions p on p.name = v.position_name
where not exists (
  select 1 from public.position_mappings m
  where m.source_system = 'push_roster' and m.source_value = v.source_value
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.location_mappings enable row level security;
alter table public.position_mappings enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;

do $$
declare
  t text;
begin
  -- mappings: read for authenticated, writes admin
  foreach t in array array['location_mappings', 'position_mappings']
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

  -- lineage: admin-only for everything (contains legal names)
  foreach t in array array['import_batches', 'import_rows']
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.is_admin())', t, t);
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
