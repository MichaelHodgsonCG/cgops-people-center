# ADR 0003 — The `audit_log` / `events` boundary and the no-content rule

- **Status:** Accepted (2026-07-01)
- **Contract refs:** ARCHITECTURE_REVIEW.md S3, C3; CGOPS_FOUNDATIONS.md §10.3

## Context

People Center has two append-only streams. Without a written boundary they
drift into double-entry ("do I write one or both?"), and if note content is
echoed into events, the promised purge of relationship notes is incomplete.

## Decision

1. **`audit_log` is the compliance record.** Every mutation
   (`create | update | delete`) and — from Phase 2 — reads of restricted and
   relationship material (`view`). Actor as `people.id` + raw auth uuid +
   denormalized name. Never purged.
2. **`events` is the domain record.** Business-meaningful moments (position
   change, readiness change, plan milestone, leadership note) feeding the
   Leadership Timeline projection and future platform learning.
3. **Events carry pointers only** — `event_type`, `entity_type`/`entity_id`,
   reference metadata in `context`. Never note bodies; never relationship or
   restricted content.
4. **Relationship- and restricted-category notes emit no events at all**,
   in Phase 0 and Phase 2, unless explicitly decided otherwise later. They
   are cheat-sheet material, not timeline material.
5. Neither table has UPDATE or DELETE policies. The audited
   relationship-purge (Phase 2) runs through a SECURITY DEFINER function and
   is itself written to `audit_log`.

## Consequences

- App code writes both streams through one discipline (a `record_event()`
  helper lands with the first emitting feature in Phase 1).
- Purging a person's relationship notes never needs to touch `events`,
  because nothing about those notes ever entered it.
- `outcomes` is deferred to Phase 5 alongside the summary endpoints.
