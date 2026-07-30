// Gap analysis (Phase 3): required "ideal restaurant" roster vs. who's actually
// there (open locations) or slated (opening locations). Required counts live in
// people_center_role_requirements (admin/executive editable, one base template
// for v1). Reads reuse position assignments (open sites) and succession slots
// (opening sites).

import { supabase } from '../../lib/supabase'
import { recordAudit, type Actor } from '../../lib/activity'
import { errText } from '../../lib/errText'
import { addPerson } from '../people/api'
import { createSlot, setSlotIncumbent } from '../bench/api'
import type { ResolvedAssignment } from './importXlsx'

export interface RoleRequirement {
  position_id: string
  position_name: string
  level: number | null
  required_count: number
}

interface RawReq {
  position_id: string
  required_count: number
  positions: { name: string; level: number | null } | null
}

export async function fetchRoleRequirements(): Promise<RoleRequirement[]> {
  const { data, error } = await supabase
    .from('people_center_role_requirements')
    .select('position_id, required_count, positions:people_center_positions ( name, level )')
  if (error) throw error
  return ((data as unknown as RawReq[]) ?? [])
    .map((r) => ({
      position_id: r.position_id,
      required_count: r.required_count,
      position_name: r.positions?.name ?? '?',
      level: r.positions?.level ?? null,
    }))
    .sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity))
}

export async function setRoleRequirement(
  actor: Actor,
  positionId: string,
  positionName: string,
  count: number,
): Promise<void> {
  const { error } = await supabase.from('people_center_role_requirements').upsert(
    {
      position_id: positionId,
      required_count: count,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    },
    { onConflict: 'position_id' },
  )
  if (error) throw error
  await recordAudit(
    actor,
    'update',
    'role_requirement',
    positionId,
    positionName,
    `Required count for ${positionName} set to ${count}`,
  )
}

export interface MgmtPosition {
  id: string
  name: string
  level: number | null
}

/** The restaurant management roster (manager + eligible) — the roles the
 * requirements editor lets you set counts for. */
export async function fetchManagementPositions(): Promise<MgmtPosition[]> {
  const { data, error } = await supabase
    .from('people_center_positions')
    .select('id, name, level, default_person_kind, people_center_eligible')
  if (error) throw error
  type Row = {
    id: string
    name: string
    level: number | null
    default_person_kind: string
    people_center_eligible: boolean
  }
  return ((data as unknown as Row[]) ?? [])
    .filter((p) => p.default_person_kind === 'manager' && p.people_center_eligible)
    .map((p) => ({ id: p.id, name: p.name, level: p.level }))
    .sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity))
}

export interface GapLocation {
  id: string
  name: string
  status: string // 'open' (existing) | 'opening' (upcoming)
}

export async function fetchGapLocations(): Promise<GapLocation[]> {
  const { data, error } = await supabase
    .from('people_center_locations')
    .select('id, name, status')
    .in('status', ['open', 'opening'])
    .order('name')
  if (error) throw error
  return (data as unknown as GapLocation[]) ?? []
}

export type GapReason = 'new-site' | 'backfill' | 'understaffed'

export interface CompanyGap {
  location_id: string
  location_name: string
  location_status: 'open' | 'opening'
  position_id: string
  position_name: string
  level: number | null
  required: number
  projected: number
  gap: number
  reason: GapReason
  detail: string // movers "Name → Dest" (backfill), slated names (new-site), or ''
}

/** Company-wide missing roles across every location, accounting for moves: an
 * existing leader slated to a new site vacates their current seat, creating a
 * backfill gap at the origin. Three kinds: new-site (upcoming seats not yet
 * slated), backfill (open site losing someone to a new site), understaffed
 * (open site already below the required roster). */
