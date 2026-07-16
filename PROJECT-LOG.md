# Project Log

## [2026-07-16] Fixed Michael's admin access; applied position ranking (1b)
**Shipped:**   Root-caused the Positions-sync rejection: Michael's admin profile was linked to a deleted auth user, so the UI trusted him (role resolved by email) but every DB write failed is_admin() (matches by auth.uid()). Re-pointed his profile to his live auth user — all admin writes (incl. sync) work now, no re-login. Person record already "Michael Hodgson"; set preferred_name "Michael"; login display untouched. Applied 1b: position levels (GM 10 -> Chef de Partie 50) + default_reports_to accountability lines + added Senior Sous Chef.
**Roadmap:**   1b ranking/reporting -> complete (DB + repo migration 20260716090000). HQ seed (1c) + HQ positions in CGOPS -> next.
**Decisions:** Ranking/reporting per Michael's confirmations (AGM 25 reports to GM; Supervisor -> GM; kitchen CdC>Sr Sous>Sous>CdP). Auth-link fix is a data correction, not a migration.
**Blockers:**  none. Note: Supervisor is people_center_eligible=true in live data (drift from ADR 0004 nomination-only) — left as-is pending Michael's call.
**Next:**      HQ seed: add ~22 HQ titles to CGOPS positions, create a Head Office location, seed ~30 HQ people (reconcile existing Michael + Megan) with reporting lines — pending Michael's go on the approach.

## [2026-07-15] Mobile "Visit" walk-in + org rules locked
**Shipped:**   New "Visit" nav view — mobile-first location → managers → notes: pick a restaurant, see its people seniority-ordered, tap to open the cheat sheet and read/add/save notes; last location remembered; big touch targets. Also fixed the Positions-sync error display ([object Object] → real Postgrest message). Both frontend-only; deploy on Vercel to use.
**Roadmap:**   1a Visit walk-in -> complete (code; deploy pending). Sync error-display fix -> shipped.
**Decisions:** Restaurant template locked — AGM sits between rank 2/3, reports to GM; FOH Supervisors -> GM by default; kitchen Chef de Cuisine > Senior Sous > Sous > Chef de Partie; Regional Ops Leaders -> John Mackay except Cindy Fawcett -> Jody (CEO); HQ titles created CGOPS-side then synced. Note: user is Chef Mike Hodgson — app session likely maps to a non-admin profile, the probable cause of the Positions-sync rejection.
**Blockers:**  Supabase paused at user's request — position-sync admin-role diagnosis, 1b (levels + template migration) and 1c (HQ seed) all wait on it.
**Next:**      When Supabase clears: confirm/fix sync admin-role; draft + apply 1b (position levels + per-concept required-role template) and 1c (HQ team seed from Chart 2).

## [2026-07-15] Position vocabulary sync (CGOPS -> People Center)
**Shipped:**   People Center positions now sync from the CGOPS Operational Center master instead of being a hand-seeded copy. New Data Sources → Positions tab: "Sync from CGOPS" button + a grid to toggle show-in-pickers / roster-eligibility / default kind per position. `people_center_sync_positions_from_cgops()` links by external_ref, refreshes CGOPS-owned fields, and materializes new CGOPS positions hidden+ineligible until curated. Pickers filter to curated positions; `Needs Position Review` placeholder hidden. Adding an HQ position = add once in CGOPS, sync, toggle on.
**Roadmap:**   Position vocabulary sharing -> complete (code shipped; migration 20260715120000 applied + verified on live project)
**Decisions:** Sync two tables over one shared table (ADR 0012) — the two lists are different curations (membership/granularity/columns), so sharing re-encodes the divergence + forces a live FK migration + couples PC to CGOPS lifecycle; field ownership (CGOPS=name/desc, PC=config) makes bi-directional editing safe; PC-side pull, not a CGOPS trigger, to keep PC logic off CGOPS's write path.
**Blockers:**  none
**Next:**      Deploy frontend; run first "Sync from CGOPS" (admin, in-app) to materialize the CGOPS catalog; toggle on HQ positions and fix Supervisor roster-eligibility drift in the same panel.

## [2026-07-15] Manual add + admin-confirmed Push linking
**Shipped:**   Add people by hand from the Directory — HQ (active, off-roster) and candidates (not-yet-hired), alongside incoming hires. A roster sync that name-matches an unlinked manual profile now holds it as a "possible match" (Data Sources → Pending links) for an admin to Confirm (links Push identity, preserves manual data) or Reject (imports as new). Candidates stay off the org chart. Confirmed answer to the sync-behavior question: uploads add + link, never merge/overwrite leadership-entered data.
**Roadmap:**   Manual people & Push linking -> complete (code); deploy + migration -> in progress (owner running)
**Decisions:** Admin-confirmed linking over auto-by-name (avoids false merges on common names); `candidate` status + `off_roster` flag over reusing active/incoming (distinguishes prospects and HQ; keeps sync from flagging HQ as missing); linking preserves manual data, only stamps `external_refs.push_source_key` + fills an empty assignment (upholds ADR 0005 "never overwrite"); reuse existing source_key correlation rather than a new link table.
**Blockers:**  Migration 20260709090000 must be applied to the CGOPS Platform Supabase project before the new UI works on live data (owner deploying).
**Next:**      Owner deploys + runs migration, then returns with feedback.
