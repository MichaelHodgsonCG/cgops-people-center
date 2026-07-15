# Project Log

## [2026-07-15] Manual add + admin-confirmed Push linking
**Shipped:**   Add people by hand from the Directory — HQ (active, off-roster) and candidates (not-yet-hired), alongside incoming hires. A roster sync that name-matches an unlinked manual profile now holds it as a "possible match" (Data Sources → Pending links) for an admin to Confirm (links Push identity, preserves manual data) or Reject (imports as new). Candidates stay off the org chart. Confirmed answer to the sync-behavior question: uploads add + link, never merge/overwrite leadership-entered data.
**Roadmap:**   Manual people & Push linking -> complete (code); deploy + migration -> in progress (owner running)
**Decisions:** Admin-confirmed linking over auto-by-name (avoids false merges on common names); `candidate` status + `off_roster` flag over reusing active/incoming (distinguishes prospects and HQ; keeps sync from flagging HQ as missing); linking preserves manual data, only stamps `external_refs.push_source_key` + fills an empty assignment (upholds ADR 0005 "never overwrite"); reuse existing source_key correlation rather than a new link table.
**Blockers:**  Migration 20260709090000 must be applied to the CGOPS Platform Supabase project before the new UI works on live data (owner deploying).
**Next:**      Owner deploys + runs migration, then returns with feedback.
