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
import { FileText, Inbox, UserCog } from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import { errText } from '../../lib/errText'
import { can, toPermissionUser } from '../../permissions'
import { PersonPicker, type PickedPerson } from '../../components/PersonPicker'
import { InterviewSection } from './InterviewSection'
import { fetchPeopleOptions, type PersonOption } from '../bench/api'
import type { UserProfile } from '../../types'
import {
  STATUS_FLOW,
  STATUS_LABELS,
  checkWatchlist,
  fetchAllPositions,
  fetchApplicationDetail,
  fetchApplications,
  fetchHiringReviewers,
  fetchPriorApplications,
  fetchWatchlistEntriesByName,
  setApplicationStatus,
  setHiringReviewer,
  type ApplicationAck,
  type ApplicationEvent,
  type ApplicationRow,
  type ApplicationStatus,
  type HiringPosition,
  type HiringReviewer,
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
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

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
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Inbox className="h-5 w-5 text-cg-orange" /> Team Member applications
        </h2>
        <p className="mt-1 text-sm text-charcoal/60">
          The digital application record: every submission, its acknowledgements, and its stage
          history. Retention runs from date of submission.
        </p>
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
          {STATUS_FLOW.map((s) => (
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
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => setSelected(a)}
                  className="cursor-pointer border-b border-surface-line/60 last:border-0 hover:bg-surface-muted/50"
                >
                  <td className="px-4 py-2.5 font-medium">{a.applicant?.full_name ?? '?'}</td>
                  <td className="px-4 py-2.5">{a.desired_position}</td>
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
  const [nextStatus, setNextStatus] = useState<ApplicationStatus>(app.status)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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

        {watch.length > 0 && (
          <div
            className={`mb-3 rounded-md border px-3 py-2 text-xs ${
              watch.some((w) => w.list === 'black')
                ? 'border-danger/50 bg-danger/10'
                : 'border-warning/50 bg-warning/10'
            }`}
          >
            <p className={`font-medium ${watch.some((w) => w.list === 'black') ? 'text-danger' : 'text-warning'}`}>
              {watch.some((w) => w.list === 'black')
                ? 'This name matches the CG do-not-hire list. Do not interview, hire, or re-hire.'
                : 'This name matches the CG proceed-with-caution list.'}
            </p>
            {watchNotes.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-charcoal/75">
                {watchNotes.map((w) => (
                  <li key={w.id}>
                    {w.role && `${w.role} · `}
                    {w.former_cg && w.former_cg !== '-' && `${w.former_cg} · `}
                    {w.notes}
                    {w.noted_date && ` (${w.noted_date})`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-charcoal/70">
                Contact HQ (the People team) before taking this application any further — the
                details are held there. It may also be a different person with the same name.
              </p>
            )}
          </div>
        )}

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
          <dl className="grid grid-cols-1 gap-y-1.5 text-sm">
            {Object.entries(app.form).map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wide text-charcoal/45">{k.replace(/_/g, ' ')}</dt>
                <dd className="whitespace-pre-wrap text-charcoal/80">
                  {typeof v === 'string' ? v : JSON.stringify(v, null, 1)}
                </dd>
              </div>
            ))}
          </dl>
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

        <section className="mb-3 rounded-xl border border-surface-line p-3">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal/50">Move stage</h4>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value as ApplicationStatus)}
              className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
            >
              {STATUS_FLOW.map((s) => (
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
