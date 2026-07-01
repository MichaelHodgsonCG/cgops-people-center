# Push Management Roster — Import Analysis (Phase 1 input)

> **Status:** Rev. 1 — analysis of `Mgmt_Roster__push_report_May_11_2026.xlsx`
> (Push export, reviewed 2026-07-01) ahead of Phase 1 schema and import
> decisions. **The source file is never committed to this repository** — it
> contains compensation data and the full staff roster; it lives with the
> operator and is read at import time only.
> **Direction (approved):** the roster informs seeding of the
> manager/emerging-leader population; People Center does not mirror Push; no
> salary/compensation data is imported; company/location fields are
> business-unit mapping, not personal geography.

## 1. What the file actually is

One sheet, 1,167 data rows × 12 columns — **the full staff roster of all 16
business units**, not just management: 613 FOH, 377 BOH, 157 flagged
"Salaried Manager," 16 Maintenance, 4 anomalous. Columns:

| Column | Content | Finding |
|---|---|---|
| Store Number | — | 100% blank. Ignore. |
| Company Name | Business unit | 16 distinct; the location signal. Names differ from CGOPS canonical (see §3). |
| Company City / Province | Payroll-entity address | 970/1167 say "Kitchener"; province constant "ON". **Not personal geography** — never touches `people.home_city`. Ignore. |
| Name | Legal/payroll name, "Last, First" | Present on all rows. |
| Preferred Name | Known-as name, "Last, First" | Differs from Name on 147 rows — including different **surnames** (legal vs used name). |
| Primary Position | Push position string | 31 distinct values; mapping table in §3. |
| Primary Department | FOH / BOH / Salaried Manager / Maintenance | Classifier only. |
| Primary Salary / Salary Period | Compensation | **Never imported.** Period (`hourly`/`biweekly`) is read transiently as a selection signal during classification, then discarded — neither value is ever stored. |
| Positions | Comma-joined multi-position list | Mostly kitchen stations/noise, plus raw payroll codes (`144385 DISH` etc.). Not used for assignments; retained only in redacted import lineage. |
| Location | — | 100% blank. Ignore. |

**Critical absences:** no Push employee ID, no email, no phone, no hire date.
Consequences: `people.external_refs.push_employee_id` **cannot** be populated
from this export (correlation would be name+company, which is fragile);
tenure is unknowable; nobody imported gets a login from this file.
**Recommendation:** request a Push export variant that includes employee ID
and hire date (email optional) before or shortly after the first import — or
accept backfilling by hand.

## 2. Which rows qualify for People Center V1

**Tier A — import as `person_kind = 'manager'`: the 115 salaried rows.**
Selection rule: salary period `biweekly` (read-and-discard) — which exactly
captures the management core and nothing else:

| Push Primary Position | Count | Notes |
|---|---|---|
| General Manager | 16 | |
| Assistant General Manager | 10 | |
| GM in Training | 2 | Mapping decision in §3 |
| Chef de Cuisine | 17 | → Head Chef (platform vocabulary) |
| Executive Chef | 1 | → Head Chef (platform vocabulary) |
| Sous Chef | 37 | 24 of these are dept-flagged "BOH," not "Salaried Manager" — the salaried signal catches them; a dept-only rule would miss them |
| Beverage Manager | 14 | Position missing from CGOPS vocabulary (§3) |
| Service Manager | 13 | Position missing from CGOPS vocabulary (§3) |
| Guest Service Manager | 3 | Position missing from CGOPS vocabulary (§3) |
| Events Manager | 2 | Position missing from CGOPS vocabulary (§3) |

