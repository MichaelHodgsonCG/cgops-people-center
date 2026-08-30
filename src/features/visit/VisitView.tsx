// Visit — the mobile "walk-in" flow (Item 1a). An HQ leader standing inside a
// restaurant picks it once and gets straight to that location's managers, then
// one tap opens the cheat sheet to read/add/save notes. Optimized for thumbs:
// big targets, a sticky location header, last-location remembered so re-entry
// is instant. Reads existing data only — no schema.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AlertTriangle, ArrowLeft, ChevronRight, MapPin, Plus, Search, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PersonPanel } from '../people/PersonPanel'
import { PersonPicker, type PickedPerson } from '../../components/PersonPicker'
import {
  fetchPersonDetail,
  fetchReferenceOptions,
  seatOrSlatePerson,
  type ReferenceOption,
} from '../people/api'
import { actorFrom } from '../../lib/activity'
import { errText } from '../../lib/errText'
import { can, toPermissionUser } from '../../permissions'
import type { UserProfile } from '../../types'

interface VisitPerson {
  id: string
  full_name: string
  status: 'active' | 'leave' | 'departed' | 'incoming' | 'candidate' | 'departing'
  person_kind: 'manager' | 'emerging_leader' | 'key_team_member'
  data_quality_status: 'ok' | 'needs_review'
  position_assignments: {
    is_primary: boolean
    ended_on: string | null
    positions: { name: string } | null
    locations: { name: string } | null
  }[]
}

const PLACEHOLDER_POSITION = 'Needs Position Review'

// Stopgap seniority order for the walk-in list (top-down) until positions.level
// is populated (Item 1b). Lower shows first; unknown positions sort last.
const POSITION_RANK: Record<string, number> = {
  'general manager': 10,
  'general manager in training': 15,
  'assistant general manager': 20,
  'chef de cuisine': 25,
  'head chef': 25,
  'beverage manager': 30,
  'service manager': 30,
  'guest service manager': 30,
  'events manager': 30,
  'senior sous chef': 35,
  'sous chef': 40,
  'front of house supervisor': 45,
  supervisor: 45,
  'chef de partie': 50,
}

function rankOf(positionName: string | null | undefined): number {
  if (!positionName) return 100
  return POSITION_RANK[positionName.trim().toLowerCase()] ?? 100
}

function currentPrimary(p: VisitPerson) {
  const open = p.position_assignments.filter((a) => !a.ended_on)
  const real = open.filter((a) => a.positions?.name !== PLACEHOLDER_POSITION)
  return (
    real.find((a) => a.is_primary) ??
    real[0] ??
    open.find((a) => a.is_primary) ??
    open[0] ??
    null
  )
}

const LAST_LOCATION_KEY = 'pc.visit.location'

interface VisitViewProps {
  session: Session
  profile: UserProfile | null
}

