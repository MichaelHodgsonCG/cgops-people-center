// Covered-locations admin picker (admin/executive). For a chosen user it shows
// their EFFECTIVE coverage — region-derived default ∪ scope grants — with the
// derivation of every location visible (so an admin understands WHY someone
// sees it), respects the can_view_all flag, and lets them add/remove bespoke
// scope grants. RLS enforces who may manage (migration 20260724150000);
// this screen just drives it. Replaces the raw-SQL workflow.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Eye, MapPin, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import { can, toPermissionUser } from '../../permissions'
import type { UserProfile } from '../../types'
import {
  addScope,
  fetchCoverageLocations,
  fetchRegions,
  fetchScopeUsers,
  fetchScopes,
  removeScope,
  type CoverageLocation,
  type Region,
  type ScopeGrant,
  type ScopeUser,
} from './api'

interface CoverageViewProps {
  session: Session
  profile: UserProfile | null
}

type Reason =
  | { kind: 'region_default'; region: string }
  | { kind: 'grant_region'; region: string }
  | { kind: 'grant_location' }

export function CoverageView({ session, profile }: CoverageViewProps) {
  const actor = actorFrom(profile, session)
  const user = profile ? toPermissionUser(profile) : null
  const canManage = can(user, 'view', 'user_scopes') // admin (all) or executive

  const [users, setUsers] = useState<ScopeUser[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [locations, setLocations] = useState<CoverageLocation[]>([])
  const [selectedAuthId, setSelectedAuthId] = useState<string>('')
  const [scopes, setScopes] = useState<ScopeGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Add-grant form
  const [grantType, setGrantType] = useState<'region' | 'location'>('region')
  const [grantId, setGrantId] = useState('')

  useEffect(() => {
    Promise.all([fetchScopeUsers(), fetchRegions(), fetchCoverageLocations()])
      .then(([u, r, l]) => {
        setUsers(u)
        setRegions(r)
        setLocations(l)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const loadScopes = useCallback((authId: string) => {
    if (!authId) {
      setScopes([])
      return
    }
    fetchScopes(authId)
      .then(setScopes)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    loadScopes(selectedAuthId)
  }, [selectedAuthId, loadScopes])

  const regionById = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions])
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations])
  const selectedUser = users.find((u) => u.auth_user_id === selectedAuthId) ?? null
  const seesEverything =
    !!selectedUser && (selectedUser.role === 'admin' || selectedUser.can_view_all)

  // Effective coverage: location id -> the reasons it's covered.
  const coverage = useMemo(() => {
    const map = new Map<string, Reason[]>()
    if (!selectedUser) return map
    const push = (locId: string, reason: Reason) => {
      const arr = map.get(locId) ?? []
      arr.push(reason)
      map.set(locId, arr)
    }
    // Region-derived default: regions this person leads.
    if (selectedUser.person_id) {
      const ledRegionIds = new Set(
        regions.filter((r) => r.leader_person_id === selectedUser.person_id).map((r) => r.id),
      )
      for (const l of locations) {
        if (l.region_id && ledRegionIds.has(l.region_id)) {
          push(l.id, { kind: 'region_default', region: regionById.get(l.region_id)?.name ?? '?' })
        }
      }
    }
    // Scope grants: whole-region or single-location.
    for (const s of scopes) {
      if (s.region_id) {
        const rname = regionById.get(s.region_id)?.name ?? '?'
        for (const l of locations) {
          if (l.region_id === s.region_id) push(l.id, { kind: 'grant_region', region: rname })
        }
      } else if (s.location_id) {
        push(s.location_id, { kind: 'grant_location' })
      }
    }
    return map
  }, [selectedUser, regions, locations, scopes, regionById])

  const coveredRows = useMemo(
    () =>
      [...coverage.entries()]
        .map(([locId, reasons]) => ({ loc: locationById.get(locId), reasons }))
        .filter((r) => r.loc)
        .sort((a, b) => (a.loc!.name ?? '').localeCompare(b.loc!.name ?? '')),
    [coverage, locationById],
  )

  async function handleAdd() {
    if (!selectedUser || !grantId) return
    setBusy(true)
    setError(null)
    try {
      const label =
        grantType === 'region'
          ? `region ${regionById.get(grantId)?.name ?? grantId}`
          : `location ${locationById.get(grantId)?.name ?? grantId}`
      await addScope(
        actor,
        selectedUser,
        grantType === 'region' ? { regionId: grantId } : { locationId: grantId },
        label,
      )
      setGrantId('')
      loadScopes(selectedUser.auth_user_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(s: ScopeGrant) {
    if (!selectedUser) return
    setBusy(true)
    setError(null)
    try {
      const label = s.region_id
        ? `region ${regionById.get(s.region_id)?.name ?? s.region_id}`
        : `location ${locationById.get(s.location_id ?? '')?.name ?? s.location_id}`
      await removeScope(actor, s.id, selectedUser.email, label)
      loadScopes(selectedUser.auth_user_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!canManage) {
    return <p className="p-6 text-sm text-danger">Covered locations is available to HQ (admin/executive) only.</p>
  }
  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading coverage…</p>

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <MapPin className="h-5 w-5 text-cg-orange" /> Covered locations
      </h2>
      <p className="mb-4 max-w-2xl text-sm text-charcoal/60">
        See exactly which locations a user can reach and why — their region-derived
        default (from the region they lead) plus any bespoke grants — and add or
        remove grants. Replaces the raw-SQL workflow.
      </p>

      {error && (
        <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-xs uppercase tracking-wide text-charcoal/50">User</label>
        <select
          value={selectedAuthId}
          onChange={(e) => setSelectedAuthId(e.target.value)}
          className="min-w-[18rem] rounded-md border border-surface-line bg-surface px-3 py-2 text-sm"
        >
          <option value="">— choose a user —</option>
          {users.map((u) => (
            <option key={u.auth_user_id} value={u.auth_user_id}>
              {u.display_name ?? u.email} · {u.role}
            </option>
          ))}
        </select>
      </div>

      {!selectedUser ? (
        <p className="text-sm text-charcoal/50">Pick a user to see their coverage.</p>
      ) : (
        <div className="space-y-4">
          {/* Identity + view-all state */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-surface-line bg-surface p-4">
            <span className="font-medium">{selectedUser.display_name ?? selectedUser.email}</span>
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs capitalize">
              {selectedUser.role}
            </span>
            {seesEverything && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                <Eye className="h-3 w-3" />
                Sees ALL locations{selectedUser.role === 'admin' ? ' (admin)' : ' (can_view_all)'}
              </span>
            )}
          </div>

          {seesEverything && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              This user bypasses scoping and sees every location. Region-derived
              coverage and the grants below have no effect while this is on
              {selectedUser.role !== 'admin'
                ? ' — clear can_view_all in the Users panel to enforce scoping.'
                : ' (admins always see everything).'}
            </p>
          )}

          {/* Effective coverage */}
          <section className="overflow-hidden rounded-xl border border-surface-line bg-surface">
            <div className="flex items-center justify-between border-b border-surface-line px-4 py-2.5">
              <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal/50">
                <ShieldCheck className="h-3.5 w-3.5" /> Effective coverage
              </h3>
              <span className="text-xs text-charcoal/50">
                {seesEverything ? `all ${locations.length}` : coveredRows.length} location
                {(seesEverything ? locations.length : coveredRows.length) === 1 ? '' : 's'}
              </span>
            </div>
            {!seesEverything && coveredRows.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-charcoal/50">
                No coverage — this user sees no locations. Add a grant below.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
                    <th className="px-4 py-2 font-medium">Location</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Why they see it</th>
                  </tr>
                </thead>
                <tbody>
                  {(seesEverything
                    ? locations.map((l) => ({ loc: l, reasons: [] as Reason[] }))
                    : coveredRows
                  ).map(({ loc, reasons }) => (
                    <tr key={loc!.id} className="border-b border-surface-line/60 last:border-0">
                      <td className="px-4 py-2 font-medium">{loc!.name}</td>
                      <td className="px-4 py-2 text-xs capitalize text-charcoal/60">{loc!.status ?? '—'}</td>
                      <td className="px-4 py-2 text-xs text-charcoal/60">
                        {seesEverything ? (
                          <span className="text-warning">sees all</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {reasons.map((r, i) => (
                              <ReasonChip key={i} reason={r} />
                            ))}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Scope grants management */}
          <section className="rounded-xl border border-surface-line bg-surface p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-charcoal/50">
              Bespoke grants
            </h3>
            {scopes.length === 0 ? (
              <p className="mb-3 text-sm text-charcoal/50">No bespoke grants — coverage is region-derived only.</p>
            ) : (
              <ul className="mb-3 space-y-1.5">
                {scopes.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-surface-line px-3 py-1.5 text-sm"
                  >
                    <span className="flex items-center gap-1.5">
                      {s.region_id ? (
                        <>
                          <MapPin className="h-3.5 w-3.5 text-info" />
                          Region: {regionById.get(s.region_id)?.name ?? s.region_id}
                        </>
                      ) : (
                        <>
                          <MapPin className="h-3.5 w-3.5 text-charcoal/50" />
                          Location: {locationById.get(s.location_id ?? '')?.name ?? s.location_id}
                        </>
                      )}
                    </span>
                    <button
                      onClick={() => void handleRemove(s)}
                      disabled={busy}
                      aria-label="Remove grant"
                      className="rounded p-1 text-charcoal/40 hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-surface-line pt-3">
              <select
                value={grantType}
                onChange={(e) => {
                  setGrantType(e.target.value as 'region' | 'location')
                  setGrantId('')
                }}
                className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
              >
                <option value="region">Whole region</option>
                <option value="location">Single location</option>
              </select>
              <select
                value={grantId}
                onChange={(e) => setGrantId(e.target.value)}
                className="min-w-[14rem] rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
              >
                <option value="">— choose {grantType} —</option>
                {grantType === 'region'
                  ? regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))
                  : locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
              </select>
              <button
                onClick={() => void handleAdd()}
                disabled={busy || !grantId}
                className="flex items-center gap-1.5 rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Add grant
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function ReasonChip({ reason }: { reason: Reason }) {
  if (reason.kind === 'region_default') {
    return (
      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px]">
        Region default · leads {reason.region}
      </span>
    )
  }
  if (reason.kind === 'grant_region') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-[11px] text-info">
        <Plus className="h-2.5 w-2.5" /> Grant: region {reason.region}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 text-[11px] text-info">
      <Plus className="h-2.5 w-2.5" /> Grant: location
    </span>
  )
}
