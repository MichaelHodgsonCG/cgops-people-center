# CLAUDE.md — People Center

Project name for logging/filing purposes: **People Center**.
This repo is the People Center app (see README.md); it runs against the
shared CGOPS Supabase project with all objects under the `people_center_`
prefix.

## Session log + filing protocol (v2, CG) — follow every session

SESSION LOG + FILING PROTOCOL (v2, CG)

YOUR PROJECT NAME is the one this chat serves (e.g. "Menu Center").

YOUR BUS: Charcoal Group projects file to the CG bus — Supabase project
qzzhifdwoixqjgugbevq (cgops-platform), table cc_project_artifacts. Do not
file to, request access to, or accept a connector for any Supabase
organization outside Charcoal Group. Connectors are organization-scoped;
crossing organizations exposes unrelated systems. If your bus is
unreachable, use the fallback below — never substitute a different bus.

LOCAL LOG: maintain PROJECT-LOG.md at the repo root. At the end of every
working session (or when a meaningful unit ships), PREPEND one entry:

[YYYY-MM-DD] <short session title>
Shipped:   <what now works / what changed>
Roadmap:   <phase or item> -> <planned | in progress | complete>
Decisions: <decision + one-line rationale>   (or "none")
Blockers:  <blocker or risk>                 (or "none")
Next:      <the next concrete step>

Factual and terse. Never put secrets, credentials, or customer data in it.

BUS FILING, SAME TURN: file the same entry to your bus. Set
artifact_type='note', metadata.kind='session_log',
metadata.project=<your project name>, metadata.filed_by=<your chat name>.
Same turn, not later. After writing, RE-READ the row by its returned id and
only then say it is filed — never claim a write you have not read back.

FILE EVEN WHEN NOTHING HAPPENED: a session that built nothing still files
one authoritative line saying so, with what you checked. Silence reads as a
missing session; "no change, here's what I verified" is a result.

IF YOU CANNOT REACH YOUR BUS: say so plainly instead of skipping. Still
write the local PROJECT-LOG.md entry, then output "portfolio sync" — the
last N entries as one copy-paste block, no commentary, for Michael to carry.

ASKS ARE FOR MICHAEL: anything needing his action goes in a plain-language
open_asks list — no bare ticket numbers, row ids, or jargon.

CONTENT BOUNDARY: CG filings and logs contain CG material only. If you
encounter material belonging to another organization or portfolio, do not
file it, quote it, or carry it — say you set it aside.

ONLY YOUR OWN WORK: report what this chat did and verified. Never restate
another chat's claims as your own findings.

PERSIST THIS: if this repo has a CLAUDE.md, record this protocol there now
(verbatim, including the bus ref) so every future session inherits it
without a paste. Confirm in this session's log entry that it is persisted.

## Filing conventions used by this project

- `metadata.project` = `People Center`
- `metadata.filed_by` = `People Center (Claude Code)`
- `title` = `[YYYY-MM-DD] <short session title>` (matches the local log entry)
- `content` = the full log entry text; `status` = `active`
- PROJECT-LOG.md entries use the existing house format:
  `## [YYYY-MM-DD] <title>` followed by bold `**Shipped/Roadmap/Decisions/Blockers/Next:**` lines, newest first.