export function VisitView({ session, profile }: VisitViewProps) {
  const [people, setPeople] = useState<VisitPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [location, setLocation] = useState<string | null>(
    () => localStorage.getItem(LAST_LOCATION_KEY),
  )
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Inline "add person to a seat" at the chosen location (executive/admin) —
  // reuses the person panel's reassignment semantics: the pick becomes the
  // person's PRIMARY seat here; their current primary is ended today.
  const canEdit = can(profile ? toPermissionUser(profile) : null, 'update', 'person')
  const actor = actorFrom(profile, session)
  const [adding, setAdding] = useState(false)
  const [refs, setRefs] = useState<{ positions: ReferenceOption[]; locations: ReferenceOption[] } | null>(null)
  const [pickPerson, setPickPerson] = useState<PickedPerson>({ name: '', personId: null })
  const [roleId, setRoleId] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)
  const [addNotice, setAddNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!adding || refs !== null) return
    fetchReferenceOptions().then(setRefs).catch((e: Error) => setAddErr(e.message))
  }, [adding, refs])

  const load = useCallback(() => {
    supabase
      .from('people_center_people')
      .select(
        `id, full_name, status, person_kind, data_quality_status,
         position_assignments:people_center_position_assignments ( is_primary, ended_on,
           positions:people_center_positions ( name ),
           locations:people_center_locations ( name ) )`,
      )
      .neq('status', 'departed')
      .then(({ data, error: err }) => {
        if (err) setError(err.message)
        else setPeople((data as unknown as VisitPerson[]) ?? [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // location name -> people currently placed there, seniority-ordered.
  const byLocation = useMemo(() => {
    const map = new Map<string, VisitPerson[]>()
    for (const p of people) {
      const loc = currentPrimary(p)?.locations?.name
      if (!loc) continue
      if (!map.has(loc)) map.set(loc, [])
      map.get(loc)!.push(p)
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const r = rankOf(currentPrimary(a)?.positions?.name) - rankOf(currentPrimary(b)?.positions?.name)
        return r !== 0 ? r : a.full_name.localeCompare(b.full_name)
      })
    }
    return map
  }, [people])

  const locations = useMemo(
    () => [...byLocation.keys()].sort((a, b) => a.localeCompare(b)),
    [byLocation],
  )

  const filteredLocations = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? locations.filter((l) => l.toLowerCase().includes(q)) : locations
  }, [locations, query])

  function pick(loc: string) {
    setLocation(loc)
    localStorage.setItem(LAST_LOCATION_KEY, loc)
  }

  // Chosen location no longer has anyone (data changed) — fall back to picker.
  const atLocation = location ? byLocation.get(location) ?? [] : null

  // Options for the add-to-seat person picker: everyone loaded (non-departed),
  // roster-linked only (no free text — a seat needs a real person record).
  const seatPeople = useMemo(
    () => people.map((p) => ({ id: p.id, full_name: p.full_name })),
    [people],
  )
  // What the pick will do to the chosen person — their current primary seat
  // is ended when they take this one, so say so before saving.
  const pickedCurrent = useMemo(() => {
    if (!pickPerson.personId) return null
    const p = people.find((x) => x.id === pickPerson.personId)
    if (!p) return null
    const cur = currentPrimary(p)
    if (!cur) return 'no current seat'
    return `${cur.positions?.name ?? 'unknown role'}${cur.locations?.name ? ` — ${cur.locations.name}` : ''}`
  }, [pickPerson.personId, people])

  async function addToSeat() {
    if (!location || !pickPerson.personId || !roleId || !refs) return
    const locId = refs.locations.find((l) => l.name === location)?.id
    const pos = refs.positions.find((x) => x.id === roleId)
    if (!locId || !pos) {
      setAddErr('Could not resolve this location or role — use the person panel instead.')
      return
    }
    setAddSaving(true)
    setAddErr(null)
    setAddNotice(null)
    try {
      const detail = await fetchPersonDetail(pickPerson.personId)
      const outcome = await seatOrSlatePerson(actor, detail, pos.id, locId, pos.name, location)
      setAdding(false)
      setPickPerson({ name: '', personId: null })
      setRoleId('')
      if (outcome === 'slated') {
        setAddNotice(
          `${detail.full_name} slated as ${pos.name} here (opening site) — their current seat is unchanged; see the plan in Bench & Upcoming.`,
        )
      } else if (outcome === 'already_slated') {
        setAddNotice(`${detail.full_name} is already slated as ${pos.name} here — nothing changed.`)
      }
      load()
    } catch (e) {
      setAddErr(errText(e))
    } finally {
      setAddSaving(false)
    }
  }

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading…</p>
  if (error) return <p className="p-6 text-sm text-danger">Could not load: {error}</p>

  // ---- People at the chosen location ----------------------------------------
  if (location && atLocation) {
    return (
      <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
        <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-center gap-2 border-b border-surface-line bg-surface px-4 py-3 sm:-mx-6 sm:px-6">
          <button
            onClick={() => setLocation(null)}
            className="flex items-center gap-1 rounded-md border border-surface-line px-2.5 py-1.5 text-sm hover:bg-surface-muted"
          >
            <ArrowLeft className="h-4 w-4" /> Locations
          </button>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-base font-semibold">
              <MapPin className="h-4 w-4 shrink-0 text-cg-orange" /> {location}
            </p>
            <p className="text-xs text-charcoal/50">
              {atLocation.length} {atLocation.length === 1 ? 'person' : 'people'}
            </p>
          </div>
          {canEdit && !adding && (
            <button
              onClick={() => {
                setAdding(true)
                setAddErr(null)
              }}
              className="ml-auto flex items-center gap-1 rounded-md border border-surface-line px-2.5 py-1.5 text-sm font-medium hover:bg-surface-muted"
            >
              <Plus className="h-4 w-4" /> Add to a seat
            </button>
          )}
        </div>

        {addNotice && (
          <p className="mb-3 rounded-md bg-success/10 px-3 py-2 text-sm text-success">{addNotice}</p>
        )}

        {canEdit && adding && (
          <div className="mb-3 rounded-xl border border-cg-orange/40 bg-cg-orange-soft/30 p-3.5">
            <p className="mb-2 text-sm font-medium">Add a person to a seat at {location}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-0.5 block text-[11px] text-charcoal/50">Who</span>
                <PersonPicker
                  people={seatPeople}
                  value={pickPerson}
                  onChange={setPickPerson}
                  placeholder="Search people…"
                />
              </label>
              <label className="text-sm">
                <span className="mb-0.5 block text-[11px] text-charcoal/50">Seat (role)</span>
                <select
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
                >
                  <option value="">{refs === null ? 'Loading roles…' : 'Choose a role…'}</option>
                  {(refs?.positions ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {pickPerson.personId && pickedCurrent && (
              <p className="mt-2 text-[11px] text-charcoal/60">
                {pickPerson.name} currently: {pickedCurrent}
                {pickedCurrent !== 'no current seat' &&
                  ' — that seat is ended today when this one is saved (history kept).'}
              </p>
            )}
            {pickPerson.name.trim() !== '' && !pickPerson.personId && (
              <p className="mt-2 text-[11px] text-warning">
                Pick a person from the list — seats need an existing person record. To add a brand-new
                hire, use Directory → add person / incoming hire first.
              </p>
            )}
            {addErr && <p className="mt-2 text-xs text-danger">{addErr}</p>}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void addToSeat()}
                disabled={addSaving || !pickPerson.personId || !roleId || refs === null}
                className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
              >
                {addSaving ? 'Saving…' : 'Add to seat'}
              </button>
              <button
                onClick={() => {
                  setAdding(false)
                  setAddErr(null)
                }}
                className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {atLocation.length === 0 ? (
          <p className="rounded-xl border border-surface-line bg-surface p-8 text-center text-sm text-charcoal/60">
            No one is currently placed here.
          </p>
        ) : (
          <ul className="space-y-2">
            {atLocation.map((p) => {
              const primary = currentPrimary(p)
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-surface-line bg-surface p-3.5 text-left active:bg-surface-muted"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-charcoal/70">
                      {initials(p.full_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{p.full_name}</span>
                        {p.data_quality_status === 'needs_review' && (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
                        )}
                        {p.status === 'incoming' && (
                          <span className="rounded-full bg-info/10 px-1.5 text-[10px] font-medium text-info">
                            incoming
                          </span>
                        )}
                        {p.status === 'departing' && (
                          <span className="rounded-full bg-warning/10 px-1.5 text-[10px] font-medium text-warning">
                            departing
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-sm text-charcoal/55">
                        {primary?.positions?.name ?? 'No position'}
                      </span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-charcoal/30" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {selectedId && (
          <PersonPanel
            personId={selectedId}
            session={session}
            profile={profile}
            onClose={() => setSelectedId(null)}
            onChanged={load}
          />
        )}
      </div>
    )
  }

  // ---- Location picker -------------------------------------------------------
  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <h2 className="mb-1 text-lg font-semibold">Which restaurant are you at?</h2>
      <p className="mb-4 text-sm text-charcoal/60">
        Pick a location to see its managers and open their notes.
      </p>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal/40" />
        <input
          type="search"
          inputMode="search"
          placeholder="Search locations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-surface-line bg-surface py-2.5 pl-9 pr-3 text-base focus:border-charcoal focus:outline-none"
        />
      </div>

      {filteredLocations.length === 0 ? (
        <div className="rounded-xl border border-surface-line bg-surface p-10 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-charcoal/30" />
          <p className="text-sm text-charcoal/60">No locations with people yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filteredLocations.map((loc) => (
            <li key={loc}>
              <button
                onClick={() => pick(loc)}
                className="flex w-full items-center gap-3 rounded-xl border border-surface-line bg-surface p-4 text-left active:bg-surface-muted"
              >
                <MapPin className="h-5 w-5 shrink-0 text-cg-orange" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{loc}</span>
                  <span className="block text-xs text-charcoal/50">
                    {byLocation.get(loc)!.length}{' '}
                    {byLocation.get(loc)!.length === 1 ? 'person' : 'people'}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-charcoal/30" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}
