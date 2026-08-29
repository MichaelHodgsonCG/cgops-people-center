// My Tasks — the gap seats assigned to YOU (owner or support), rolled up
// across every location and bucketed by urgency, mirroring Menu Center's
// My Tasks (which the CGOPS My Day deep-links into; this view is reachable
// the same way via /?view=my-tasks). There is no "complete" button: a task
// clears itself when the seat is actually filled — slated in the Bench,
// assigned, or hired — because gaps are recomputed live.
//
// RLS note: non-HQ roles only receive their OWN assignment rows, and some
// (location_leader/viewer) can't read succession slots, so for them an
// already-slated seat may linger here until the hire actually lands. The
// task list itself is always correct — it's built from their own rows.

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { CalendarClock, ListTodo } from 'lucide-react'
import {
  cellKeyForGap,
  fetchCompanyGaps,
  fetchGapAssignments,
  type CompanyGap,
  type GapAssignment,
} from '../gaps/api'
import { GOAL_KIND_LABELS, fetchMyGoals, type DevGoal } from './api'
import type { UserProfile } from '../../types'

type Bucket = 'overdue' | 'week' | 'fortnight' | 'later'

const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: 'Overdue / ASAP',
  week: 'Next 7 days',
  fortnight: 'Next 14 days',
  later: 'Later / unscheduled',
}
const BUCKET_CLASS: Record<Bucket, string> = {
  overdue: 'bg-danger/10 text-danger',
  week: 'bg-warning/10 text-warning',
  fortnight: 'bg-info/10 text-info',
  later: 'bg-surface-muted text-charcoal/60',
}
const BUCKETS: Bucket[] = ['overdue', 'week', 'fortnight', 'later']

const REASON_LABEL: Record<CompanyGap['reason'], string> = {
  'new-site': 'New site',
  backfill: 'Backfill',
  understaffed: 'Understaffed',
}

type MyTask =
  | {
      type: 'gap'
      id: string
      assignment: GapAssignment
      gap: CompanyGap
      role: 'owner' | 'support'
      due: string | null // target date, falling back to the gap's needed-by
      asap: boolean // understaffed with no date = needed now
      bucket: Bucket
    }
  | {
      type: 'goal'
      id: string
      goal: DevGoal
      role: 'owner' | 'support'
      due: string | null
      asap: boolean
      bucket: Bucket
    }

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

function bucketOf(due: string | null, asap: boolean): Bucket {
  if (asap) return 'overdue'
  if (!due) return 'later'
  const days = Math.round((Date.parse(due) - Date.now()) / 86400000)
  if (days < 0) return 'overdue'
  if (days <= 7) return 'week'
  if (days <= 14) return 'fortnight'
  return 'later'
}

interface MyTasksViewProps {
  session: Session
  profile: UserProfile | null
}

