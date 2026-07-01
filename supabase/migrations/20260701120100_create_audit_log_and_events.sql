-- ============================================================================
-- Migration: create_audit_log_and_events
-- Phase 0 (Skeleton) — the platform seam: compliance record + domain record.
--
-- Contract: docs/ARCHITECTURE_REVIEW.md §8 deliverable 4 and §3/S3 (the
-- audit-vs-events boundary); docs/CGOPS_FOUNDATIONS.md §10.3.
--
-- Boundary (ADR 0003):
--   * audit_log — the COMPLIANCE record. Every mutation, and (from Phase 2)
--       reads of restricted/relationship material via the 'view' action.
--       Actor recorded as people.id when known (actor_person_id; FK added in
--       Phase 1), plus the raw auth uuid (actor_auth_uid) for traceability,
--       plus a denormalized actor_name for display without a join.
--       Never purged.
--   * events — the DOMAIN record. Business-meaningful moments (position
--       change, readiness change, plan milestone, leadership note) feeding
--       the Leadership Timeline projection and future platform learning.
--
-- Content rules (approved 2026-07-01, review C3):
--   * events rows carry POINTERS ONLY — event_type, entity_type/entity_id,
--       and reference metadata in context. Never note bodies, never
--       relationship or restricted content.
--   * relationship- and restricted-category notes emit NO events at all
--       unless explicitly decided otherwise later.
--
-- Append-only: INSERT and SELECT policies only — no UPDATE or DELETE policy
-- exists on either table. (The audited relationship-note purge, Phase 2,
-- will run through a definer function, not a client policy.)
-- SELECT is admin-only in Phase 0; events SELECT widens in Phase 2 behind
-- the person-visibility helper (review S2).
--
-- The outcomes table is deliberately ABSENT — deferred to Phase 5 with the
-- summary endpoints (review §4.1).
--
-- Security: RLS enabled, deny-by-default, 'authenticated' only, no anon.
-- Idempotent: IF NOT EXISTS guards, drop-then-create policies. Safe to run
-- twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- audit_log — compliance record (append-only)
-- ---------------------------------------------------------------------------

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_person_id uuid, -- → people(id); FK added in Phase 1
  actor_auth_uid uuid,  -- raw auth uuid for traceability across identity swaps
  actor_name text not null,
  action text not null
    check (action in ('create', 'update', 'delete', 'view')),
  entity_type text not null,
  entity_id uuid,
  entity_label text,
  summary text,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_entity_idx
  on public.audit_log (entity_type, entity_id);
create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at);

alter table public.audit_log enable row level security;

drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- events — domain record (append-only, pointers only)
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  person_id uuid,        -- subject → people(id); FK added in Phase 1
  actor_person_id uuid,  -- → people(id); FK added in Phase 1
  entity_type text,      -- pointer to the source row, never its content
  entity_id uuid,
  context jsonb not null default '{}'::jsonb, -- reference metadata only
  created_at timestamptz not null default now()
);

create index if not exists events_person_id_idx
  on public.events (person_id, created_at);
create index if not exists events_created_at_idx
  on public.events (created_at);

alter table public.events enable row level security;

drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated
  using (public.is_admin());
