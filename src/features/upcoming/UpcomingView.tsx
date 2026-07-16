// Upcoming locations (Phase 2, slice 1) — a read-only projection of the New
// Restaurant Center's `opening_sites` (a CGOPS module in the shared DB; its
// SELECT policy is open to any authenticated user). Surfaces the pipeline of
// planned restaurants with their handover / soft-opening / opening dates and a
// staffing-deadline countdown, so leadership can see how soon each site needs a
// team. Reads only — the New Restaurant Center owns this data.

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { CalendarClock, ExternalLink, Store } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { UserProfile } from '../../types'

interface OpeningSite {
  id: string
  name: string
  concept: string | null
  address: string | null
  opening_date: string | null
  handover_date: string | null
  soft_opening_date: string | null
  status: string | null
  handover_status: string | null
  construction_note: string | null
  construction_link: string | null
  notes: string | null
}

// Whole days from today (local) to an ISO date; null when the date is unset.
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${dateStr}T00:00:00`)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Countdown phrasing + urgency tone from a day count.
function countdown(days: number | null): { text: string; tone: 'danger' | 'warning' | 'info' | 'muted' } {
  if (days === null) return { text: 'not scheduled', tone: 'muted' }
  if (days < 0) return { text: `${Math.abs(days)}d ago`, tone: 'muted' }
  if (days === 0) return { text: 'today', tone: 'danger' }
  const tone = days <= 45 ? 'danger' : days <= 120 ? 'warning' : 'info'
  return { text: `in ${days} day${days === 1 ? '' : 's'}`, tone }
}

const TONE_CLASS: Record<'danger' | 'warning' | 'info' | 'muted', string> = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
  muted: 'bg-surface-muted text-charcoal/50',
}

interface UpcomingViewProps {
  session: Session
  profile: UserProfile | null
}

export function UpcomingView({ session: _session, profile: _profile }: UpcomingViewProps) {
  const [sites, setSites] = useState<OpeningSite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('opening_sites')
      .select(
        `id, name, concept, address, opening_date, handover_date, soft_opening_date,
         status, handover_status, construction_note, construction_link, notes`,
      )
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setSites((data as unknown as OpeningSite[]) ?? [])
        setLoading(false)
      })
  }, [])

  // Soonest first by the staffing-driving date (handover, else opening); undated
  // sites sink to the bottom.
  const sorted = useMemo(() => {
    const key = (s: OpeningSite) => s.handover_date ?? s.opening_date ?? null
    return [...sites].sort((a, b) => {
      const ak = key(a)
      const bk = key(b)
      if (ak && bk) return ak.localeCompare(bk)
      if (ak) return -1
      if (bk) return 1
      return a.name.localeCompare(b.name)
    })
  }, [sites])

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading upcoming locations…</p>
  if (error)
    return <p className="p-6 text-sm text-danger">Could not load upcoming locations: {error}</p>

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Store className="h-5 w-5 text-cg-orange" /> Upcoming locations
        </h2>
        <p className="mt-1 text-sm text-charcoal/60">
          Planned restaurants and their opening timeline, from the New Restaurant
          Center. The <span className="font-medium">handover date</span> is the
          staffing deadline — leadership and team should be in place by then.
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-surface-line bg-surface p-10 text-center">
          <CalendarClock className="mx-auto mb-3 h-8 w-8 text-charcoal/30" />
          <h3 className="mb-1 text-sm font-medium">No upcoming locations</h3>
          <p className="mx-auto max-w-sm text-sm text-charcoal/60">
            The New Restaurant Center has no planned sites yet. New sites added
            there appear here automatically.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sorted.map((s) => {
            const handover = countdown(daysUntil(s.handover_date))
            return (
              <li
                key={s.id}
                className="flex flex-col rounded-xl border border-surface-line bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.name}</p>
                    {s.concept && (
                      <p className="text-xs text-charcoal/50">{s.concept}</p>
                    )}
                  </div>
                  {s.status && (
                    <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] capitalize text-charcoal/60">
                      {s.status.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                {/* Staffing deadline headline */}
                <div className="mt-3 flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[handover.tone]}`}
                  >
                    Staffing deadline {handover.text}
                  </span>
                </div>

                {/* Milestone dates */}
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <DateCell label="Handover" value={fmtDate(s.handover_date)} />
                  <DateCell label="Soft open" value={fmtDate(s.soft_opening_date)} />
                  <DateCell label="Opening" value={fmtDate(s.opening_date)} />
                </dl>

                {(s.construction_note || s.notes) && (
                  <p className="mt-3 text-xs text-charcoal/60">
                    {s.construction_note ?? s.notes}
                  </p>
                )}
                {s.construction_link && (
                  <a
                    href={s.construction_link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-cg-orange hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Construction tracker
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function DateCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-muted/50 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-charcoal/45">{label}</dt>
      <dd className="text-xs font-medium">{value}</dd>
    </div>
  )
}
