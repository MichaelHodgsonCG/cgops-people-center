// Current roster overlay (Gap Analysis). Click a location in the company gap
// table to see who holds each management seat there — modeled on the upcoming
// sites' planned-org panel: the standard restaurant hierarchy from the
// position template, each seat filled with the people in it or shown OPEN.
// Incoming hires (named, not started) show in blue; someone slated to an
// upcoming site gets a "moving to <site>" flag — their departure is the
// backfill gap the analysis reports. Read-only.

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { fetchPositionTemplate, type TemplatePosition } from '../upcoming/api'
import { fetchLocationRoster, type GapLocation, type RosterPerson } from './api'

interface OrgNode {
  positionId: string
  name: string
  level: number
  people: RosterPerson[]
  rosterSeat: boolean // management-roster seat — shows OPEN when empty
  children: OrgNode[]
}

export function CurrentRosterPanel({
  location,
  onClose,
}: {
  location: GapLocation
  onClose: () => void
}) {
  const upcoming = location.status === 'opening'
  const [template, setTemplate] = useState<TemplatePosition[] | null>(null)
  const [roster, setRoster] = useState<Map<string, RosterPerson[]> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPositionTemplate().then(setTemplate).catch((e: Error) => setError(e.message))
    fetchLocationRoster(location.id, upcoming)
      .then(setRoster)
      .catch((e: Error) => setError(e.message))
  }, [location.id, upcoming])

  // Build the org tree: every management-roster seat (filled or OPEN) plus any
  // position someone actually holds here (e.g. line roles) with its template
  // ancestors, wired by default_reports_to_position_id.
  const roots = useMemo<OrgNode[]>(() => {
    if (!template || !roster) return []
    const tById = new Map(template.map((p) => [p.id, p]))
    const included = new Set<string>()
    for (const p of template) {
      if (p.default_person_kind === 'manager' && p.people_center_eligible) included.add(p.id)
    }
    for (const pid of roster.keys()) {
      let cur: string | null | undefined = pid
      while (cur && !included.has(cur)) {
        included.add(cur)
        cur = tById.get(cur)?.default_reports_to_position_id
      }
    }

    const nodes = new Map<string, OrgNode>()
    for (const pid of included) {
      const tp = tById.get(pid)
      nodes.set(pid, {
        positionId: pid,
        name: tp?.name ?? 'Role',
        level: tp?.level ?? Number.POSITIVE_INFINITY,
        people: roster.get(pid) ?? [],
        rosterSeat: tp?.default_person_kind === 'manager' && Boolean(tp?.people_center_eligible),
        children: [],
      })
    }

    const tops: OrgNode[] = []
    for (const pid of included) {
      const parent = tById.get(pid)?.default_reports_to_position_id
      if (parent && nodes.has(parent)) nodes.get(parent)!.children.push(nodes.get(pid)!)
      else tops.push(nodes.get(pid)!)
    }
    const sortRec = (n: OrgNode) => {
      n.children.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
      n.children.forEach(sortRec)
    }
    tops.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    tops.forEach(sortRec)
    return tops
  }, [template, roster])

  const open = useMemo(() => countOpen(roots), [roots])

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-charcoal/30 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-surface-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-surface-line p-4">
          <div>
            <h3 className="font-semibold">{location.name} — current roster</h3>
            <p className="text-xs text-charcoal/55">
              {upcoming ? 'Slated roster (upcoming site)' : 'Primary assignments today'} ·{' '}
              {open} open seat{open === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-charcoal/40 hover:text-charcoal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : !template || !roster ? (
            <p className="text-sm text-charcoal/50">Loading…</p>
          ) : (
            <ul className="space-y-1">
              {roots.map((n) => (
                <SeatRow key={n.positionId} node={n} depth={0} />
              ))}
            </ul>
          )}
          <p className="mt-4 border-t border-surface-line pt-3 text-[11px] text-charcoal/45">
            <span className="font-medium text-danger">OPEN</span> = no one holds this management
            seat. <span className="font-medium text-info">Blue</span> = incoming hire who hasn't
            started. <span className="font-medium text-warning">Moving</span> = slated to an
            upcoming site, so this seat will need backfill.
          </p>
        </div>
      </div>
    </div>
  )
}

function countOpen(nodes: OrgNode[]): number {
  return nodes.reduce(
    (sum, n) => sum + (n.rosterSeat && n.people.length === 0 ? 1 : 0) + countOpen(n.children),
    0,
  )
}

function SeatRow({ node, depth }: { node: OrgNode; depth: number }) {
  return (
    <>
      <li
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md py-1 text-sm"
        style={{ paddingLeft: `${depth * 1.1}rem` }}
      >
        <span className="text-charcoal/55">{node.name}</span>
        <span className="text-charcoal/30">—</span>
        {node.people.length === 0 ? (
          node.rosterSeat ? (
            <span className="rounded-full bg-danger/10 px-1.5 py-0.5 text-[11px] font-medium text-danger">
              OPEN
            </span>
          ) : (
            <span className="text-xs text-charcoal/40">—</span>
          )
        ) : (
          node.people.map((p, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {i > 0 && <span className="text-charcoal/30">·</span>}
              <span className={`font-medium ${p.incoming ? 'text-info' : ''}`}>
                {p.name}
                {p.incoming ? ' (incoming)' : ''}
              </span>
              {p.movingTo && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                  <ArrowRight className="h-3 w-3" /> moving to {p.movingTo}
                </span>
              )}
            </span>
          ))
        )}
      </li>
      {node.children.map((c) => (
        <SeatRow key={c.positionId} node={c} depth={depth + 1} />
      ))}
    </>
  )
}
