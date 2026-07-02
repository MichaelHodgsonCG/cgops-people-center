# ADR 0005 — Source synchronization pipeline, not an Excel importer

- **Status:** Accepted (2026-07-01)
- **Contract refs:** CGOPS_FOUNDATIONS.md §2 (integrations pattern),
  PUSH_ROSTER_ANALYSIS.md rev. 2

## Context

The Push roster arrives as an Excel export today; the platform direction is
integrations replacing manual imports over time. Building "an xlsx importer"
would couple population sync to a transport that is explicitly temporary.

## Decision

Population sync is a six-stage pipeline (`src/features/imports/pipeline/`),
with hard boundaries between stages:

1. **Source transport** — delivers `RawRecord[]`. Today:
   `transports/xlsxFile.ts`. Tomorrow: a Push API transport returning the
   same shape. Transports contain zero business logic.
2. **Normalization** (`normalize.ts`) — `RawRecord → NormalizedRow` by
   field **whitelist**: compensation fields and payroll-entity geography are
   never read, so redaction is a property of the parser, not a downstream
   filter. Legal name is retained for lineage/correlation only.
3. **Vocabulary mapping** — `position_mappings` / `location_mappings` per
   `source_system`, looked up on `lower(trim(value))` (the CGOPS
   `location_mappings` lesson).
4. **Eligibility determination** — ADR 0004; asks "should this person exist
   in People Center?", never "are they salaried?".
5. **Validation / review** — anomalies route to a `needs_review`
   disposition recorded in `import_rows`; nothing anomalous is imported or
   silently dropped.
6. **Upsert** (`commit.ts`) — creates `people` + current primary
   `position_assignments`, records every source row in
   `import_batches`/`import_rows` with disposition and person linkage.
   Re-syncs correlate on `source_key` (normalized legal name, until
   `push_employee_id` exists) and never overwrite leadership-entered data.

Stages 1–5 are pure modules (no Supabase client, no env access); the two
database-touching stages take the client as a parameter. This is what makes
the pipeline testable offline and transport-swappable.

## Consequences

- A Push API integration is a new transport file plus a `source_system`
  row set — stages 2–6 unchanged.
- V1 re-sync semantics are deliberately conservative: existing people are
  marked `duplicate` and left untouched; richer diff/update semantics are a
  future decision, likely alongside the Push API transport.
- The one-off seed-script idea (review S4) is superseded by this pipeline
  running in-app behind admin-only RLS — no service keys outside edge
  functions.
