// Hiring section pages (Team Member flow, Phase 1). Hiring is its own
// section of the app with its own left menu (HiringShell); this file holds
// its pages: ApplicationsView — the screening queue over the record the
// public intake writes — and ReviewersView — per-position reviewer config.
// Admin/executive see everything; a configured reviewer sees the
// applications for their positions (RLS enforced — this view renders
// whatever comes back). Prior applications by the same human are SURFACED
// to the manager, never acted on automatically.

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ExternalLink, FileText, Inbox, UserCog } from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import { errText } from '../../lib/errText'
import { can, toPermissionUser } from '../../permissions'
import { PersonPicker, type PickedPerson } from '../../components/PersonPicker'
import { InterviewSection } from './InterviewSection'
import { fetchPeopleOptions, type PersonOption } from '../bench/api'
import type { UserProfile } from '../../types'
import {
  MGMT_STATUS_FLOW,
  STATUS_FLOW,
  STATUS_LABELS,
  TERMINAL_STATUSES,
  checkWatchlist,
  daysSince,
  isStale,
  nextActionFor,
  pipelineFor,
  screenApplication,
  statusFlowFor,
  fetchAllPositions,
  fetchApplicationDetail,
  fetchApplications,
  fetchApprovals,
  fetchHiringReviewers,
  fetchMgmtApprovers,
  fetchPriorApplications,
  fetchWatchlistEntriesByName,
  recordApproval,
  setApplicationStatus,
  setHiringReviewer,
  type ApplicationAck,
  type ApplicationApproval,
  type ApplicationEvent,
  type ApplicationRow,
  type ApplicationStatus,
  type HiringPosition,
  type HiringReviewer,
  type MgmtApprover,
  type WatchlistEntry,
  type WatchlistMatch,
} from './api'

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-surface-muted text-charcoal/50',
  submitted: 'bg-info/10 text-info',
  screening: 'bg-warning/10 text-warning',
  interview: 'bg-warning/10 text-warning',
  reference_check: 'bg-warning/10 text-warning',
  decision_pending: 'bg-danger/10 text-danger',
  hired: 'bg-success/10 text-success',
  not_hired: 'bg-surface-muted text-charcoal/60',
  withdrawn: 'bg-surface-muted text-charcoal/45',
  culture_interview: 'bg-warning/10 text-warning',
  financial_interview: 'bg-warning/10 text-warning',
  tais: 'bg-warning/10 text-warning',
  final_interview: 'bg-warning/10 text-warning',
  approvals: 'bg-danger/10 text-danger',
  offer: 'bg-info/10 text-info',
}

// The status filter offers every stage across both flows, TM order first.
const FILTER_STATUSES = [...new Set([...STATUS_FLOW, ...MGMT_STATUS_FLOW])]

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

const ago = (iso: string) => {
  const d = daysSince(iso)
  return d <= 0 ? 'today' : d === 1 ? '1d ago' : `${d}d ago`
}

interface HiringPageProps {
  session: Session
  profile: UserProfile | null
}

