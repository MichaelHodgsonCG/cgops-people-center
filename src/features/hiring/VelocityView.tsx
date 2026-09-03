// Pipeline Speed (Admin Center) — Michael's ask, 2026-09-03: "getting more
// efficient at moving candidates through the process… expose which managers
// are quick, who takes too long." Derived entirely from the stage-move
// events the workflow already records: each stage.<status> event closes the
// previous stage, so the gap is how long that step took and the event's
// actor is who moved it. Nothing new is written — this page only reads.
//
// ADMIN-ONLY for now, per Michael. When he opens it to Execs/ROLs, widen
// the single `can(...)` gate below (and the AdminShell nav resource).

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ChevronDown, ChevronRight, Gauge } from 'lucide-react'
import { can, toPermissionUser } from '../../permissions'
import type { UserProfile } from '../../types'
import {
  STATUS_LABELS,
  TERMINAL_STATUSES,
  fetchAllStageEvents,
  fetchApplications,
  type ApplicationRow,
  type ApplicationStatus,
  type StageMoveEvent,
} from './api'

const DAY = 86_400_000

/** "18m", "6h", "3d 4h" — pipeline pace reads best in the unit it happens in. */
function fmtDur(ms: number): string {
  if (ms < 0) ms = 0
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/** Pace colour: under 2 days is quick, 7+ days matches the stale threshold. */
function paceCls(ms: number): string {
  if (ms < 2 * DAY) return 'bg-success/10 text-success'
  if (ms < 7 * DAY) return 'bg-warning/10 text-warning'
  return 'bg-danger/10 text-danger'
}

interface StagePeriod {
  stage: string // status the application was sitting in
  startedAt: number
  endedAt: number | null // null = still sitting there
  movedBy: string | null // who ended the wait (actor of the closing event)
}

interface CandidateRow {
  app: ApplicationRow
  periods: StagePeriod[]
  totalMs: number // submitted -> outcome (or now)
  openMs: number | null // time sitting in the current stage, open apps only
}

interface ManagerRow {
  name: string
  moves: number
  avgMs: number
  medianMs: number
  maxMs: number
}

export function VelocityView({ profile }: { session: Session; profile: UserProfile | null }) {
  const user = profile ? toPermissionUser(profile) : null
  const isAdmin = can(user, 'view', 'admin_area')

  const [apps, setApps] = useState<ApplicationRow[]>([])
  const [events, setEvents] = useState<StageMoveEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    Promise.all([fetchApplications(), fetchAllStageEvents()])
      .then(([a, e]) => {
        setApps(a)
        setEvents(e)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [isAdmin])

  const now = Date.now()

  const candidates = useMemo<CandidateRow[]>(() => {
    const byApp = new Map<string, StageMoveEvent[]>()
    for (const ev of events) {
      const list = byApp.get(ev.application_id) ?? []
      list.push(ev)
      byApp.set(ev.application_id, list)
    }
    return apps.map((app) => {
      const evs = byApp.get(app.id) ?? []
      const periods: StagePeriod[] = []
      let cursorStage = 'submitted'
      let cursorAt = new Date(app.submitted_at).getTime()
      for (const ev of evs) {
        const at = new Date(ev.created_at).getTime()
        periods.push({ stage: cursorStage, startedAt: cursorAt, endedAt: at, movedBy: ev.actor_name })
        cursorStage = ev.event.slice('stage.'.length)
        cursorAt = at
      }
      const terminal = TERMINAL_STATUSES.includes(app.status)
      periods.push({ stage: cursorStage, startedAt: cursorAt, endedAt: terminal ? cursorAt : null, movedBy: null })
      const endMs = terminal ? cursorAt : now
      return {
        app,
        periods,
        totalMs: endMs - new Date(app.submitted_at).getTime(),
        openMs: terminal ? null : now - cursorAt,
      }
    })
  }, [apps, events, now])

  const managers = useMemo<ManagerRow[]>(() => {
    // Each stage-move event ends a wait; the mover owns that wait's length.
    const byApp = new Map<string, StageMoveEvent[]>()
    for (const ev of events) {
      const list = byApp.get(ev.application_id) ?? []
      list.push(ev)
      byApp.set(ev.application_id, list)
    }
    const durs = new Map<string, number[]>()
    for (const app of apps) {
      let cursor = new Date(app.submitted_at).getTime()
      for (const ev of byApp.get(app.id) ?? []) {
        const at = new Date(ev.created_at).getTime()
        const list = durs.get(ev.actor_name) ?? []
        list.push(Math.max(0, at - cursor))
        durs.set(ev.actor_name, list)
        cursor = at
      }
    }
    return [...durs.entries()]
      .map(([name, list]) => {
        const sorted = [...list].sort((a, b) => a - b)
        return {
          name,
          moves: list.length,
          avgMs: list.reduce((n, x) => n + x, 0) / list.length,
          medianMs: sorted[Math.floor(sorted.length / 2)],
          maxMs: sorted[sorted.length - 1],
        }
      })
      .sort((a, b) => a.avgMs - b.avgMs)
  }, [apps, events])

  const open = candidates.filter((c) => c.openMs !== null)
  const closed = candidates.filter((c) => c.openMs === null)
  const avgTotal = closed.length > 0 ? closed.reduce((n, c) => n + c.totalMs, 0) / closed.length : null
  const slowestOpen = open.length > 0 ? [...open].sort((a, b) => (b.openMs ?? 0) - (a.openMs ?? 0))[0] : null

  if (!isAdmin) {
    return <p className="p-6 text-sm text-charcoal/55">Pipeline Speed is limited to admins for now.</p>
  }
  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading pipeline history…</p>

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Gauge className="h-5 w-5 text-cg-orange" /> Pipeline Speed
        </h2>
        <p className="mt-1 text-sm text-charcoal/60">
          How long candidates sit between steps, and who moves them. Read straight from the
          workflow's own history — under 2 days shows green, over 7 days (our stale threshold)
          shows red. Test candidates walked through in minutes will show tiny times.
        </p>
      </div>

      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-surface-line bg-surface px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-charcoal/45">Open applications</p>
          <p className="text-lg font-semibold">{open.length}</p>
        </div>
        <div className="rounded-xl border border-surface-line bg-surface px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-charcoal/45">Avg time to outcome</p>
          <p className="text-lg font-semibold">{avgTotal !== null ? fmtDur(avgTotal) : '—'}</p>
        </div>
        <div className="rounded-xl border border-surface-line bg-surface px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-charcoal/45">Longest current wait</p>
          <p className="text-lg font-semibold">
            {slowestOpen ? (
              <>
                {fmtDur(slowestOpen.openMs ?? 0)}
                <span className="ml-1.5 text-xs font-normal text-charcoal/55">
                  {slowestOpen.app.applicant?.full_name} · {STATUS_LABELS[slowestOpen.app.status]}
                </span>
              </>
            ) : (
              '—'
            )}
          </p>
        </div>
      </div>

      <section className="mb-5 rounded-xl border border-surface-line bg-surface">
        <h3 className="border-b border-surface-line px-4 py-3 text-sm font-semibold">
          Managers — who moves candidates, and how fast
        </h3>
        {managers.length === 0 ? (
          <p className="px-4 py-6 text-sm text-charcoal/55">No stage moves recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
                  <th className="px-4 py-2.5 font-medium">Manager</th>
                  <th className="px-4 py-2.5 font-medium">Moves</th>
                  <th className="px-4 py-2.5 font-medium">Median wait they close</th>
                  <th className="px-4 py-2.5 font-medium">Average</th>
                  <th className="px-4 py-2.5 font-medium">Longest</th>
                </tr>
              </thead>
              <tbody>
                {managers.map((m) => (
                  <tr key={m.name} className="border-b border-surface-line/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{m.name}</td>
                    <td className="px-4 py-2.5 tabular-nums">{m.moves}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${paceCls(m.medianMs)}`}>
                        {fmtDur(m.medianMs)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-charcoal/70">{fmtDur(m.avgMs)}</td>
                    <td className="px-4 py-2.5 text-xs text-charcoal/70">{fmtDur(m.maxMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-surface-line px-4 py-2 text-[11px] text-charcoal/50">
          A "move" is any stage change a person recorded; the time shown is how long the candidate
          had been waiting when they moved it. Sorted fastest first.
        </p>
      </section>

      <section className="rounded-xl border border-surface-line bg-surface">
        <h3 className="border-b border-surface-line px-4 py-3 text-sm font-semibold">
          Candidates — time between steps
        </h3>
        {candidates.length === 0 ? (
          <p className="px-4 py-6 text-sm text-charcoal/55">No applications yet.</p>
        ) : (
          <ul>
            {[...candidates]
              .sort((a, b) => (b.openMs ?? -1) - (a.openMs ?? -1))
              .map((c) => {
                const isOpen = openId === c.app.id
                return (
                  <li key={c.app.id} className="border-b border-surface-line/60 last:border-0">
                    <button
                      onClick={() => setOpenId(isOpen ? null : c.app.id)}
                      className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-surface-muted/40"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-charcoal/40" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-charcoal/40" />
                      )}
                      <span className="min-w-0 font-medium">{c.app.applicant?.full_name ?? '?'}</span>
                      <span className="text-xs text-charcoal/55">
                        {c.app.desired_position} — {c.app.location_name}
                      </span>
                      {c.app.flow === 'mgmt' && (
                        <span className="rounded-full bg-charcoal/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                          Mgmt
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-2 text-xs">
                        {c.openMs !== null ? (
                          <>
                            <span className="text-charcoal/55">in {STATUS_LABELS[c.app.status]} for</span>
                            <span className={`rounded-full px-2 py-0.5 font-medium ${paceCls(c.openMs)}`}>
                              {fmtDur(c.openMs)}
                            </span>
                          </>
                        ) : (
                          <span className="text-charcoal/55">
                            {STATUS_LABELS[c.app.status]} · total {fmtDur(c.totalMs)}
                          </span>
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <ol className="space-y-1 border-t border-surface-line/60 bg-surface-muted/30 px-4 py-2.5 pl-10 text-xs">
                        {c.periods.map((p, i) => {
                          const ms = (p.endedAt ?? now) - p.startedAt
                          const ongoing = p.endedAt === null
                          const zeroTerminal = p.endedAt !== null && p.movedBy === null
                          if (zeroTerminal) {
                            return (
                              <li key={i} className="text-charcoal/60">
                                <span className="font-medium text-charcoal/80">
                                  {STATUS_LABELS[p.stage as ApplicationStatus] ?? p.stage}
                                </span>{' '}
                                — outcome reached {new Date(p.startedAt).toLocaleDateString()}
                              </li>
                            )
                          }
                          return (
                            <li key={i} className="flex flex-wrap items-baseline gap-1.5">
                              <span className="font-medium text-charcoal/80">
                                {STATUS_LABELS[p.stage as ApplicationStatus] ?? p.stage}
                              </span>
                              <span className={`rounded-full px-1.5 py-0.5 font-medium ${paceCls(ms)}`}>
                                {fmtDur(ms)}
                              </span>
                              <span className="text-charcoal/55">
                                {ongoing ? 'and counting — still here' : `then moved on by ${p.movedBy}`}
                              </span>
                            </li>
                          )
                        })}
                      </ol>
                    )}
                  </li>
                )
              })}
          </ul>
        )}
        <p className="border-t border-surface-line px-4 py-2 text-[11px] text-charcoal/50">
          Open applications first, longest current wait at the top. Click a candidate for the
          stage-by-stage breakdown.
        </p>
      </section>
    </div>
  )
}