**Tier B — do NOT bulk-import: the 80 hourly leadership-adjacent rows**
(76 Supervisors + 4 anomalies, all hourly, mostly dept-flagged "Salaried
Manager" because Push uses that department for shift leadership). These are
the natural **emerging-leader nomination pool**, and bulk-importing them
would pre-empt open decision **D4** (population boundary / who may add
people) and dilute "a person in People Center is someone leadership is
invested in." Recommendation: import none by default; hand the list to
regional leaders as nomination candidates once D4 is decided.

**Tier C — never in scope:** the remaining ~970 hourly FOH/BOH/maintenance
rows. Not imported, not retained in lineage beyond the batch row count.

**Needs-human-review list (import `disposition = 'needs_review'`):**
- 2 rows with Primary Position "Manager" (hourly, one location) and 1 row
  with Primary Position literally "Salaried Manager" (hourly) — title
  ambiguous, classify manually;
- 1 mgmt-flagged row with Primary Position "Grill" — likely a Push data
  error;
- 2 rows with Position/Department "None";
- 3 people appearing at **two** business units each — one `people` row,
  two `position_assignments`; a human picks `is_primary`.

## 3. Vocabulary mapping (Push → People Center → CGOPS)

Both mappings follow the CGOPS `location_mappings` lesson: **seeded mapping
tables, never free-text matching in code.**

**Locations.** Push "Company Name" values must map to CGOPS canonical
location names (Concept + City, no punctuation). Known divergences from the
canonical vocabulary: `Beertown White Oaks Mall` → `Beertown London White
Oaks`; `Sociable Kitchen + Tavern` → `Sociable Kitchen Tavern`; `Wildcraft
Waterloo` → `Wildcraft`. The other 13 (Beertown Waterloo/Barrie/Burlington/
Newmarket/Guelph/Oakville/Whitby/Etobicoke/Toronto/Cambridge/London, The
Bauer Kitchen, Sole) need verification against the live CGOPS `locations`
table when the org reference is seeded.

**Positions.**

| Push value | People Center position (CGOPS vocabulary) |
|---|---|
| General Manager | General Manager |
| Assistant General Manager | Assistant General Manager |
| GM in Training | **Decision needed** — recommend: Assistant General Manager assignment + a `gm_track` flag/note, rather than minting a position for a temporary state |
| Chef de Cuisine, Executive Chef | **Head Chef** — the platform explicitly standardized on Head Chef |
| Sous Chef | Sous Chef |
| Beverage Manager, Service Manager, Guest Service Manager, Events Manager | **Missing from CGOPS `positions` seed.** Recommend adding them to CGOPS first (admin-editable today, minutes of work) so People Center stays a pure referencer via `external_ref` — rather than weakening the "CGOPS is vocabulary master" invariant with local-only positions in the first month |
| Supervisor | No People Center position in V1 (Tier B is nomination-only) |

## 4. Field disposition

**Imported → `people`:** display name from **Preferred Name** (reordered
"First Last" — it is the name the person actually goes by, which is what a
relationship platform should lead with); `preferred_name` = its given-name
token; `person_kind = 'manager'`; `status = 'active'`.
**Imported → `position_assignments`:** mapped position + mapped location,
`is_primary = true`, `started_on = null` (meaning "predates import,
unknown" — the column must be nullable in the Phase 1 schema).

**Read but never stored:** Primary Salary Period (Tier A selector),
Primary Department (classifier), legal Name and raw Positions list (retained
only inside the redacted lineage row, not on `people` — payroll legal
identity stays Push's).

**Ignored entirely:** Primary Salary (compensation — excluded at parse time,
never reaches the database in any form, including lineage rows), Store
Number, Location, Company City, Company Province.

## 5. Import auditability — yes, two tables (Phase 1)

Recommend the generic pair (source-agnostic, so a future corrected export or
non-Push source uses the same machinery):

```sql
import_batches (
  id, source text,              -- 'push_roster'
  file_name, file_note,         -- provenance, e.g. "Push export May 11 2026"
  imported_on, imported_by_person_id,
  row_count int, imported_count int, skipped_count int, review_count int
)
import_rows (
  id, batch_id, row_number int,
  raw jsonb,                    -- REDACTED at parse time: salary fields never land here
  disposition text,             -- 'imported' | 'skipped_out_of_scope' | 'needs_review' | 'duplicate'
  person_id uuid                -- set when a people row was created/matched
)
```

RLS: admin-only, both tables. This gives every `people` row a traceable
lineage (`import_rows.person_id`), makes re-import idempotent (match on
batch source + row content), keeps the needs-review queue in the database
rather than a spreadsheet — and keeps `people` itself clean of import
plumbing. Redaction is a property of the parser, not a filter: salary
columns are dropped before the row is serialized.

(If the platform prefers the names `source_import_batches` /
`push_import_rows`, the shape is identical — the generic names are
recommended only because the second batch may not be Push.)

## 6. Effect on Phase 1 (and nothing else)

**Phase 0 is unaffected** — nothing in the roster requires any change to
`user_profiles`, `user_scopes`, `audit_log`, `events`, or the helpers. The
person/auth split already assumes people without logins, which is exactly
what this import produces.

Phase 1 scope adjustments:

1. **Replace the generic CSV importer** (already cut by review S4) with a
   purpose-built Push-roster import: parse → classify (Tier A/B/C) →
   redact → map → stage into `import_batches`/`import_rows` → create
   `people` + `position_assignments` → surface the needs-review queue.
2. **Add the two mapping tables** to the Phase 1 schema:
   `location_mappings (source_system, source_value, location_id)` and
   `position_mappings (source_system, source_value, position_id)`, seeded
   from §3.
3. **Add `import_batches` / `import_rows`** (§5), admin-only RLS.
4. **`position_assignments.started_on` must be nullable** (unknown start
   dates predate the import).
5. **CGOPS prerequisite:** add Beverage/Service/Guest Service/Events Manager
   to the CGOPS `positions` table before seeding org reference, so all
   People Center positions carry an `external_ref`.
6. **Emails/logins are decoupled:** imported people have no `auth_user_id`
   and no email; the handful who need logins (regional leaders, HQ) get
   invited separately and linked to their `people` row by an admin.

### New decisions for Phase 1 sign-off

| # | Decision | Recommendation |
|---|---|---|
| P1-1 | Tier A = the 115 salaried rows | Yes |
| P1-2 | Tier B supervisors: nomination-only vs bulk `emerging_leader` import | Nomination-only (respects D4) |
| P1-3 | GM in Training mapping | AGM assignment + `gm_track` signal |
| P1-4 | Add the four service-manager positions to CGOPS vocabulary | Yes, CGOPS-side, before seeding |
| P1-5 | Display name = Preferred Name (legal name stays in lineage only) | Yes |
| P1-6 | Request Push export with employee ID + hire date | Yes — unblocks `external_refs` correlation and tenure |