export function ApplicationsView({ session, profile }: HiringPageProps) {
  const actor = actorFrom(profile, session)
  const user = profile ? toPermissionUser(profile) : null
  const isHq = user?.role === 'admin' || user?.role === 'executive'

  const [apps, setApps] = useState<ApplicationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('open')
  const [selected, setSelected] = useState<ApplicationRow | null>(null)

  const load = () => {
    fetchApplications()
      .then(setApps)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const visible = useMemo(() => {
    if (statusFilter === 'all') return apps
    if (statusFilter === 'open')
      return apps.filter((a) => !['hired', 'not_hired', 'withdrawn'].includes(a.status))
    return apps.filter((a) => a.status === statusFilter)
  }, [apps, statusFilter])

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading applications…</p>

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Inbox className="h-5 w-5 text-cg-orange" /> Team Member applications
          </h2>
          <p className="mt-1 text-sm text-charcoal/60">
            The digital application record: every submission, its acknowledgements, and its stage
            history. Retention runs from date of submission.
          </p>
        </div>
        {/* The guided public form, in preview mode (never submits). The live
            link for websites is /apply — submissions stay off until Michael
            flips HIRING_INTAKE_ENABLED. */}
        <span className="flex flex-wrap gap-2">
          <a
            href="/apply?preview=1"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Preview application form
          </a>
          <a
            href="/apply?flow=mgmt&preview=1"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Preview manager form
          </a>
        </span>
      </div>

      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs uppercase tracking-wide text-charcoal/50">Show</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        >
          <option value="open">Open (in progress)</option>
          <option value="all">All</option>
          {FILTER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="text-xs text-charcoal/50">
          {visible.length} application{visible.length === 1 ? '' : 's'}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-surface-line bg-surface px-4 py-8 text-center text-sm text-charcoal/55">
          {apps.length === 0
            ? isHq
              ? 'No applications yet. The public intake is deployed but disabled until Michael turns it on.'
              : 'No applications for the positions you review.'
            : 'Nothing matches this filter.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-surface-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
                <th className="px-4 py-3 font-medium">Applicant</th>
                <th className="px-4 py-3 font-medium">Position</th>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => setSelected(a)}
                  className="cursor-pointer border-b border-surface-line/60 last:border-0 hover:bg-surface-muted/50"
                >
                  <td className="px-4 py-2.5 font-medium">
                    <ScreenDot app={a} />
                    {a.applicant?.full_name ?? '?'}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.desired_position}
                    {a.flow === 'mgmt' && (
                      <span className="ml-1.5 rounded-full bg-charcoal/85 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-white">
                        Mgmt
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-charcoal/60">{a.location_name}</td>
                  <td className="px-4 py-2.5 text-xs whitespace-nowrap text-charcoal/60">
                    {new Date(a.submitted_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-xs capitalize text-charcoal/60">{a.source.replace('_', ' ')}</td>
                  <td className="px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[a.status]}`}>
                      {STATUS_LABELS[a.status]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-charcoal/60">
                    {ago(a.updated_at)}
                    {isStale(a) && (
                      <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                        stale
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <ApplicationPanel
          app={selected}
          actor={actor}
          onClose={() => setSelected(null)}
          onChanged={() => {
            load()
            setSelected(null)
          }}
        />
      )}
    </div>
  )
}

// Screening traffic light — flags derived from the application's own
// answers (screenApplication in api.ts), display-only: red = stop and
// check, yellow = caution with reasons, green = nothing in the answers to
// flag. The judgement stays with the reviewer; nothing is auto-actioned.

const SCREEN_STYLE = {
  red: { box: 'border-danger/50 bg-danger/10', chip: 'bg-danger text-white', label: 'Red — stop and check' },
  yellow: { box: 'border-warning/50 bg-warning/10', chip: 'bg-warning text-white', label: 'Yellow — proceed with caution' },
  green: { box: 'border-success/40 bg-success/10', chip: 'bg-success text-white', label: 'Green — nothing flagged' },
} as const

const DOT_STYLE = { red: 'bg-danger', yellow: 'bg-warning', green: 'bg-success' } as const

function ScreenDot({ app }: { app: ApplicationRow }) {
  // List-level dot uses the answers only (the watch-list check runs when the
  // application is opened); reasons in the hover title.
  const s = screenApplication(app)
  return (
    <span
      className={`mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle ${DOT_STYLE[s.level]}`}
      title={s.flags.length > 0 ? s.flags.map((x) => x.reason).join('\n') : 'Nothing flagged in the answers'}
    />
  )
}

function ScreeningCard({
  app,
  watch,
  watchNotes,
}: {
  app: ApplicationRow
  watch: WatchlistMatch[]
  watchNotes: WatchlistEntry[]
}) {
  const s = screenApplication(app, watch)
  const st = SCREEN_STYLE[s.level]
  return (
    <section className={`mb-3 rounded-md border px-3 py-2 text-xs ${st.box}`}>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${st.chip}`}>
          {st.label}
        </span>
        <span className="text-charcoal/55">from the application answers — the call is still yours</span>
      </div>
      {s.flags.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {s.flags.map((x, i) => (
            <li key={i} className={x.level === 'red' ? 'font-medium text-danger' : 'text-charcoal/75'}>
              {x.level === 'red' ? '⛔' : '⚠️'} {x.reason}
            </li>
          ))}
        </ul>
      )}
      {watchNotes.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 border-t border-surface-line/60 pt-1.5 text-charcoal/75">
          {watchNotes.map((w) => (
            <li key={w.id}>
              <span className="font-medium">Watch list:</span> {w.role && `${w.role} · `}
              {w.former_cg && w.former_cg !== '-' && `${w.former_cg} · `}
              {w.notes}
              {w.noted_date && ` (${w.noted_date})`}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Renders the application's answers as readable text, whatever shape the
// form took: the current guided form's structured fields get purpose-built
// formatting (address on one line, availability as day ranges, work history
// as job blocks); anything else — older records, future fields — falls back
// to a generic prose flattener. Never JSON on screen.

const labelize = (k: string) => k.replace(/_/g, ' ')

function prose(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(prose).join('; ')
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== '' && x !== null && x !== undefined)
      .map(([k, x]) => `${labelize(k)}: ${prose(x)}`)
      .join(' · ')
  }
  return String(v)
}

function FormDetails({ form }: { form: Record<string, unknown> }) {
  const f = form as Record<string, any>
  const rendered = new Set<string>()
  const rows: { label: string; value: React.ReactNode }[] = []
  const add = (key: string, label: string, value: React.ReactNode) => {
    if (f[key] === undefined) return
    rendered.add(key)
    rows.push({ label, value })
  }

  if (Array.isArray(f.positions)) add('positions', 'Positions', f.positions.join(', '))
  if (f.address && typeof f.address === 'object') {
    const a = f.address
    add(
      'address',
      'Address',
      [a.street, a.apt && `Apt ${a.apt}`, a.city, [a.province, a.postal_code].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', '),
    )
  }
  if (f.phones && typeof f.phones === 'object') {
    const p = f.phones
    add(
      'phones',
      'Phones',
      [p.day && `Day ${p.day}`, p.evening && `Evening ${p.evening}`, p.alternate && `Alternate ${p.alternate}`]
        .filter(Boolean)
        .join(' · ') || '—',
    )
  }
  add('work_eligibility', 'Work eligibility', prose(f.work_eligibility))
  add('minimum_age', 'Legal age to serve alcohol', prose(f.minimum_age))
  add('alcohol_service', 'Alcohol service', prose(f.alcohol_service))
  add('essential_functions', 'Can perform essential functions', prose(f.essential_functions))
  if (f.affiliated_history && typeof f.affiliated_history === 'object') {
    const ah = f.affiliated_history
    add(
      'affiliated_history',
      'Affiliated restaurants',
      ah.ever_employed === 'Yes'
        ? `Yes — ${ah.location || '?'}${ah.manager ? `, manager: ${ah.manager}` : ''}`
        : 'No',
    )
  }
  add('employment', 'Employment', prose(f.employment))
  if (f.availability && typeof f.availability === 'object') {
    rendered.add('availability')
    const av = f.availability
    const dayText =
      av.days && typeof av.days === 'object' && !Array.isArray(av.days)
        ? Object.entries(av.days as Record<string, any>)
            .map(([d, t]) => (t && typeof t === 'object' ? `${d} ${t.earliest ?? '?'}–${t.latest ?? '?'}` : `${d} ${prose(t)}`))
            .join(', ')
        : prose(av.days)
    const rest = Object.entries(av as Record<string, unknown>)
      .filter(([k, x]) => k !== 'days' && x !== '' && x !== null && x !== undefined)
      .map(([k, x]) => `${labelize(k)}: ${prose(x)}`)
      .join(' · ')
    rows.push({
      label: 'Availability',
      value: (
        <>
          <span className="block">{dayText || '—'}</span>
          {rest && <span className="block text-charcoal/65">{rest}</span>}
        </>
      ),
    })
  }
  if (Array.isArray(f.work_history)) {
    rendered.add('work_history')
    rows.push({
      label: 'Work history',
      value: (
        <div className="space-y-2">
          {f.work_history.map((j: any, i: number) =>
            j && typeof j === 'object' ? (
              <div key={i} className="rounded-md bg-surface-muted/50 px-2.5 py-1.5">
                <span className="block font-medium">
                  {j.company ?? j.employer ?? '?'}
                  {(j.from || j.to) && (
                    <span className="font-normal text-charcoal/55"> · {j.from ?? '?'} – {j.to ?? '?'}</span>
                  )}
                </span>
                {(j.position_duties ?? j.role) && <span className="block">{j.position_duties ?? j.role}</span>}
                <span className="block text-xs text-charcoal/60">
                  {[
                    j.address && `Address: ${j.address}`,
                    j.supervisor && `Supervisor: ${j.supervisor}${j.supervisor_phone ? ` (${j.supervisor_phone})` : ''}`,
                    j.may_contact && `May contact: ${j.may_contact}`,
                    j.hours_per_week && `${j.hours_per_week} hrs/wk`,
                    j.weekly_earnings && `Earnings: ${j.weekly_earnings}`,
                    j.reason_for_leaving && `Left: ${j.reason_for_leaving}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            ) : (
              <span key={i} className="block">{prose(j)}</span>
            ),
          )}
        </div>
      ),
    })
  }
  if (Array.isArray(f.references)) {
    rendered.add('references')
    rows.push({
      label: 'References',
      value: (
        <div className="space-y-0.5">
          {f.references.map((r: any, i: number) =>
            r && typeof r === 'object' ? (
              <span key={i} className="block">
                {r.name ?? '?'}
                {r.relationship && <span className="text-charcoal/60"> — {r.relationship}</span>}
                {r.years_known && <span className="text-charcoal/60">, known {r.years_known} yrs</span>}
                {r.phone && <span className="text-charcoal/60"> · {r.phone}</span>}
              </span>
            ) : (
              <span key={i} className="block">{prose(r)}</span>
            ),
          )}
        </div>
      ),
    })
  }
  add('how_heard', 'How they heard about us', prose(f.how_heard))
  if (f.declaration && typeof f.declaration === 'object') {
    const d = f.declaration
    add(
      'declaration',
      'Declaration',
      d.agreed
        ? `Agreed and signed "${d.signed_name ?? '?'}"${d.signed_at ? ` on ${new Date(d.signed_at).toLocaleDateString()}` : ''}${d.text_version ? ` (${d.text_version})` : ''}`
        : prose(d),
    )
  }
  // Anything not specially handled — older records, future fields.
  for (const [k, v] of Object.entries(form)) {
    if (!rendered.has(k)) rows.push({ label: labelize(k), value: prose(v) })
  }

  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm">
      {rows.map((r, i) => (
        <div key={i}>
          <dt className="text-[11px] uppercase tracking-wide text-charcoal/45">{r.label}</dt>
          <dd className="whitespace-pre-wrap text-charcoal/80">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// The application's path through the hiring process as a phase tracker:
// each stage a dot on the line, the current one live, terminal outcome at
// the end, updated-ago with a stale flag, and the next action per the CG
// hiring process.
function StageTracker({
  app,
  actor,
  onChanged,
  advanceBlock,
}: {
  app: ApplicationRow
  actor: ReturnType<typeof actorFrom>
  onChanged: () => void
  /** When set, the one-click advance is disabled and this reason is shown
   * (mgmt approvals gate: all named approvers must approve first). */
  advanceBlock?: string | null
}) {
  const stages = pipelineFor(app)
  const nextAction = nextActionFor(app)
  const terminal = TERMINAL_STATUSES.includes(app.status)
  const currentIdx = terminal ? stages.length : stages.indexOf(app.status)
  const stale = isStale(app)
  // One-click advance to the next pipeline stage; the final move (to an
  // outcome) stays a deliberate choice in the Move stage box below.
  const nextStage =
    !terminal && currentIdx >= 0 && currentIdx < stages.length - 1
      ? stages[currentIdx + 1]
      : null
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function advance() {
    if (!nextStage) return
    setBusy(true)
    setErr(null)
    try {
      await setApplicationStatus(actor, app, nextStage, '')
      onChanged()
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }
  return (
    <section className="mb-3 rounded-xl border border-surface-line p-3">
      <div className="flex items-start gap-0">
        {stages.map((s, i) => {
          const state = terminal || i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming'
          return (
            <div key={s} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <div className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : state === 'upcoming' ? 'bg-surface-line' : 'bg-cg-orange'}`} />
                <div
                  className={`h-3 w-3 shrink-0 rounded-full border-2 ${
                    state === 'done'
                      ? 'border-cg-orange bg-cg-orange'
                      : state === 'current'
                        ? 'border-cg-orange bg-surface'
                        : 'border-surface-line bg-surface'
                  }`}
                />
                <div
                  className={`h-0.5 flex-1 ${
                    i === stages.length - 1
                      ? terminal
                        ? 'bg-cg-orange'
                        : 'bg-transparent'
                      : (terminal || i < currentIdx)
                        ? 'bg-cg-orange'
                        : 'bg-surface-line'
                  }`}
                />
              </div>
              <span
                className={`mt-1 w-full truncate px-0.5 text-center text-[10px] leading-tight ${
                  state === 'current' ? 'font-semibold text-cg-orange' : state === 'done' ? 'text-charcoal/60' : 'text-charcoal/35'
                }`}
                title={STATUS_LABELS[s]}
              >
                {STATUS_LABELS[s]}
              </span>
            </div>
          )
        })}
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <div className="flex w-full items-center">
            <div className={`h-0.5 flex-1 ${terminal ? 'bg-cg-orange' : 'bg-surface-line'}`} />
            <div className={`h-3 w-3 shrink-0 rounded-full border-2 ${terminal ? 'border-cg-orange bg-cg-orange' : 'border-surface-line bg-surface'}`} />
            <div className="h-0.5 flex-1 bg-transparent" />
          </div>
          <span className={`mt-1 w-full truncate px-0.5 text-center text-[10px] leading-tight ${terminal ? 'font-semibold text-cg-orange' : 'text-charcoal/35'}`}>
            {terminal ? STATUS_LABELS[app.status] : 'Outcome'}
          </span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-charcoal/55">
        <span>
          Updated {ago(app.updated_at)} · in this process since {new Date(app.submitted_at).toLocaleDateString()}
        </span>
        {stale && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
            stale — no movement in {daysSince(app.updated_at)} days
          </span>
        )}
      </div>
      {nextAction && (
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-md bg-cg-orange-soft/40 px-2.5 py-1.5">
          <p className="min-w-0 flex-1 text-xs text-charcoal/75">
            <span className="font-medium text-cg-orange">Next:</span> {nextAction}
          </p>
          {nextStage && (
            <button
              onClick={() => void advance()}
              disabled={busy || Boolean(advanceBlock)}
              title={advanceBlock ?? undefined}
              className="shrink-0 rounded-md bg-cg-orange px-2.5 py-1 text-xs font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
            >
              {busy ? 'Moving…' : `Move to ${STATUS_LABELS[nextStage]} →`}
            </button>
          )}
        </div>
      )}
      {advanceBlock && <p className="mt-1 text-xs font-medium text-danger">{advanceBlock}</p>}
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
    </section>
  )
}

function ApplicationPanel({
  app,
  actor,
  onClose,
  onChanged,
}: {
  app: ApplicationRow
  actor: ReturnType<typeof actorFrom>
  onClose: () => void
  onChanged: () => void
}) {
  const [acks, setAcks] = useState<ApplicationAck[]>([])
  const [events, setEvents] = useState<ApplicationEvent[]>([])
  const [prior, setPrior] = useState<Awaited<ReturnType<typeof fetchPriorApplications>>>([])
  const [watch, setWatch] = useState<WatchlistMatch[]>([])
  const [watchNotes, setWatchNotes] = useState<WatchlistEntry[]>([])
  const [approvers, setApprovers] = useState<MgmtApprover[]>([])
  const [approvals, setApprovals] = useState<ApplicationApproval[]>([])
  const [nextStatus, setNextStatus] = useState<ApplicationStatus>(app.status)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const loadApprovals = () => {
    if (app.flow !== 'mgmt') return
    fetchMgmtApprovers().then(setApprovers).catch(() => setApprovers([]))
    fetchApprovals(app.id).then(setApprovals).catch(() => setApprovals([]))
  }
  useEffect(loadApprovals, [app.id, app.flow])

  // Michael's accountability gate: every named approver for this track must
  // have approved before the application can advance past Approvals.
  const requiredApprovers = useMemo(
    () => approvers.filter((a) => a.track === app.track),
    [approvers, app.track],
  )
  const allApproved =
    requiredApprovers.length > 0 &&
    requiredApprovers.every((r) =>
      approvals.some((x) => x.approver_person_id === r.person_id && x.decision === 'approved'),
    )
  const approvalsGate =
    app.flow === 'mgmt' && app.status === 'approvals' && !allApproved
      ? 'All named approvers must approve (below) before this moves to Offer.'
      : null

  useEffect(() => {
    fetchApplicationDetail(app.id)
      .then((d) => {
        setAcks(d.acks)
        setEvents(d.events)
      })
      .catch((e: Error) => setErr(e.message))
    fetchPriorApplications(app.applicant_id, app.id).then(setPrior).catch(() => setPrior([]))
    // Watch-list check: the RPC tells anyone WHICH list matched (never the
    // notes); the table read returns the notes only to admin/executive (RLS).
    const nm = app.applicant?.full_name
    if (nm) {
      checkWatchlist(nm).then(setWatch).catch(() => setWatch([]))
      fetchWatchlistEntriesByName(nm).then(setWatchNotes).catch(() => setWatchNotes([]))
    }
  }, [app.id, app.applicant_id, app.applicant?.full_name])

  async function saveStatus() {
    if (nextStatus === app.status) return
    // The manual mover honours the same gate as the one-click advance —
    // an Offer (or Hired) needs every named approver's sign-off first.
    if (
      app.flow === 'mgmt' &&
      !allApproved &&
      ['offer', 'hired'].includes(nextStatus)
    ) {
      setErr('All named approvers must approve before this application can move to Offer or Hired.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await setApplicationStatus(actor, app, nextStatus, note.trim())
      onChanged()
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  return (
    <>
      <button aria-label="Close" onClick={onClose} className="fixed inset-0 z-30 bg-charcoal/20" />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col overflow-y-auto border-l border-surface-line bg-surface p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">{app.applicant?.full_name ?? 'Applicant'}</h3>
            <p className="text-sm text-charcoal/60">
              {app.desired_position} — {app.location_name}
            </p>
            <p className="mt-0.5 text-xs text-charcoal/50">
              {app.applicant?.email ?? 'no email'} · {app.applicant?.phone ?? 'no phone'} · via{' '}
              {app.source.replace('_', ' ')}
            </p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[app.status]}`}>
            {STATUS_LABELS[app.status]}
          </span>
        </div>

        <StageTracker app={app} actor={actor} onChanged={onChanged} advanceBlock={approvalsGate} />

        <ScreeningCard app={app} watch={watch} watchNotes={watchNotes} />

        {prior.length > 0 && (
          <div className="mb-3 rounded-md border border-info/40 bg-info/5 px-3 py-2 text-xs">
            <p className="font-medium text-info">
              Applied {prior.length} other time{prior.length === 1 ? '' : 's'} — for your judgment, not an
              automatic screen:
            </p>
            <ul className="mt-1 space-y-0.5 text-charcoal/70">
              {prior.map((p) => (
                <li key={p.id}>
                  {new Date(p.submitted_at).toLocaleDateString()} · {p.desired_position} — {p.location_name} ·{' '}
                  {STATUS_LABELS[p.status as ApplicationStatus] ?? p.status}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className="mb-3 rounded-xl border border-surface-line p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal/50">
            <FileText className="h-3.5 w-3.5" /> Application
          </h4>
          <FormDetails form={app.form} />
          <p className="mt-2 border-t border-surface-line pt-2 text-[11px] text-charcoal/50">
            Submitted {fmt(app.submitted_at)} · retention until {app.retention_purge_after}
            {!app.complete && ' · INCOMPLETE'}
          </p>
          {acks.length > 0 && (
            <p className="mt-1 text-[11px] text-success">
              {acks
                .map(
                  (a) =>
                    `${a.doc === 'job_description' ? 'Job description' : 'Uniform & grooming'} acknowledged ${fmt(a.acknowledged_at)}`,
                )
                .join(' · ')}
            </p>
          )}
        </section>

        <InterviewSection app={app} actor={actor} />

        {app.flow === 'mgmt' && (
          <ApprovalsSection
            app={app}
            actor={actor}
            required={requiredApprovers}
            approvals={approvals}
            onRecorded={loadApprovals}
          />
        )}

        <section className="mb-3 rounded-xl border border-surface-line p-3">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal/50">Move stage</h4>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value as ApplicationStatus)}
              className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
            >
              {statusFlowFor(app).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for the record (optional)"
              className="min-w-56 flex-1 rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
            />
            <button
              onClick={() => void saveStatus()}
              disabled={busy || nextStatus === app.status}
              className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-charcoal/50">
            Reference checks and the one-week decision-communication clock arrive later in Phase 2 —
            every move is recorded in the history below.
          </p>
          {err && <p className="mt-1 text-xs text-danger">{err}</p>}
        </section>

        <section className="rounded-xl border border-surface-line p-3">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal/50">History</h4>
          <ul className="space-y-1 text-xs">
            {events.map((ev, i) => (
              <li key={i} className="flex items-baseline gap-2">
                <span className="shrink-0 tabular-nums text-charcoal/40">{fmt(ev.created_at)}</span>
                <span className="text-charcoal/75">
                  {ev.event.replace(/[._]/g, ' ')} — {ev.actor_name}
                  {ev.detail && <span className="text-charcoal/50"> · {ev.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </>
  )
}

// Sign-offs on a management hire — Michael's ruling (2026-09-03): Megan
// Stover + John Mackay approve all FOH managers; Todd Clarmo + Michael
// Hodgson approve all BOH chefs. The required approvers are data
// (people_center_mgmt_approvers); RLS lets an approver sign ONLY as
// themselves, and a signature is immutable once written. The UI shows the
// buttons only to the signed-in named approver — the database is the
// enforcement, this is just honest chrome.
function ApprovalsSection({
  app,
  actor,
  required,
  approvals,
  onRecorded,
}: {
  app: ApplicationRow
  actor: ReturnType<typeof actorFrom>
  required: MgmtApprover[]
  approvals: ApplicationApproval[]
  onRecorded: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const byPerson = new Map(approvals.map((a) => [a.approver_person_id, a]))
  const myRow = actor.personId ? required.find((r) => r.person_id === actor.personId) : undefined
  const myDecision = actor.personId ? byPerson.get(actor.personId) : undefined
  const extras = approvals.filter((a) => !required.some((r) => r.person_id === a.approver_person_id))
  const trackLabel = app.track === 'boh' ? 'BOH chefs' : 'FOH managers'

  async function sign(decision: 'approved' | 'rejected') {
    setBusy(true)
    setErr(null)
    try {
      await recordApproval(actor, app, decision, note.trim())
      setNote('')
      onRecorded()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-3 rounded-xl border border-surface-line p-3">
      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal/50">
        Sign-offs — required for all {trackLabel}
      </h4>
      <p className="mb-2 text-[11px] text-charcoal/50">
        Each approver signs personally; a signature cannot be edited or removed. The application
        cannot move to Offer until everyone below has approved.
      </p>
      {required.length === 0 ? (
        <p className="text-xs text-danger">
          No approvers are configured for this track — contact HQ before proceeding.
        </p>
      ) : (
        <ul className="space-y-1">
          {required.map((r) => {
            const d = byPerson.get(r.person_id)
            return (
              <li
                key={r.person_id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-surface-line px-3 py-1.5 text-sm"
              >
                <span className="font-medium">{r.person_name}</span>
                {d ? (
                  <span className="text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        d.decision === 'approved' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                      }`}
                    >
                      {d.decision === 'approved' ? 'Approved' : 'Rejected'}
                    </span>{' '}
                    <span className="text-charcoal/50">{fmt(d.created_at)}</span>
                    {d.note && <span className="block text-charcoal/65">“{d.note}”</span>}
                  </span>
                ) : (
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-charcoal/50">
                    Pending
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {extras.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-charcoal/60">
          {extras.map((a) => (
            <li key={a.id}>
              {a.approver_name}: {a.decision} {fmt(a.created_at)}
              {a.note && ` — “${a.note}”`}
            </li>
          ))}
        </ul>
      )}
      {myRow && !myDecision && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-cg-orange/40 bg-cg-orange-soft/20 p-2.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the record (optional)"
            className="min-w-48 flex-1 rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          />
          <button
            onClick={() => void sign('approved')}
            disabled={busy}
            className="rounded-md bg-success px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Signing…' : 'Approve'}
          </button>
          <button
            onClick={() => void sign('rejected')}
            disabled={busy}
            className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
      {err && <p className="mt-1.5 text-xs text-danger">{err}</p>}
    </section>
  )
}

export function ReviewersView({ session, profile }: HiringPageProps) {
  const actor = actorFrom(profile, session)
  const user = profile ? toPermissionUser(profile) : null
  const canConfigure = can(user, 'update', 'hiring')

  const [positions, setPositions] = useState<HiringPosition[]>([])
  const [reviewers, setReviewers] = useState<HiringReviewer[]>([])
  const [people, setPeople] = useState<PersonOption[]>([])
  const [positionId, setPositionId] = useState('')
  const [reviewer, setReviewer] = useState<PickedPerson>({ name: '', personId: null })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = () => {
    Promise.all([fetchAllPositions(), fetchHiringReviewers(), fetchPeopleOptions()])
      .then(([p, r, pe]) => {
        setPositions(p)
        setReviewers(r)
        setPeople(pe)
      })
      .catch((e: Error) => setErr(e.message))
  }
  useEffect(load, [])

  const posById = useMemo(() => new Map(positions.map((p) => [p.id, p.name])), [positions])

  async function save() {
    if (!positionId || !reviewer.personId) return
    setBusy(true)
    setErr(null)
    try {
      await setHiringReviewer(actor, positionId, posById.get(positionId) ?? '?', reviewer.personId, reviewer.name)
      setPositionId('')
      setReviewer({ name: '', personId: null })
      load()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function clear(r: HiringReviewer) {
    setBusy(true)
    setErr(null)
    try {
      await setHiringReviewer(actor, r.position_id, posById.get(r.position_id) ?? '?', null, null)
      load()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!canConfigure) {
    return (
      <p className="p-6 text-sm text-charcoal/55">
        Reviewer configuration is limited to executives and admins.
      </p>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <UserCog className="h-5 w-5 text-cg-orange" /> Reviewers
        </h2>
        <p className="mt-1 text-sm text-charcoal/60">
          Who reviews applications, per position. The reviewer sees and works that position's
          applications; admin/executive always see everything.
        </p>
      </div>

      <div className="rounded-xl border border-surface-line bg-surface p-4">
        {reviewers.length > 0 ? (
          <ul className="mb-3 space-y-1">
            {reviewers.map((r) => (
              <li key={r.position_id} className="flex items-center justify-between gap-2 rounded-md border border-surface-line bg-surface px-3 py-1.5 text-sm">
                <span>
                  {posById.get(r.position_id) ?? r.position_id} → <span className="font-medium">{r.reviewer_name ?? '?'}</span>
                </span>
                <button
                  onClick={() => void clear(r)}
                  disabled={busy}
                  className="text-xs font-medium text-charcoal/40 hover:text-danger disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-charcoal/55">
            No reviewers configured yet — until then only admin/executive see applications.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
            className="min-w-48 rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">— position —</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="min-w-56">
            <PersonPicker people={people} value={reviewer} onChange={setReviewer} placeholder="Reviewer…" />
          </div>
          <button
            onClick={() => void save()}
            disabled={busy || !positionId || !reviewer.personId}
            className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
          >
            Set reviewer
          </button>
        </div>
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      </div>
    </div>
  )
}
