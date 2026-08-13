// Gap analysis (Phase 3). Two modes:
//  - Company-wide (default): every missing role across all locations, including
//    BACKFILL — an existing leader slated to a new site vacates their seat, so
//    the origin needs a replacement. Three kinds: new-site, backfill, understaffed.
//  - Single location: required roster vs who's in seat (open) / slated (opening).
// Admin/executive can edit the required counts. Both modes export to Word (.docx).

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ClipboardList,
  Download,
  Plus,
  Settings2,
  Trash2,
  UploadCloud,
  UserMinus,
} from 'lucide-react'
import { ImportPanel } from './ImportPanel'
import { CurrentRosterPanel } from './CurrentRosterPanel'
import { SeatOwnersPanel, type SeatCell } from './SeatOwnersPanel'
import { actorFrom } from '../../lib/activity'
import { errText } from '../../lib/errText'
import { fetchPeopleOptions, type PersonOption } from '../bench/api'
import {
  EMPTY_FILL,
  assignmentCellKey,
  cellKeyForGap,
  deleteRequirementGroup,
  fetchBenchForLocation,
  fetchCompanyGaps,
  fetchFillForLocation,
  fetchGapAssignments,
  fetchGapLocations,
  fetchManagementPositions,
  fetchRequirementGroups,
  fetchRoleRequirements,
  groupGap,
  minCover,
  resolveGroupRequirements,
  resolveSingleRequirements,
  clearRoleRequirement,
  saveRequirementGroup,
  setRoleRequirement,
  type CompanyGap,
  type Fill,
  type GapAssignment,
  type GapLocation,
  type GapPriority,
  type GapReason,
  type MgmtPosition,
  type RequirementGroup,
  type RoleRequirement,
} from './api'
import { downloadCompanyGapXlsx, downloadGapXlsx } from './excel'
import { can, toPermissionUser } from '../../permissions'
import type { UserProfile } from '../../types'

const REASON_LABEL: Record<GapReason, string> = {
  'new-site': 'New site',
  backfill: 'Backfill',
  understaffed: 'Understaffed',
}
const REASON_CLASS: Record<GapReason, string> = {
  'new-site': 'bg-info/10 text-info',
  backfill: 'bg-warning/10 text-warning',
  understaffed: 'bg-danger/10 text-danger',
}
const REASON_ORDER: Record<GapReason, number> = { 'new-site': 0, backfill: 1, understaffed: 2 }

const PRIORITY_ORDER: Record<GapPriority, number> = { high: 0, medium: 1, low: 2 }
const PRIORITY_CLASS: Record<GapPriority, string> = {
  high: 'bg-danger/10 text-danger',
  medium: 'bg-warning/10 text-warning',
  low: 'bg-surface-muted text-charcoal/50',
}
const PRIORITY_TITLE =
  'High = needed now/within 60 days (or a senior seat) with no plan · Medium = needed soon with a plan, or unplanned further out · Low = far out with a plan'

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

type CompanySortKey = 'location' | 'role' | 'gap' | 'type' | 'priority' | 'needed'

interface GapViewProps {
  session: Session
  profile: UserProfile | null
}