export function MyTasksView({ profile }: MyTasksViewProps) {
  const personId = profile?.person_id ?? null
  const [gaps, setGaps] = useState<CompanyGap[]>([])
  const [assignMap, setAssignMap] = useState<Map<string, GapAssignment[]>>(new Map())
  const [goals, setGoals] = useState<DevGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetchCompanyGaps(true),
      fetchGapAssignments(),
      personId ? fetchMyGoals(personId) : Promise.resolve([]),
    ])
      .then(([g, a, myGoals]) => {
        setGaps(g)
        setAssignMap(a)
        setGoals(myGoals)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [personId])

  const tasks = useMemo<MyTask[]>(() => {
    if (!personId) return []
    const out: MyTask[] = []
    for (const g of gaps) {
      if (g.gap <= 0) continue
      const cellAssignments = assignMap.get(cellKeyForGap(g)) ?? []
      // Seats are fungible: with N seats still open, the first N assigned
      // seats (by seat index) are the live ones; the rest count as filled.
      const live = cellAssignments.slice(0, g.gap)
      for (const a of live) {
        const role =
          a.owner_person_id === personId ? 'owner' : a.support_person_id === personId ? 'support' : null
        if (!role) continue
        const due = a.target_date ?? g.needed_by
        const asap = !due && g.reason === 'understaffed'
        out.push({ type: 'gap', id: a.id, assignment: a, gap: g, role, due, asap, bucket: bucketOf(due, asap) })
      }
    }
    for (const goal of goals) {
      const role = goal.owner_person_id === personId ? 'owner' : 'support'
      out.push({
        type: 'goal',
        id: goal.id,
        goal,
        role,
        due: goal.due_date,
        asap: false,
        bucket: bucketOf(goal.due_date, false),
      })
    }
    return out.sort(
      (a, b) =>
        BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) ||
        (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
        a.id.localeCompare(b.id),
    )
  }, [gaps, assignMap, goals, personId])

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { overdue: 0, week: 0, fortnight: 0, later: 0 }
    for (const t of tasks) c[t.bucket]++
    return c
  }, [tasks])

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading your tasks…</p>
  if (error) return <p className="p-6 text-sm text-danger">Could not load tasks: {error}</p>

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <ListTodo className="h-5 w-5 text-cg-orange" /> My Tasks
      </h2>
      <p className="mt-1 mb-4 text-sm text-charcoal/60">
        Your quarterly development goals, and the open seats you're responsible for filling (or
        supporting). Seat tasks clear themselves when the seat is filled; goals close from the
        person panel.
      </p>

      {!personId ? (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
          Your login isn't linked to a person record yet, so nothing can be assigned to you — ask
          an admin to link your profile in Users.
        </p>
      ) : tasks.length === 0 ? (
        <p className="rounded-xl border border-surface-line bg-surface px-4 py-6 text-center text-sm text-success">
          Nothing assigned to you — you're all caught up.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            {BUCKETS.map((b) => (
              <span key={b} className={`rounded-full px-2.5 py-1 font-medium ${BUCKET_CLASS[b]}`}>
                {BUCKET_LABEL[b]}: {counts[b]}
              </span>
            ))}
          </div>

          {BUCKETS.filter((b) => counts[b] > 0).map((b) => (
            <div key={b} className="mb-4">
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-charcoal/50">
                {BUCKET_LABEL[b]}
              </p>
              <ul className="space-y-1.5">
                {tasks
                  .filter((t) => t.bucket === b)
                  .map((t) => (
                    <li key={t.id} className="rounded-lg border border-surface-line bg-surface px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium">
                          {t.type === 'gap'
                            ? `Fill ${t.gap.position_name} — ${t.gap.location_name}`
                            : t.goal.title}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            t.role === 'owner'
                              ? 'bg-cg-orange-soft text-cg-orange'
                              : 'bg-info/10 text-info'
                          }`}
                        >
                          {t.role === 'owner'
                            ? t.type === 'goal'
                              ? 'Your goal'
                              : 'You own this'
                            : t.type === 'goal'
                              ? 'You coach'
                              : 'You support'}
                        </span>
                        <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-charcoal/60">
                          {t.type === 'gap' ? REASON_LABEL[t.gap.reason] : GOAL_KIND_LABELS[t.goal.kind]}
                        </span>
                        {t.type === 'goal' && t.goal.status === 'blocked' && (
                          <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium text-danger">
                            blocked
                          </span>
                        )}
                        {t.type === 'goal' && t.goal.fiscal_year && t.goal.quarter && (
                          <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-charcoal/60">
                            F{String(t.goal.fiscal_year).slice(-2)} Q{t.goal.quarter}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-charcoal/60">
                        <span className="flex items-center gap-1">
                          <CalendarClock className="h-3.5 w-3.5" />
                          {t.asap ? (
                            <span className="font-medium text-danger">ASAP</span>
                          ) : t.due ? (
                            <span className={Date.parse(t.due) < Date.now() ? 'font-medium text-danger' : ''}>
                              {fmtDate(t.due)}
                            </span>
                          ) : (
                            'no date set'
                          )}
                        </span>
                        {t.type === 'gap' ? (
                          <>
                            {t.role === 'owner' && t.assignment.support_name && (
                              <span>support: {t.assignment.support_name}</span>
                            )}
                            {t.role === 'support' && t.assignment.owner_name && (
                              <span>owner: {t.assignment.owner_name}</span>
                            )}
                            {t.assignment.note && <span>· {t.assignment.note}</span>}
                            {t.gap.detail && <span className="text-charcoal/45">· {t.gap.detail}</span>}
                          </>
                        ) : (
                          <>
                            {t.role === 'owner' && t.goal.support_name && <span>coach: {t.goal.support_name}</span>}
                            {t.role === 'support' && <span>for: {t.goal.owner_name}</span>}
                            {(t.goal.baseline || t.goal.target) && (
                              <span>
                                {t.goal.baseline || '—'} → {t.goal.target || '—'}
                              </span>
                            )}
                            {t.goal.checkin1_on && <span>check-in: {fmtDate(t.goal.checkin1_on)}</span>}
                          </>
                        )}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
