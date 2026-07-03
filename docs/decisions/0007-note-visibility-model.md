# ADR 0007 — Phase 2 note model: categories, visibility, audited reads, self-view

- **Status:** Accepted (2026-07-03) — resolves ARCHITECTURE_REVIEW.md C1,
  D5, D8, D3, D6; D7 owner assigned.
- **Implemented by:** migration `20260703120000_create_notes_and_visibility.sql`

## Decisions (approved by Michael, 2026-07-03)

1. **C1 — categories are content types; restricted is a visibility.**
   `people_center_notes.category ∈ {leadership, development, relationship}`;
   `visibility ∈ {leadership, hq, restricted}`. The incoherent
   category×visibility matrix is gone.
2. **D5 — relationship notes default to `hq`** (executives + admins), with a
   database CHECK enforcing `hq` as the *minimum* and `voluntarily_shared =
   true` as a *requirement* — not UI conventions.
3. **D8 — audited reads.** Relationship and restricted notes are not
   readable by direct SELECT (except by their author). They flow through
   SECURITY DEFINER functions that write one `view` row to
   `people_center_audit_log` per person-panel fetch:
   `people_center_get_relationship_notes` / `people_center_get_restricted_notes`.
4. **D3 — `chain` visibility deferred** until reporting lines are actually
   populated. V1 ships leadership/hq/restricted. Consequence: location
   leaders can *write* notes but read back only what they authored.
5. **D6 — self-view.** Nobody reads notes about themselves other than notes
   they authored — enforced in RLS and inside both definer functions,
   including for admins.
6. **D7 — retention policy owner: Michael**, decided later. Until the policy
   exists, restricted notes remain admin/executive/author-only and the
   audited purge machinery is not built.

## Also in this change

- **Shared-pool closure:** SELECT on people/org/assignment/mapping tables now
  requires a People Center role (`people_center_has_app_access()`), closing
  the runbook's "any CGOPS-authenticated user can read the directory" gap.
- **Role resolution:** `people_center_current_role()` — CGOPS platform
  admins are `admin` via the Phase A bridge; otherwise the compat profile
  role. NULL role ⇒ no access anywhere (positive checks only).
- **Author identity:** notes carry `author_person_id` (when the author is a
  roster person) + `author_auth_uid` + denormalized `author_name` — HQ
  authors need not exist in the talent roster (pragmatic extension of
  ADR 0002).
- **Events:** leadership/development note creation emits a pointers-only
  `note.added` event; relationship and restricted material emits **no**
  events (ADR 0003 / C3), so the future purge never has to touch the event
  stream.