export function GapView({ session, profile }: GapViewProps) {
  const actor = actorFrom(profile, session)
  const canEdit = can(profile ? toPermissionUser(profile) : null, 'update', 'gap_analysis')

  const [reqs, setReqs] = useState<RoleRequirement[]>([])
  const [groups, setGroups] = useState<RequirementGroup[]>([])
  const [mgmt, setMgmt] = useState<MgmtPosition[]>([])
  const [locations, setLocations] = useState<GapLocation[]>([])
  const [company, setCompany] = useState<CompanyGap[]>([])
  // Location selection: empty = all (company-wide); one = the detailed
  // single-location view; two+ = the company report filtered to that subset.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Role filter: empty = all; otherwise a mix of position ids and pool (group)
  // ids (e.g. pick "Sous Chef" or the whole "Kitchen line" pool).
  const [pickedRoles, setPickedRoles] = useState<Set<string>>(new Set())
  const [openMenu, setOpenMenu] = useState<null | 'loc' | 'role'>(null)
  const [fill, setFill] = useState<Map<string, Fill>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [sortKey, setSortKey] = useState<CompanySortKey>('priority')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [importing, setImporting] = useState(false)
  // Incoming hires are named but haven't started — a maybe. They count as
  // fill by default; this toggle treats their seats as open instead.
  const [excludeIncoming, setExcludeIncoming] = useState(false)
  // Clicking a location name in the company table opens its roster overlay.
  const [rosterLoc, setRosterLoc] = useState<GapLocation | null>(null)
  // Per-seat owner/support assignments, keyed per (location, role|pool) cell;
  // clicking a gap row's Owner cell opens the seat editor.
  const [assignMap, setAssignMap] = useState<Map<string, GapAssignment[]>>(new Map())
  const [people, setPeople] = useState<PersonOption[]>([])
  const [seatCell, setSeatCell] = useState<SeatCell | null>(null)

  const loadAssignments = useCallback(() => {
    fetchGapAssignments().then(setAssignMap).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(() => {
    loadAssignments()
  }, [loadAssignments])
  // The people list only feeds the pickers — editors need it, viewers don't.
  useEffect(() => {
    if (canEdit) fetchPeopleOptions().then(setPeople).catch((e: Error) => setError(e.message))
  }, [canEdit])

  const loadReqs = useCallback(() => {
    fetchRoleRequirements().then(setReqs).catch((e: Error) => setError(e.message))
    fetchRequirementGroups().then(setGroups).catch((e: Error) => setError(e.message))
    fetchCompanyGaps(!excludeIncoming).then(setCompany).catch((e: Error) => setError(e.message))
  }, [excludeIncoming])

  useEffect(() => {
    Promise.all([
      fetchRoleRequirements(),
      fetchRequirementGroups(),
      fetchManagementPositions(),
      fetchGapLocations(),
    ])
      .then(([r, g, m, locs]) => {
        setReqs(r)
        setGroups(g)
        setMgmt(m)
        setLocations(locs)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // The company report depends on whether incoming hires count; refetch when
  // the toggle flips (also does the initial fetch).
  useEffect(() => {
    fetchCompanyGaps(!excludeIncoming).then(setCompany).catch((e: Error) => setError(e.message))
  }, [excludeIncoming])

  const single = picked.size === 1 ? [...picked][0] : null
  const isMulti = picked.size >= 2
  const selected = single ? locations.find((l) => l.id === single) : undefined
  const upcoming = selected?.status === 'opening'

  // Ranked successors per seat (single-location view) — a plan, not fill.
  const [bench, setBench] = useState<Map<string, string[]>>(new Map())

  useEffect(() => {
    if (!single || !selected) return
    fetchFillForLocation(single, selected.status === 'opening')
      .then(setFill)
      .catch((e: Error) => setError(e.message))
    fetchBenchForLocation(single)
      .then(setBench)
      .catch((e: Error) => setError(e.message))
  }, [single, selected])

  function toggleLocation(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleRole(id: string) {
    setPickedRoles((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function setManyLocations(ids: string[], on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
      return next
    })
  }
  function setManyRoles(ids: string[], on: boolean) {
    setPickedRoles((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
      return next
    })
  }

  // The effective roster for the selected location: global defaults overlaid
  // with this location's overrides (most-specific wins).
  const effSingles = useMemo(() => resolveSingleRequirements(reqs, single), [reqs, single])
  const effGroups = useMemo(() => resolveGroupRequirements(groups, single), [groups, single])

  // Filter-menu items. Pools: global ones plus location-only ones — a location
  // override is represented by the global pool it replaces, so picking a pool
  // matches it at every site. Roles: single requirements plus pool members.
  const poolItems = useMemo(
    () => groups.filter((g) => g.overrides_group_id === null).map((g) => ({ id: g.id, name: g.name })),
    [groups],
  )
  const roleItems = useMemo(() => {
    const m = new Map<string, { id: string; name: string; level: number | null }>()
    for (const r of reqs) {
      if (r.required_count > 0 && !m.has(r.position_id))
        m.set(r.position_id, { id: r.position_id, name: r.position_name, level: r.level })
    }
    for (const g of groups) {
      for (const r of g.roles) {
        if (!m.has(r.position_id))
          m.set(r.position_id, { id: r.position_id, name: r.position_name, level: r.level })
      }
    }
    return [...m.values()].sort(
      (a, b) => (a.level ?? Infinity) - (b.level ?? Infinity) || a.name.localeCompare(b.name),
    )
  }, [reqs, groups])

  // Positions governed by a group are shown via the group, not as single roles.
  const groupMemberPos = useMemo(() => {
    const s = new Set<string>()
    for (const g of effGroups) for (const r of g.roles) s.add(r.position_id)
    return s
  }, [effGroups])

  const rows = useMemo(() => {
    return effSingles
      .filter((r) => r.required_count > 0 && !groupMemberPos.has(r.position_id))
      .filter((r) => pickedRoles.size === 0 || pickedRoles.has(r.position_id))
      .map((r) => {
        const f = fill.get(r.position_id) ?? EMPTY_FILL
        const current = f.count + (excludeIncoming ? 0 : f.incomingCount)
        return {
          ...r,
          current,
          names: f.names,
          incomingNames: f.incomingNames,
          gap: Math.max(0, r.required_count - current),
        }
      })
  }, [effSingles, fill, pickedRoles, groupMemberPos, excludeIncoming])

  // Group rows for the single-location table (fill comes from the location's
  // per-position fill map). Each pool renders as a header row plus one row per
  // member position, so members read like ordinary roles.
  const groupRows = useMemo(() => {
    return effGroups
      .filter(
        (g) =>
          pickedRoles.size === 0 ||
          pickedRoles.has(g.id) ||
          (g.overrides_group_id !== null && pickedRoles.has(g.overrides_group_id)) ||
          g.roles.some((r) => pickedRoles.has(r.position_id)),
      )
      .map((g) => {
        const filledByPos = new Map<string, number>()
        for (const r of g.roles) {
          const f = fill.get(r.position_id) ?? EMPTY_FILL
          filledByPos.set(r.position_id, f.count + (excludeIncoming ? 0 : f.incomingCount))
        }
        const gg = groupGap(g, filledByPos)
        const members = g.roles.map((r) => {
          const f = fill.get(r.position_id) ?? EMPTY_FILL
          const current = f.count + (excludeIncoming ? 0 : f.incomingCount)
          // A minimum counts this role plus more senior pool roles, so a
          // Senior Sous can cover a Sous minimum.
          const cover = minCover(g, r, filledByPos)
          return {
            position_id: r.position_id,
            position_name: r.position_name,
            min_count: r.min_count,
            current,
            names: f.names,
            incomingNames: f.incomingNames,
            seniorCovered: r.min_count > 0 && current < r.min_count && cover >= r.min_count,
            gap: Math.max(0, r.min_count - cover),
          }
        })
        return { id: g.id, name: g.name, total_min: g.total_min, current: gg.filledTotal, gap: gg.gap, members }
      })
  }, [effGroups, fill, pickedRoles, excludeIncoming])

  const totals = useMemo(() => {
    const required =
      rows.reduce((s, r) => s + r.required_count, 0) + groupRows.reduce((s, g) => s + g.total_min, 0)
    const filled =
      rows.reduce((s, r) => s + Math.min(r.current, r.required_count), 0) +
      groupRows.reduce((s, g) => s + Math.min(g.current, g.total_min), 0)
    const gap = rows.reduce((s, r) => s + r.gap, 0) + groupRows.reduce((s, g) => s + g.gap, 0)
    return { required, filled, gap }
  }, [rows, groupRows])

  // Company-wide rows filtered to the picked subset (all when none picked).
  // Backfill/movers are still computed company-wide in fetchCompanyGaps, so a
  // subset view stays correct — we only filter what's shown.
  const visibleCompany = useMemo(
    () =>
      company.filter((g) => {
        if (isMulti && !picked.has(g.location_id)) return false
        if (pickedRoles.size === 0) return true
        return g.kind === 'group'
          ? pickedRoles.has(g.position_id) ||
              (g.overrides_group_id != null && pickedRoles.has(g.overrides_group_id)) ||
              (g.member_position_ids ?? []).some((id) => pickedRoles.has(id))
          : pickedRoles.has(g.position_id)
      }),
    [company, isMulti, picked, pickedRoles],
  )

  const companyByReason = useMemo(() => {
    const m: Record<GapReason, number> = { 'new-site': 0, backfill: 0, understaffed: 0 }
    for (const g of visibleCompany) m[g.reason] += g.gap
    return m
  }, [visibleCompany])
  const companyTotal = visibleCompany.reduce((s, g) => s + g.gap, 0)

  const sortedCompany = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...visibleCompany].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'location':
          cmp = a.location_name.localeCompare(b.location_name)
          break
        case 'role':
          cmp = (a.level ?? Infinity) - (b.level ?? Infinity) || a.position_name.localeCompare(b.position_name)
          break
        case 'gap':
          cmp = a.gap - b.gap
          break
        case 'type':
          cmp = REASON_ORDER[a.reason] - REASON_ORDER[b.reason]
          break
        case 'priority':
          // Within a priority tier, soonest need first ('' = ASAP sorts first).
          cmp =
            PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
            (a.needed_by ?? '').localeCompare(b.needed_by ?? '')
          break
        case 'needed':
          cmp = (a.needed_by ?? '').localeCompare(b.needed_by ?? '')
          break
      }
      // Stable, readable secondary ordering.
      return (
        cmp * dir ||
        a.location_name.localeCompare(b.location_name) ||
        (a.level ?? Infinity) - (b.level ?? Infinity)
      )
    })
  }, [visibleCompany, sortKey, sortDir])

  function toggleSort(k: CompanySortKey) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir(k === 'gap' ? 'desc' : 'asc') // biggest gaps first by default
    }
  }

  async function exportExcel() {
    setExporting(true)
    setError(null)
    try {
      if (!single) {
        const ownerText = (arr: GapAssignment[]) =>
          arr
            .filter((a) => a.owner_name || a.support_name)
            .map(
              (a) =>
                `${a.owner_name || '?'}${a.support_name ? ` + ${a.support_name}` : ''}${
                  a.target_date ? ` by ${a.target_date}` : ''
                }`,
            )
            .join('; ')
        await downloadCompanyGapXlsx({
          rows: sortedCompany.map((r) => ({
            ...r,
            priority: r.priority.charAt(0).toUpperCase() + r.priority.slice(1),
            needed_by: r.needed_by ?? (r.reason === 'understaffed' ? 'ASAP' : '—'),
            owner: ownerText(assignMap.get(cellKeyForGap(r)) ?? []),
            detail: [
              r.detail,
              r.incoming_names?.length ? `incoming: ${r.incoming_names.join(', ')}` : '',
              r.bench_names?.length ? `bench: ${r.bench_names.join(', ')}` : '',
            ]
              .filter(Boolean)
              .join(' · '),
          })),
          generatedOn: new Date().toLocaleDateString(),
        })
      } else if (selected && rows.length + groupRows.length > 0) {
        await downloadGapXlsx({
          locationName: selected.name,
          upcoming,
          rows: [
            ...rows.map((r) => ({
              position_name: r.position_name,
              required_count: r.required_count,
              current: r.current,
              gap: r.gap,
              names: [
                ...r.names,
                ...r.incomingNames.map((n) => `${n} (incoming)`),
                ...(r.gap > 0 && bench.get(r.position_id)?.length
                  ? [`bench: ${bench.get(r.position_id)!.join(', ')}`]
                  : []),
              ],
            })),
            ...groupRows.flatMap((g) => [
              {
                position_name: `${g.name} (pool)`,
                required_count: g.total_min,
                current: g.current,
                gap: g.gap,
                names: [`any mix of the roles below, ${g.total_min} total`],
              },
              ...g.members.map((m) => ({
                position_name: m.position_name,
                required_count: m.min_count > 0 ? `${m.min_count} min` : '—',
                current: m.current,
                gap: m.min_count > 0 ? (m.seniorCovered && m.gap === 0 ? 'OK (senior covers)' : m.gap) : '—',
                names: [...m.names, ...m.incomingNames.map((n) => `${n} (incoming)`)],
                indent: true,
              })),
            ]),
          ],
          totals,
          generatedOn: new Date().toLocaleDateString(),
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading gap analysis…</p>
  if (error) return <p className="p-6 text-sm text-danger">Could not load gap analysis: {error}</p>

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardList className="h-5 w-5 text-cg-orange" /> Gap analysis
          </h2>
          <p className="mt-1 text-sm text-charcoal/60">
            Missing management roles — including backfill when a leader is slated to
            move to a new location.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowConfig((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
          >
            <Settings2 className="h-3.5 w-3.5" /> Required roster
          </button>
        )}
      </div>

      {showConfig && canEdit && (
        <RequirementsEditor
          mgmt={mgmt}
          reqs={reqs}
          groups={groups}
          locations={locations}
          actor={actor}
          onSaved={loadReqs}
          onClose={() => setShowConfig(false)}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterMenu
          label="Locations"
          summary={
            picked.size === 0
              ? 'All locations'
              : single
                ? locations.find((l) => l.id === single)?.name ?? '1 location'
                : `${picked.size} locations`
          }
          open={openMenu === 'loc'}
          onToggle={() => setOpenMenu((m) => (m === 'loc' ? null : 'loc'))}
          onClear={picked.size ? () => setPicked(new Set()) : undefined}
        >
          <CheckGroup
            label="Upcoming"
            items={locations.filter((l) => l.status === 'opening').map((l) => ({ id: l.id, name: l.name }))}
            selected={picked}
            onToggle={toggleLocation}
            onSetMany={setManyLocations}
          />
          <CheckGroup
            label="Open"
            items={locations.filter((l) => l.status === 'open').map((l) => ({ id: l.id, name: l.name }))}
            selected={picked}
            onToggle={toggleLocation}
            onSetMany={setManyLocations}
          />
        </FilterMenu>

        <FilterMenu
          label="Roles"
          summary={
            pickedRoles.size === 0
              ? 'All roles'
              : pickedRoles.size === 1
                ? poolItems.find((p) => p.id === [...pickedRoles][0])?.name ??
                  roleItems.find((r) => r.id === [...pickedRoles][0])?.name ??
                  '1 role'
                : `${pickedRoles.size} roles`
          }
          open={openMenu === 'role'}
          onToggle={() => setOpenMenu((m) => (m === 'role' ? null : 'role'))}
          onClear={pickedRoles.size ? () => setPickedRoles(new Set()) : undefined}
        >
          <CheckGroup
            label="Pools"
            items={poolItems}
            selected={pickedRoles}
            onToggle={toggleRole}
            onSetMany={setManyRoles}
          />
          <CheckGroup
            label="Management roles"
            items={roleItems.map((r) => ({ id: r.id, name: r.name }))}
            selected={pickedRoles}
            onToggle={toggleRole}
            onSetMany={setManyRoles}
          />
        </FilterMenu>

        <button
          onClick={() => setExcludeIncoming((v) => !v)}
          title="Incoming hires are named but haven't started — exclude them to treat their seats as open"
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${
            excludeIncoming ? 'border-info bg-info/10 text-info' : 'border-surface-line hover:bg-surface-muted'
          }`}
        >
          <UserMinus className="h-3.5 w-3.5" /> Exclude incoming
        </button>
        {single && upcoming && (
          <span className="rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
            upcoming — showing slated
          </span>
        )}
        <button
          onClick={() => void exportExcel()}
          disabled={exporting || (single ? rows.length + groupRows.length === 0 : sortedCompany.length === 0)}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> {exporting ? 'Preparing…' : 'Download Excel'}
        </button>
        {canEdit && (
          <button
            onClick={() => setImporting(true)}
            className="flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
          >
            <UploadCloud className="h-3.5 w-3.5" /> Upload Excel
          </button>
        )}
      </div>

      <p className="mb-3 text-[11px] text-charcoal/55">
        {excludeIncoming ? (
          <>Incoming hires are excluded — a seat only counts people who have started.</>
        ) : (
          <>
            <span className="font-medium text-info">Incoming</span> hires are named but haven’t
            started — shown in blue and counted as filling their seat. Use “Exclude incoming” to
            treat those seats as open.
          </>
        )}
      </p>

      {importing && (
        <ImportPanel
          actor={actor}
          onClose={() => setImporting(false)}
          onApplied={loadReqs}
        />
      )}

      {!single ? (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Summary
              label="High priority"
              n={visibleCompany.filter((g) => g.priority === 'high').reduce((s, g) => s + g.gap, 0)}
              cls="bg-danger text-white"
            />
            <Summary label="New-site" n={companyByReason['new-site']} cls={REASON_CLASS['new-site']} />
            <Summary label="Backfill" n={companyByReason.backfill} cls={REASON_CLASS.backfill} />
            <Summary label="Understaffed" n={companyByReason.understaffed} cls={REASON_CLASS.understaffed} />
            <Summary label="Total open roles" n={companyTotal} cls="bg-charcoal text-white" />
          </div>
          <div className="overflow-x-auto rounded-xl border border-surface-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
                  <SortHeader label="Location" k="location" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Role" k="role" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Gap" k="gap" sortKey={sortKey} dir={sortDir} onSort={toggleSort} center />
                  <SortHeader label="Priority" k="priority" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Needed by" k="needed" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <SortHeader label="Type" k="type" sortKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <th className="px-4 py-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {sortedCompany.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-sm text-success">
                      No gaps — every required seat is filled or slated.
                    </td>
                  </tr>
                ) : (
                  sortedCompany.map((g, i) => (
                    <tr key={i} className="border-b border-surface-line/60 last:border-0">
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => {
                            const l = locations.find((x) => x.id === g.location_id)
                            if (l) setRosterLoc(l)
                          }}
                          title="View this location's current roster"
                          className="text-left font-medium hover:text-cg-orange hover:underline"
                        >
                          {g.location_name}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        {g.position_name}
                        {g.kind === 'group' && (
                          <span className="ml-1.5 rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">
                            pool
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center font-medium text-danger">{g.gap}</td>
                      <td className="px-4 py-2.5">
                        <span
                          title={PRIORITY_TITLE}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${PRIORITY_CLASS[g.priority]}`}
                        >
                          {g.priority}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                        {g.needed_by ? (
                          <span className={Date.parse(g.needed_by) < Date.now() ? 'font-medium text-danger' : ''}>
                            {fmtDate(g.needed_by)}
                          </span>
                        ) : g.reason === 'understaffed' ? (
                          <span className="font-medium text-danger">ASAP</span>
                        ) : (
                          <span className="text-charcoal/40" title="No staffing deadline scheduled in Restaurant Center">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <OwnerCell
                          assignments={assignMap.get(cellKeyForGap(g)) ?? []}
                          canEdit={canEdit}
                          onOpen={() =>
                            setSeatCell({
                              locationId: g.location_id,
                              locationName: g.location_name,
                              kind: g.kind,
                              positionId: g.kind === 'role' ? g.position_id : null,
                              groupName: g.kind === 'group' ? g.position_name : null,
                              roleLabel: g.position_name,
                              gap: g.gap,
                              neededBy: g.needed_by ? fmtDate(g.needed_by) : null,
                            })
                          }
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REASON_CLASS[g.reason]}`}>
                          {REASON_LABEL[g.reason]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-charcoal/60">
                        {g.detail}
                        {(g.incoming_names?.length ?? 0) > 0 && (
                          <span className="font-medium text-info">
                            {g.detail ? ' · ' : ''}incoming: {g.incoming_names?.join(', ')}
                          </span>
                        )}
                        {(g.bench_names?.length ?? 0) > 0 && (
                          <span className="font-medium text-success">
                            {g.detail || (g.incoming_names?.length ?? 0) > 0 ? ' · ' : ''}bench:{' '}
                            {g.bench_names?.join(', ')}
                          </span>
                        )}
                        {!g.detail &&
                          (g.incoming_names?.length ?? 0) === 0 &&
                          (g.bench_names?.length ?? 0) === 0 &&
                          '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="overflow-hidden rounded-xl border border-surface-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 text-center font-medium">Required</th>
                <th className="px-4 py-3 text-center font-medium">{upcoming ? 'Slated' : 'In seat'}</th>
                <th className="px-4 py-3 text-center font-medium">Gap</th>
                <th className="px-4 py-3 font-medium">{upcoming ? 'Slated' : 'People'}</th>
                <th className="px-4 py-3 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.position_id} className="border-b border-surface-line/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium">{r.position_name}</td>
                  <td className="px-4 py-2.5 text-center">{r.required_count}</td>
                  <td className="px-4 py-2.5 text-center">{r.current}</td>
                  <td className="px-4 py-2.5 text-center">
                    {r.gap > 0 ? (
                      <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                        short {r.gap}
                      </span>
                    ) : (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                        OK
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-charcoal/60">
                    <Names names={r.names} incoming={r.incomingNames} empty={upcoming ? 'not yet named' : '—'} />
                    {r.gap > 0 && (bench.get(r.position_id)?.length ?? 0) > 0 && (
                      <span className="font-medium text-success">
                        {' · '}bench: {bench.get(r.position_id)?.join(', ')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.gap > 0 || (assignMap.get(assignmentCellKey(single, 'role', r.position_id))?.length ?? 0) > 0 ? (
                      <OwnerCell
                        assignments={assignMap.get(assignmentCellKey(single, 'role', r.position_id)) ?? []}
                        canEdit={canEdit}
                        onOpen={() =>
                          setSeatCell({
                            locationId: single,
                            locationName: selected?.name ?? '',
                            kind: 'role',
                            positionId: r.position_id,
                            groupName: null,
                            roleLabel: r.position_name,
                            gap: r.gap,
                            neededBy: null,
                          })
                        }
                      />
                    ) : (
                      <span className="text-charcoal/40">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {groupRows.map((g) => (
                <Fragment key={g.id}>
                  <tr className="border-b border-surface-line/60 bg-surface-muted/20">
                    <td className="px-4 py-2.5 font-medium">
                      {g.name}
                      <span className="ml-1.5 rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">
                        pool
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">{g.total_min}</td>
                    <td className="px-4 py-2.5 text-center">{g.current}</td>
                    <td className="px-4 py-2.5 text-center">
                      {g.gap > 0 ? (
                        <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                          short {g.gap}
                        </span>
                      ) : (
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                          OK
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-charcoal/60">
                      any mix of the roles below, {g.total_min} total
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {g.gap > 0 || (assignMap.get(assignmentCellKey(single, 'group', g.name))?.length ?? 0) > 0 ? (
                        <OwnerCell
                          assignments={assignMap.get(assignmentCellKey(single, 'group', g.name)) ?? []}
                          canEdit={canEdit}
                          onOpen={() =>
                            setSeatCell({
                              locationId: single,
                              locationName: selected?.name ?? '',
                              kind: 'group',
                              positionId: null,
                              groupName: g.name,
                              roleLabel: g.name,
                              gap: g.gap,
                              neededBy: null,
                            })
                          }
                        />
                      ) : (
                        <span className="text-charcoal/40">—</span>
                      )}
                    </td>
                  </tr>
                  {g.members.map((m) => (
                    <tr key={m.position_id} className="border-b border-surface-line/60 last:border-0">
                      <td className="px-4 py-2.5 pl-9 text-charcoal/80">{m.position_name}</td>
                      <td className="px-4 py-2.5 text-center">{m.min_count > 0 ? `${m.min_count} min` : '—'}</td>
                      <td className="px-4 py-2.5 text-center">{m.current}</td>
                      <td className="px-4 py-2.5 text-center">
                        {m.min_count > 0 ? (
                          m.gap > 0 ? (
                            <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                              short {m.gap}
                            </span>
                          ) : (
                            <span
                              className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
                              title={m.seniorCovered ? 'Minimum met counting a more senior pool role' : undefined}
                            >
                              OK{m.seniorCovered ? ' ↑' : ''}
                            </span>
                          )
                        ) : (
                          <span className="text-xs text-charcoal/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-charcoal/60">
                        <Names names={m.names} incoming={m.incomingNames} empty={upcoming ? 'not yet named' : '—'} />
                        {g.gap > 0 && (bench.get(m.position_id)?.length ?? 0) > 0 && (
                          <span className="font-medium text-success">
                            {' · '}bench: {bench.get(m.position_id)?.join(', ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-charcoal/40">
                        {/* seat owners live on the pool row above */}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-surface-line bg-surface-muted/40 text-sm font-medium">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-4 py-2.5 text-center">{totals.required}</td>
                <td className="px-4 py-2.5 text-center">{totals.filled}</td>
                <td className="px-4 py-2.5 text-center">
                  {totals.gap > 0 ? (
                    <span className="text-danger">short {totals.gap}</span>
                  ) : (
                    <span className="text-success">fully staffed</span>
                  )}
                </td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {rosterLoc && <CurrentRosterPanel location={rosterLoc} onClose={() => setRosterLoc(null)} />}
      {seatCell && (
        <SeatOwnersPanel
          actor={actor}
          canEdit={canEdit}
          cell={seatCell}
          assignments={
            assignMap.get(
              assignmentCellKey(
                seatCell.locationId,
                seatCell.kind,
                seatCell.kind === 'role' ? seatCell.positionId ?? '' : seatCell.groupName ?? '',
              ),
            ) ?? []
          }
          people={people}
          onClose={() => setSeatCell(null)}
          onSaved={loadAssignments}
        />
      )}
    </div>
  )
}

// The Owner column: per-seat owners/support for the cell, e.g.
// "Sarah Lee +John M. · 15 Sep, Dave R.". Editors see "Assign" when empty;
// clicking opens the seat editor (read-only for non-editors with rows).
function OwnerCell({
  assignments,
  canEdit,
  onOpen,
}: {
  assignments: GapAssignment[]
  canEdit: boolean
  onOpen: () => void
}) {
  const parts = assignments.filter((a) => a.owner_name || a.support_name || a.target_date)
  const body =
    parts.length === 0 ? (
      canEdit ? (
        <span className="font-medium text-cg-orange">Assign</span>
      ) : (
        <span className="text-charcoal/40">—</span>
      )
    ) : (
      <span>
        {parts.map((a, i) => (
          <span key={a.id}>
            {i > 0 && ', '}
            <span className="font-medium">{a.owner_name || '?'}</span>
            {a.support_name && <span className="text-charcoal/50"> +{a.support_name}</span>}
            {a.target_date && <span className="text-charcoal/50"> · {fmtDate(a.target_date)}</span>}
          </span>
        ))}
      </span>
    )
  if (!canEdit && parts.length === 0) return body
  return (
    <button
      onClick={onOpen}
      title="Seat owners — who is responsible for filling each open seat"
      className="text-left hover:underline"
    >
      {body}
    </button>
  )
}

function SortHeader({
  label,
  k,
  sortKey,
  dir,
  onSort,
  center,
}: {
  label: string
  k: CompanySortKey
  sortKey: CompanySortKey
  dir: 'asc' | 'desc'
  onSort: (k: CompanySortKey) => void
  center?: boolean
}) {
  const active = sortKey === k
  return (
    <th className="px-4 py-3 font-medium">
      <button
        onClick={() => onSort(k)}
        className={`flex items-center gap-1 uppercase tracking-wide hover:text-charcoal ${
          center ? 'mx-auto' : ''
        } ${active ? 'text-charcoal' : ''}`}
      >
        {label}
        {active ? (
          dir === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  )
}

// Started people in the normal colour; incoming hires (named but not started —
// a maybe) in blue with an "(incoming)" note.
function Names({ names, incoming, empty }: { names: string[]; incoming: string[]; empty: string }) {
  if (names.length === 0 && incoming.length === 0) return <>{empty}</>
  return (
    <>
      {names.join(', ')}
      {incoming.length > 0 && (
        <span className="font-medium text-info">
          {names.length > 0 ? ', ' : ''}
          {incoming.map((n) => `${n} (incoming)`).join(', ')}
        </span>
      )}
    </>
  )
}

function Summary({ label, n, cls }: { label: string; n: number; cls: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 font-medium ${cls}`}>
      {label}: {n}
    </span>
  )
}

// A labelled button that opens a checkbox popover. Empty selection = "all".
function FilterMenu({
  label,
  summary,
  open,
  onToggle,
  onClear,
  children,
}: {
  label: string
  summary: string
  open: boolean
  onToggle: () => void
  onClear?: () => void
  children: ReactNode
}) {
  return (
    <div className="relative flex items-center gap-1.5">
      <span className="text-xs uppercase tracking-wide text-charcoal/50">{label}</span>
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded-md border border-surface-line bg-surface px-3 py-2 text-sm hover:bg-surface-muted"
      >
        {summary}
        <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
      </button>
      {open && (
        <>
          <button aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={onToggle} />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-auto rounded-md border border-surface-line bg-surface p-2 shadow-lg">
            {onClear && (
              <button
                onClick={onClear}
                className="mb-1 w-full rounded px-2 py-1 text-left text-xs font-medium text-cg-orange hover:bg-surface-muted"
              >
                Clear — show all
              </button>
            )}
            {children}
          </div>
        </>
      )}
    </div>
  )
}

function CheckGroup({
  label,
  items,
  selected,
  onToggle,
  onSetMany,
}: {
  label: string
  items: { id: string; name: string }[]
  selected: Set<string>
  onToggle: (id: string) => void
  onSetMany?: (ids: string[], on: boolean) => void
}) {
  if (items.length === 0) return null
  const ids = items.map((i) => i.id)
  const allSelected = ids.every((id) => selected.has(id))
  return (
    <div className="mb-1">
      <div className="flex items-center justify-between gap-2 px-2 py-0.5">
        <p className="text-[10px] uppercase tracking-wide text-charcoal/40">{label}</p>
        {onSetMany && (
          <button
            onClick={() => onSetMany(ids, !allSelected)}
            className="text-[10px] font-medium text-cg-orange hover:underline"
          >
            {allSelected ? 'Clear' : 'Select all'}
          </button>
        )}
      </div>
      {items.map((it) => (
        <label
          key={it.id}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-muted"
        >
          <input
            type="checkbox"
            checked={selected.has(it.id)}
            onChange={() => onToggle(it.id)}
            className="accent-cg-orange"
          />
          {it.name}
        </label>
      ))}
    </div>
  )
}

function RequirementsEditor({
  mgmt,
  reqs,
  groups,
  locations,
  actor,
  onSaved,
  onClose,
}: {
  mgmt: MgmtPosition[]
  reqs: RoleRequirement[]
  groups: RequirementGroup[]
  locations: GapLocation[]
  actor: ReturnType<typeof actorFrom>
  onSaved: () => void
  onClose: () => void
}) {
  // null scope = the global default; a location id = that location's overrides.
  const [scope, setScope] = useState<string | null>(null)
  const scopeName = scope ? locations.find((l) => l.id === scope)?.name ?? 'location' : null

  const effSingles = useMemo(() => resolveSingleRequirements(reqs, scope), [reqs, scope])
  const effGroups = useMemo(() => resolveGroupRequirements(groups, scope), [groups, scope])
  const effCountByPos = useMemo(
    () => new Map(effSingles.map((r) => [r.position_id, r.required_count])),
    [effSingles],
  )
  // Positions with an explicit override at THIS location (for the reset action).
  const overriddenPos = useMemo(
    () => new Set(reqs.filter((r) => r.location_id === scope && scope !== null).map((r) => r.position_id)),
    [reqs, scope],
  )
  const memberPos = useMemo(() => {
    const s = new Set<string>()
    for (const g of effGroups) for (const r of g.roles) s.add(r.position_id)
    return s
  }, [effGroups])
  // Roles governed by a pool are managed there, not as a single count.
  const singleRoles = useMemo(() => mgmt.filter((m) => !memberPos.has(m.id)), [mgmt, memberPos])

  const [edits, setEdits] = useState<Map<string, number>>(new Map())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Switching scope discards unsaved single-count edits.
  useEffect(() => setEdits(new Map()), [scope])

  const value = (id: string) => edits.get(id) ?? effCountByPos.get(id) ?? 0

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      for (const [posId, count] of edits) {
        if (count === (effCountByPos.get(posId) ?? 0)) continue
        const name = mgmt.find((m) => m.id === posId)?.name ?? 'role'
        await setRoleRequirement(actor, posId, name, count, scope)
      }
      setEdits(new Map())
      onSaved()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setSaving(false)
    }
  }

  async function resetRole(posId: string, name: string) {
    if (scope === null) return
    setErr(null)
    try {
      await clearRoleRequirement(actor, posId, name, scope)
      setEdits((prev) => {
        const next = new Map(prev)
        next.delete(posId)
        return next
      })
      onSaved()
    } catch (e) {
      setErr(errText(e))
    }
  }

  const open = locations.filter((l) => l.status === 'open')
  const opening = locations.filter((l) => l.status === 'opening')

  return (
    <div className="mb-4 rounded-xl border border-cg-orange/40 bg-cg-orange-soft/30 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-charcoal/50">
            Required roster for
          </span>
          <select
            value={scope ?? ''}
            onChange={(e) => setScope(e.target.value || null)}
            className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm font-medium"
          >
            <option value="">Global default (all restaurants)</option>
            {open.length > 0 && (
              <optgroup label="Open">
                {open.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            )}
            {opening.length > 0 && (
              <optgroup label="Upcoming">
                {opening.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <button onClick={onClose} className="text-xs font-medium text-charcoal/50 hover:text-charcoal">
          Done
        </button>
      </div>
      <p className="mb-2 text-[11px] text-charcoal/55">
        {scope === null
          ? 'The baseline every restaurant is measured against unless it has its own override.'
          : `${scopeName} inherits the global default; anything you set here overrides it for this site only.`}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {singleRoles.map((m) => {
          const isOverride = overriddenPos.has(m.id)
          return (
            <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5 text-charcoal/70">
                {m.name}
                {scope !== null &&
                  (isOverride ? (
                    <button
                      onClick={() => void resetRole(m.id, m.name)}
                      className="rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info hover:bg-info/20"
                      title="Remove this override — inherit the global default again"
                    >
                      override · reset
                    </button>
                  ) : (
                    <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-charcoal/40">
                      inherited
                    </span>
                  ))}
              </span>
              <input
                type="number"
                min={0}
                value={value(m.id)}
                onChange={(e) => {
                  const n = Math.max(0, parseInt(e.target.value || '0', 10))
                  setEdits((prev) => new Map(prev).set(m.id, n))
                }}
                className="w-16 rounded-md border border-surface-line bg-surface px-2 py-1 text-center text-sm"
              />
            </div>
          )
        })}
      </div>
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      <button
        onClick={() => void save()}
        disabled={saving}
        className="mt-3 rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save counts'}
      </button>

      <GroupEditor key={scope ?? 'global'} groups={effGroups} mgmt={mgmt} actor={actor} scope={scope} onChanged={onSaved} />
    </div>
  )
}

type GroupEdit =
  | { mode: 'edit'; group: RequirementGroup }
  | { mode: 'new' }
  | { mode: 'fork'; from: RequirementGroup }

function GroupEditor({
  groups,
  mgmt,
  actor,
  scope,
  onChanged,
}: {
  groups: RequirementGroup[]
  mgmt: MgmtPosition[]
  actor: ReturnType<typeof actorFrom>
  scope: string | null
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<GroupEdit | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isInherited = (g: RequirementGroup) => scope !== null && g.location_id === null

  async function remove(g: RequirementGroup) {
    const isOverride = g.overrides_group_id !== null
    const msg = isOverride
      ? `Remove this location override of "${g.name}" (back to the global pool)?`
      : `Delete pool "${g.name}"?`
    if (!window.confirm(msg)) return
    setBusy(true)
    setErr(null)
    try {
      await deleteRequirementGroup(actor, g.id, g.name)
      onChanged()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  function badge(g: RequirementGroup) {
    if (scope === null) return null
    if (isInherited(g))
      return <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-charcoal/40">inherited</span>
    if (g.overrides_group_id)
      return <span className="rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">overrides global</span>
    return <span className="rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">location only</span>
  }

  return (
    <div className="mt-4 border-t border-cg-orange/30 pt-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal/50">
        Pooled groups — a total across roles, with per-role minimums
      </p>
      <p className="mb-2 text-[11px] text-charcoal/55">
        A minimum counts people in that role <em>or any more senior role in the pool</em> — e.g.
        “Sous ≥ 2” is satisfied by one Sous plus one Senior Sous.
      </p>
      {groups.length === 0 && !editing && (
        <p className="mb-2 text-xs text-charcoal/55">
          None yet. Example: “Kitchen line” = 5 total across Senior Sous / Sous / Chef de Partie,
          with Sous ≥ 2.
        </p>
      )}
      <ul className="space-y-1.5">
        {groups.map((g) => (
          <li
            key={g.id}
            className="flex items-start justify-between gap-2 rounded-md border border-surface-line bg-surface px-3 py-1.5 text-sm"
          >
            <div className="min-w-0">
              <span className="font-medium">{g.name}</span> {badge(g)}{' '}
              <span className="text-charcoal/60">= {g.total_min} total</span>
              <span className="text-charcoal/50">
                {' · '}
                {g.roles.map((r) => `${r.position_name}${r.min_count ? ` ≥${r.min_count}` : ''}`).join(', ')}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {isInherited(g) ? (
                <button
                  onClick={() => setEditing({ mode: 'fork', from: g })}
                  className="rounded px-1 text-xs font-medium text-cg-orange hover:underline"
                >
                  Override here
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setEditing({ mode: 'edit', group: g })}
                    className="rounded px-1 text-xs font-medium text-cg-orange hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void remove(g)}
                    disabled={busy}
                    aria-label={g.overrides_group_id ? 'Remove override' : 'Delete pool'}
                    className="rounded p-1 text-charcoal/40 hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      {editing ? (
        <GroupForm
          key={editing.mode === 'edit' ? editing.group.id : editing.mode === 'fork' ? `fork-${editing.from.id}` : 'new'}
          initial={editing.mode === 'edit' ? editing.group : null}
          prefill={editing.mode === 'fork' ? editing.from : null}
          createScope={
            editing.mode === 'edit'
              ? null
              : { location_id: scope, overrides_group_id: editing.mode === 'fork' ? editing.from.id : null }
          }
          mgmt={mgmt}
          actor={actor}
          onDone={() => {
            setEditing(null)
            onChanged()
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          onClick={() => setEditing({ mode: 'new' })}
          className="mt-2 flex items-center gap-1 rounded-md border border-surface-line bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
        >
          <Plus className="h-3.5 w-3.5" /> {scope === null ? 'Add pool' : 'Add pool for this site'}
        </button>
      )}
    </div>
  )
}

function GroupForm({
  initial,
  prefill,
  createScope,
  mgmt,
  actor,
  onDone,
  onCancel,
}: {
  initial: RequirementGroup | null
  prefill: RequirementGroup | null
  createScope: { location_id: string | null; overrides_group_id: string | null } | null
  mgmt: MgmtPosition[]
  actor: ReturnType<typeof actorFrom>
  onDone: () => void
  onCancel: () => void
}) {
  const seed = initial ?? prefill
  const [name, setName] = useState(seed?.name ?? '')
  const [total, setTotal] = useState(seed?.total_min ?? 0)
  const [roleMins, setRoleMins] = useState<Map<string, number>>(
    () => new Map((seed?.roles ?? []).map((r) => [r.position_id, r.min_count])),
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function toggleRole(id: string) {
    setRoleMins((prev) => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, 0)
      return next
    })
  }

  async function save() {
    if (!name.trim() || roleMins.size === 0) {
      setErr('Give the pool a name and pick at least one role.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await saveRequirementGroup(actor, {
        id: initial?.id,
        name: name.trim(),
        total_min: total,
        roles: [...roleMins].map(([position_id, min_count]) => ({ position_id, min_count })),
        location_id: createScope?.location_id ?? null,
        overrides_group_id: createScope?.overrides_group_id ?? null,
      })
      onDone()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 rounded-md border border-cg-orange/40 bg-surface p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block text-[11px] text-charcoal/50">Pool name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Kitchen line"
            className="rounded-md border border-surface-line px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="block text-[11px] text-charcoal/50">Total needed</span>
          <input
            type="number"
            min={0}
            value={total}
            onChange={(e) => setTotal(Math.max(0, parseInt(e.target.value || '0', 10)))}
            className="w-20 rounded-md border border-surface-line px-2 py-1 text-center text-sm"
          />
        </label>
      </div>
      <p className="mt-2 text-[11px] uppercase tracking-wide text-charcoal/40">
        Roles in this pool (tick, then set a minimum — more senior pool roles count toward it)
      </p>
      <div className="mt-1 grid gap-1 sm:grid-cols-2">
        {mgmt.map((m) => {
          const on = roleMins.has(m.id)
          return (
            <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={on} onChange={() => toggleRole(m.id)} className="accent-cg-orange" />
                <span className="text-charcoal/70">{m.name}</span>
              </label>
              {on && (
                <span className="flex items-center gap-1 text-[11px] text-charcoal/50">
                  min
                  <input
                    type="number"
                    min={0}
                    value={roleMins.get(m.id) ?? 0}
                    onChange={(e) =>
                      setRoleMins((prev) =>
                        new Map(prev).set(m.id, Math.max(0, parseInt(e.target.value || '0', 10))),
                      )
                    }
                    className="w-14 rounded-md border border-surface-line px-1.5 py-0.5 text-center text-sm"
                  />
                </span>
              )}
            </div>
          )
        })}
      </div>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save pool'}
        </button>
        <button onClick={onCancel} className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted">
          Cancel
        </button>
      </div>
    </div>
  )
}