export async function fetchCompanyGaps(): Promise<CompanyGap[]> {
  const [reqs, locs, assignRes, slotRes] = await Promise.all([
    fetchRoleRequirements(),
    fetchGapLocations(),
    supabase
      .from('people_center_position_assignments')
      .select(
        `position_id, is_primary, ended_on,
         person:people_center_people ( id, full_name, status ),
         location:people_center_locations ( id, status )`,
      )
      .eq('is_primary', true)
      .is('ended_on', null),
    supabase
      .from('people_center_succession_slots')
      .select(
        `position_id, incumbent_person_id,
         incumbent:people_center_people!people_center_succession_slots_incumbent_person_id_fkey ( full_name ),
         location:people_center_locations ( id, name, status )`,
      ),
  ])
  if (assignRes.error) throw assignRes.error
  if (slotRes.error) throw slotRes.error

  const required = reqs.filter((r) => r.required_count > 0)
  const key = (locId: string, posId: string) => `${locId}|${posId}`

  // Current seats at OPEN locations, and everyone's origin (person → their seat).
  type A = {
    position_id: string | null
    person: { id: string; full_name: string; status: string } | null
    location: { id: string; status: string } | null
  }
  const curByCell = new Map<string, { id: string; name: string }[]>()
  // Incoming/active external hires assigned to an OPENING site — they belong on
  // that site's future roster alongside slated leaders (unioned + de-duped by
  // person below), so the "add incoming hire" flow works for upcoming sites.
  const openingAsgByCell = new Map<string, { id: string; name: string }[]>()
  for (const a of (assignRes.data as unknown as A[]) ?? []) {
    if (!a.position_id || !a.location || !a.person) continue
    const k = key(a.location.id, a.position_id)
    if (a.location.status === 'open') {
      if (a.person.status !== 'active' && a.person.status !== 'leave') continue
      const arr = curByCell.get(k) ?? []
      arr.push({ id: a.person.id, name: a.person.full_name })
      curByCell.set(k, arr)
    } else if (a.location.status === 'opening') {
      const st = a.person.status
      if (st !== 'incoming' && st !== 'active' && st !== 'leave') continue
      const arr = openingAsgByCell.get(k) ?? []
      arr.push({ id: a.person.id, name: a.person.full_name })
      openingAsgByCell.set(k, arr)
    }
  }

  // Slated leaders at OPENING locations → the future fill there, and the set of
  // people moving (person → destination) that drives backfill at their origin.
  type S = {
    position_id: string | null
    incumbent_person_id: string | null
    incumbent: { full_name: string } | null
    location: { id: string; name: string; status: string } | null
  }
  const slatedByCell = new Map<string, { id: string; name: string }[]>()
  const moverDest = new Map<string, string>()
  for (const s of (slotRes.data as unknown as S[]) ?? []) {
    if (!s.position_id || !s.location || s.location.status !== 'opening') continue
    if (!s.incumbent_person_id || !s.incumbent) continue
    const k = key(s.location.id, s.position_id)
    const arr = slatedByCell.get(k) ?? []
    arr.push({ id: s.incumbent_person_id, name: s.incumbent.full_name })
    slatedByCell.set(k, arr)
    moverDest.set(s.incumbent_person_id, s.location.name)
  }

  const out: CompanyGap[] = []
  for (const loc of locs) {
    for (const r of required) {
      const k = key(loc.id, r.position_id)
      if (loc.status === 'opening') {
        // Future roster = slated leaders ∪ incoming/active hires assigned here,
        // de-duped by person (someone both slated and assigned counts once).
        const byId = new Map<string, string>()
        for (const p of slatedByCell.get(k) ?? []) byId.set(p.id, p.name)
        for (const p of openingAsgByCell.get(k) ?? []) byId.set(p.id, p.name)
        const names = [...byId.values()]
        const gap = Math.max(0, r.required_count - byId.size)
        if (gap > 0) {
          out.push({
            location_id: loc.id,
            location_name: loc.name,
            location_status: 'opening',
            position_id: r.position_id,
            position_name: r.position_name,
            level: r.level,
            required: r.required_count,
            projected: byId.size,
            gap,
            reason: 'new-site',
            detail: names.length ? `named: ${names.join(', ')}` : '',
          })
        }
      } else {
        const cur = curByCell.get(k) ?? []
        const movers = cur.filter((p) => moverDest.has(p.id))
        const projected = cur.length - movers.length
        const gap = Math.max(0, r.required_count - projected)
        if (gap > 0) {
          out.push({
            location_id: loc.id,
            location_name: loc.name,
            location_status: 'open',
            position_id: r.position_id,
            position_name: r.position_name,
            level: r.level,
            required: r.required_count,
            projected,
            gap,
            reason: movers.length > 0 ? 'backfill' : 'understaffed',
            detail: movers.map((m) => `${m.name} → ${moverDest.get(m.id)}`).join(', '),
          })
        }
      }
    }
  }

  const order: Record<GapReason, number> = { 'new-site': 0, backfill: 1, understaffed: 2 }
  return out.sort(
    (a, b) =>
      order[a.reason] - order[b.reason] ||
      a.location_name.localeCompare(b.location_name) ||
      (a.level ?? Infinity) - (b.level ?? Infinity),
  )
}

