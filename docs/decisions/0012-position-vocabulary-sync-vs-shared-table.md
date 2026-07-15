# ADR 0012 — Position vocabulary: sync two tables, don't share one

- **Status:** Accepted (2026-07-15)
- **Contract refs:** CGOPS_FOUNDATIONS.md §5/§7 (CGOPS is the vocabulary
  master; reference by id + external_ref), ADR 0004 (eligibility is
  position-level config), ADR 0001 (Supabase naming / lift-and-shift),
  migration 20260715120000

## Context

People Center now runs inside the CGOPS Platform Supabase project, so the
CGOPS position master (`public.positions`, surfaced as Operational Center →
Positions) and People Center's `people_center_positions` live in the same
database. The natural question: collapse them into one shared table, editable
from both apps?

Inspection of the live data showed the two lists are **not the same list** —
they are two curations of an overlapping vocabulary:

- **Membership differs.** CGOPS carries the full operational catalog (Server,
  Host, Bartender, Line Cook, Prep Cook, Dishwasher, Pastry Chef/Cook) that
  People Center deliberately does not offer. People Center carries pipeline
  positions CGOPS lacks (Chef de Partie, GM in Training) and a sync artifact
  (`Needs Position Review`) that does not belong in an ops catalog.
- **Granularity differs.** CGOPS splits `Sous Chef — Day / Night / Senior`;
  People Center collapses these into one `Sous Chef`.
- **Columns differ.** People Center holds config with no home on the ops
  catalog: `people_center_eligible`, `default_person_kind`, `success_profile`.

## Decision

Keep two tables joined by `external_ref`, and **sync** rather than share.

- **Field ownership, not row ownership.** CGOPS owns the shared fields (name,
  description); People Center owns its config (visibility, sync-eligibility,
  default kind, success profile). This makes "editable on both ends" safe —
  there is never a field two apps both master.
- **A People-Center-side pull, not a CGOPS trigger.**
  `people_center_sync_positions_from_cgops()` (admin-only, SECURITY DEFINER) is
  invoked from People Center's Positions panel. It links by `external_ref`,
  refreshes CGOPS-owned fields on linked rows, links an unlinked same-named
  row, and materializes a new CGOPS position **hidden + ineligible** so it
  surfaces nowhere until an admin curates it. A trigger on `public.positions`
  was rejected: it would put People Center's logic inside CGOPS's write path —
  the exact coupling this ADR avoids.
- **`show_in_people_center`** gates the pickers so the CGOPS long tail stays
  out of People Center's Add-person / reassignment dropdowns.

## Why not one shared table

A shared table does not remove the divergence — it re-encodes it as a
visibility flag, a many-to-one granularity mapping (three CGOPS Sous Chefs to
one), and PC-only synthetic rows inside the ops catalog. It also demands a
one-way live-data migration re-pointing People Center's ~242 position
assignments + 12 mappings to CGOPS ids, and welds People Center to CGOPS's
position lifecycle (a CGOPS rename/delete reaches straight into People Center
history). The `external_ref` seam localises the difference in one legible
place, so later layers don't each inherit the coupling.

## Consequences

- Adding an HQ position: add it once in CGOPS → run "Sync from CGOPS" → it
  appears in the Positions panel hidden; an admin turns on visibility and sets
  eligibility/kind. No double data entry, no code change.
- The sync is one-directional (CGOPS → People Center) for shared fields, which
  matches "CGOPS is master." A write-back (People Center editing a position's
  name into CGOPS) is intentionally not built; it would invert the master.
- This is also the clean **on-ramp** to a future full merge if the two lists
  ever converge: the CGOPS↔PC mapping is already explicit and proven.
- A scheduled pull (pg_cron) is a trivial later addition if hands-off sync is
  wanted; the button is the manual form of the same function.