export interface Fill {
  count: number
  names: string[]
}

/** Who fills each role at a location. Open site → active people currently
 * assigned there; opening site → slated leaders (succession incumbents). Keyed
 * by position_id. */
export async function fetchFillForLocation(
  locationId: string,
  upcoming: boolean,
): Promise<Map<string, Fill>> {
  const map = new Map<string, Fill>()
  const add = (positionId: string | null, name: string | null) => {
    if (!positionId) return
    const f = map.get(positionId) ?? { count: 0, names: [] }
    f.count += 1
    if (name) f.names.push(name)
    map.set(positionId, f)
  }

  if (upcoming) {
    // Opening-site roster = slated leaders (succession incumbents) UNION
    // incoming/active external hires assigned to the site (the "add incoming
    // hire" flow), de-duped by person so someone both slated and assigned
    // counts once. Before opening, the whole roster is a future fill, so an
    // incoming hire assigned here belongs on it just like a slated leader.
    const seen = new Map<string, Set<string>>() // position_id -> person ids
    const addUnique = (positionId: string | null, personId: string | null, name: string | null) => {
      if (!positionId || !personId) return
      const s = seen.get(positionId) ?? new Set<string>()
      if (s.has(personId)) return
      s.add(personId)
      seen.set(positionId, s)
      add(positionId, name)
    }
    const [slotRes, asgRes] = await Promise.all([
      supabase
        .from('people_center_succession_slots')
        .select(
          `position_id,
           incumbent:people_center_people!people_center_succession_slots_incumbent_person_id_fkey ( id, full_name )`,
        )
        .eq('location_id', locationId),
      supabase
        .from('people_center_position_assignments')
        .select(`position_id, ended_on, person:people_center_people ( id, full_name, status )`)
        .eq('location_id', locationId)
        .eq('is_primary', true)
        .is('ended_on', null),
    ])
    if (slotRes.error) throw slotRes.error
    if (asgRes.error) throw asgRes.error
    type SlotRow = { position_id: string | null; incumbent: { id: string; full_name: string } | null }
    for (const r of (slotRes.data as unknown as SlotRow[]) ?? []) {
      if (r.incumbent?.id) addUnique(r.position_id, r.incumbent.id, r.incumbent.full_name)
    }
    type AsgRow = {
      position_id: string | null
      person: { id: string; full_name: string; status: string } | null
    }
    for (const r of (asgRes.data as unknown as AsgRow[]) ?? []) {
      const st = r.person?.status
      if (r.person && (st === 'incoming' || st === 'active' || st === 'leave')) {
        addUnique(r.position_id, r.person.id, r.person.full_name)
      }
    }
    return map
  }

  const { data, error } = await supabase
    .from('people_center_position_assignments')
    .select(
      `position_id, ended_on,
       person:people_center_people ( full_name, status )`,
    )
    .eq('location_id', locationId)
    .eq('is_primary', true)
    .is('ended_on', null)
  if (error) throw error
  type Row = {
    position_id: string | null
    person: { full_name: string; status: string } | null
  }
  for (const r of (data as unknown as Row[]) ?? []) {
    // A person's PRIMARY seat counts (matches the company-wide computation, so
    // the two views never disagree). Employed people only (active/leave).
    if (r.person && (r.person.status === 'active' || r.person.status === 'leave')) {
      add(r.position_id, r.person.full_name)
    }
  }
  return map
}

// --- Excel round-trip: apply filled-in assignments as slated leaders ---------

export interface SeatRef {
  id: string
  incumbentPersonId: string | null
}

/** Existing succession seats grouped by `${locationId}|${positionId}` → a LIST
 * (a location can have several seats for the same role, e.g. 3 Sous). On import
 * we fill VACANT seats first and create new ones as needed, never overwriting a
 * seat already held by someone else. */
export async function fetchSlotIndex(): Promise<Map<string, SeatRef[]>> {
  const { data, error } = await supabase
    .from('people_center_succession_slots')
    .select('id, position_id, location_id, incumbent_person_id')
  if (error) throw error
  type Row = {
    id: string
    position_id: string
    location_id: string | null
    incumbent_person_id: string | null
  }
  const m = new Map<string, SeatRef[]>()
  for (const s of (data as unknown as Row[]) ?? []) {
    if (!s.location_id) continue
    const k = `${s.location_id}|${s.position_id}`
    const arr = m.get(k) ?? []
    arr.push({ id: s.id, incumbentPersonId: s.incumbent_person_id })
    m.set(k, arr)
  }
  return m
}

/** Everyone (except departed) for name matching on import. */
export async function fetchPeopleForMatch(): Promise<{ id: string; full_name: string }[]> {
  const { data, error } = await supabase
    .from('people_center_people')
    .select('id, full_name')
    .neq('status', 'departed')
  if (error) throw error
  return (data as unknown as { id: string; full_name: string }[]) ?? []
}

export interface ApplyResult {
  created: number // new candidate people added
  linked: number // matched to existing people
  slotsSet: number // succession seats set/updated
  errors: string[]
}

/** Record each resolved assignment as a slated leader: link or create the
 * person, then set (or create) the succession seat's incumbent for that
 * location+role. Error rows are skipped by the caller. */
export async function applyAssignments(
  actor: Actor,
  items: ResolvedAssignment[],
  slotIndex: Map<string, SeatRef[]>,
): Promise<ApplyResult> {
  const res: ApplyResult = { created: 0, linked: 0, slotsSet: 0, errors: [] }
  // Mutable working copy: consume vacant seats and append newly-created ones so
  // several people for the same role land on SEPARATE seats (3 Sous → 3 seats)
  // instead of overwriting one.
  const seatsByKey = new Map<string, SeatRef[]>()
  for (const [k, v] of slotIndex) seatsByKey.set(k, v.map((s) => ({ ...s })))

  for (const it of items) {
    if (it.action === 'error' || !it.locationId || !it.positionId) continue
    try {
      let personId = it.personId
      if (!personId) {
        personId = await addPerson(actor, {
          fullName: it.personName,
          email: null,
          status: 'candidate',
          offRoster: false,
          personKind: 'manager',
          positionId: null,
          positionName: null,
          locationId: null,
          locationName: null,
          startDate: null,
          managerPersonId: null,
        })
        res.created++
      } else {
        res.linked++
      }
      const label = `${it.roleName} — ${it.locationName}`
      const k = `${it.locationId}|${it.positionId}`
      const seats = seatsByKey.get(k) ?? []
      // Already slated into a seat for this role → nothing to change.
      if (seats.some((s) => s.incumbentPersonId === personId)) {
        res.slotsSet++
        continue
      }
      // Fill the first vacant seat; otherwise create a new one.
      const vacant = seats.find((s) => s.incumbentPersonId === null)
      if (vacant) {
        await setSlotIncumbent(actor, vacant.id, personId, label)
        vacant.incumbentPersonId = personId
      } else {
        await createSlot(actor, it.positionId, it.locationId, null, personId, label)
        seats.push({ id: `new:${personId}`, incumbentPersonId: personId })
        seatsByKey.set(k, seats)
      }
      res.slotsSet++
    } catch (e) {
      res.errors.push(`${it.personName} → ${it.roleName} @ ${it.locationName}: ${errText(e)}`)
    }
  }
  return res
}
