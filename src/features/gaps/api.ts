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
  id: string
  position_id: string
  position_name: string
  level: number | null
  required_count: number
  location_id: string | null // null = global default; else a per-location override
}

interface RawReq {
  id: string
  position_id: string
  required_count: number
  location_id: string | null
  positions: { name: string; level: number | null } | null
}

/** ALL single-role requirement rows — global defaults (location_id null) and
 * per-location overrides. Callers resolve the effective set per location with
 * resolveSingleRequirements(). */
export async function fetchRoleRequirements(): Promise<RoleRequirement[]> {
  const { data, error } = await supabase
    .from('people_center_role_requirements')
    .select('id, position_id, required_count, location_id, positions:people_center_positions ( name, level )')
  if (error) throw error
  return ((data as unknown as RawReq[]) ?? [])
    .map((r) => ({
      id: r.id,
      position_id: r.position_id,
      required_count: r.required_count,
      location_id: r.location_id,
      position_name: r.positions?.name ?? '?',
      level: r.positions?.level ?? null,
    }))
    .sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity))
}

/** Set a required count. locationId null writes the global default; a location
 * id writes (or updates) that location's override for the role. */
export async function setRoleRequirement(
  actor: Actor,
  positionId: string,
  positionName: string,
  count: number,
  locationId: string | null = null,
): Promise<void> {
  const sel = supabase
    .from('people_center_role_requirements')
    .select('id')
    .eq('position_id', positionId)
    .limit(1)
  const { data: existing, error: selErr } = await (locationId === null
    ? sel.is('location_id', null)
    : sel.eq('location_id', locationId))
  if (selErr) throw selErr
  if (existing && existing.length > 0) {
    const { error } = await supabase
      .from('people_center_role_requirements')
      .update({ required_count: count, updated_by: actor.personId, updated_by_name: actor.name })
      .eq('id', (existing[0] as { id: string }).id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('people_center_role_requirements').insert({
      position_id: positionId,
      required_count: count,
      location_id: locationId,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    if (error) throw error
  }
  await recordAudit(
    actor,
    'update',
    'role_requirement',
    positionId,
    positionName,
    `Required count for ${positionName}${locationId ? ' (location override)' : ''} set to ${count}`,
  )
}

/** Remove a location's override for a role, so it falls back to the global
 * default again. */
export async function clearRoleRequirement(
  actor: Actor,
  positionId: string,
  positionName: string,
  locationId: string,
): Promise<void> {
  const { error } = await supabase
    .from('people_center_role_requirements')
    .delete()
    .eq('position_id', positionId)
    .eq('location_id', locationId)
  if (error) throw error
  await recordAudit(
    actor,
    'update',
    'role_requirement',
    positionId,
    positionName,
    `Location override for ${positionName} removed (back to global)`,
  )
}

export interface MgmtPosition {
  id: string
  name: string
  level: number | null
}

/** The restaurant roster ladder — every in-restaurant role (GM=10 down to
 * Chef de Partie=50), which is level >= 10; corporate roles are <= 7. This is
 * the set the requirements editor + group builder can pick from, so line roles
 * like Supervisor and Chef de Partie can now be part of the gap analysis. */
export async function fetchManagementPositions(): Promise<MgmtPosition[]> {
  const { data, error } = await supabase
    .from('people_center_positions')
    .select('id, name, level, show_in_people_center')
  if (error) throw error
  type Row = { id: string; name: string; level: number | null; show_in_people_center: boolean }
  return ((data as unknown as Row[]) ?? [])
    .filter((p) => p.show_in_people_center && p.level != null && p.level >= 10)
    .map((p) => ({ id: p.id, name: p.name, level: p.level }))
    .sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity))
}

// --- Pooled requirement groups (e.g. kitchen line = 5, min 2 Sous) ----------

export interface GroupRole {
  position_id: string
  position_name: string
  level: number | null
  min_count: number
}
export interface RequirementGroup {
  id: string
  name: string
  total_min: number
  location_id: string | null // null = global default; else a per-location pool
  overrides_group_id: string | null // set when a location pool replaces a global one
  roles: GroupRole[]
}

/** ALL pools — global (location_id null) and per-location. Callers resolve the
 * effective set per location with resolveGroupRequirements(). */
export async function fetchRequirementGroups(): Promise<RequirementGroup[]> {
  const { data, error } = await supabase
    .from('people_center_requirement_groups')
    .select(
      `id, name, total_min, sort_order, location_id, overrides_group_id,
       roles:people_center_requirement_group_roles (
         position_id, min_count, positions:people_center_positions ( name, level ) )`,
    )
    .order('sort_order')
  if (error) throw error
  type Row = {
    id: string
    name: string
    total_min: number
    sort_order: number
    location_id: string | null
    overrides_group_id: string | null
    roles: {
      position_id: string
      min_count: number
      positions: { name: string; level: number | null } | null
    }[]
  }
  return ((data as unknown as Row[]) ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    total_min: g.total_min,
    location_id: g.location_id,
    overrides_group_id: g.overrides_group_id,
    roles: (g.roles ?? [])
      .map((r) => ({
        position_id: r.position_id,
        position_name: r.positions?.name ?? '?',
        level: r.positions?.level ?? null,
        min_count: r.min_count,
      }))
      .sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity)),
  }))
}

export async function saveRequirementGroup(
  actor: Actor,
  group: {
    id?: string
    name: string
    total_min: number
    roles: { position_id: string; min_count: number }[]
    location_id?: string | null
    overrides_group_id?: string | null
  },
): Promise<void> {
  let groupId = group.id
  if (groupId) {
    // Edit keeps the pool's scope (location_id / overrides_group_id) as-is.
    const { error } = await supabase
      .from('people_center_requirement_groups')
      .update({ name: group.name, total_min: group.total_min, updated_by: actor.personId, updated_by_name: actor.name })
      .eq('id', groupId)
    if (error) throw error
  } else {
    const { data, error } = await supabase
      .from('people_center_requirement_groups')
      .insert({
        name: group.name,
        total_min: group.total_min,
        location_id: group.location_id ?? null,
        overrides_group_id: group.overrides_group_id ?? null,
        updated_by: actor.personId,
        updated_by_name: actor.name,
      })
      .select('id')
    if (error) throw error
    groupId = data![0].id as string
  }
  // Replace the group's roles wholesale.
  await supabase.from('people_center_requirement_group_roles').delete().eq('group_id', groupId)
  if (group.roles.length > 0) {
    const { error } = await supabase.from('people_center_requirement_group_roles').insert(
      group.roles.map((r) => ({ group_id: groupId, position_id: r.position_id, min_count: r.min_count })),
    )
    if (error) throw error
  }
  await recordAudit(actor, group.id ? 'update' : 'create', 'requirement_group', groupId ?? null, group.name,
    `Group "${group.name}" = ${group.total_min} total across ${group.roles.length} role(s)`)
}

export async function deleteRequirementGroup(actor: Actor, id: string, name: string): Promise<void> {
  const { error } = await supabase.from('people_center_requirement_groups').delete().eq('id', id)
  if (error) throw error
  await recordAudit(actor, 'delete', 'requirement_group', id, name, `Deleted group "${name}"`)
}

// --- Per-location resolution: global default + overrides, most-specific wins --

/** Effective single-role requirements at a location: the global row for each
 * position, replaced by this location's override where one exists. Pass a null
 * locationId to get the global defaults alone. */
export function resolveSingleRequirements(
  all: RoleRequirement[],
  locationId: string | null,
): RoleRequirement[] {
  const byPos = new Map<string, RoleRequirement>()
  for (const r of all) if (r.location_id === null) byPos.set(r.position_id, r)
  if (locationId !== null) {
    for (const r of all) if (r.location_id === locationId) byPos.set(r.position_id, r)
  }
  return [...byPos.values()].sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity))
}

/** Effective pools at a location: global pools that this location hasn't
 * overridden, plus this location's own pools (overrides + location-only adds).
 * Pass a null locationId to get the global pools alone. */
export function resolveGroupRequirements(
  all: RequirementGroup[],
  locationId: string | null,
): RequirementGroup[] {
  if (locationId === null) return all.filter((g) => g.location_id === null)
  const locGroups = all.filter((g) => g.location_id === locationId)
  const overridden = new Set(
    locGroups.map((g) => g.overrides_group_id).filter((x): x is string => x !== null),
  )
  const globals = all.filter((g) => g.location_id === null && !overridden.has(g.id))
  return [...globals, ...locGroups]
}

/** People counting toward a pool role's minimum: that role plus any pool role
 * at the same or a more senior level (lower level number) — a Senior Sous
 * satisfies a Sous minimum. Roles without a level rank as most junior. */
export function minCover(
  group: RequirementGroup,
  role: GroupRole,
  filledByPosition: Map<string, number>,
): number {
  const lvl = (r: GroupRole) => r.level ?? Infinity
  return group.roles.reduce(
    (s, o) => (lvl(o) <= lvl(role) ? s + (filledByPosition.get(o.position_id) ?? 0) : s),
    0,
  )
}

/** Gap for one pooled group given how many of each role are filled. Minimums
 * count seniority-down (see minCover), which makes them NESTED thresholds:
 * each junior minimum's covering set contains every senior one's. The bodies
 * needed for the minimums is therefore the LARGEST at-or-above shortfall —
 * one senior hire counts toward every junior minimum — not their sum.
 * Overall gap = max( total_min − filledTotal, that largest shortfall ). */
export function groupGap(
  group: RequirementGroup,
  filledByPosition: Map<string, number>,
): { gap: number; filledTotal: number; detail: string } {
  let filledTotal = 0
  let minShort = 0
  const parts: string[] = []
  for (const r of group.roles) {
    const f = filledByPosition.get(r.position_id) ?? 0
    filledTotal += f
    if (r.min_count > 0) {
      const cover = minCover(group, r, filledByPosition)
      minShort = Math.max(minShort, r.min_count - cover)
      // Always show the LITERAL headcount for the role (so the per-role
      // numbers add up to filledTotal); senior cover only annotates.
      const seniorCovers = f < r.min_count && cover >= r.min_count
      parts.push(`${r.position_name} ${f}/${r.min_count} min${seniorCovers ? ' (senior covers)' : ''}`)
    } else {
      parts.push(`${r.position_name} ${f}`)
    }
  }
  const totalShort = Math.max(0, group.total_min - filledTotal)
  return {
    gap: Math.max(totalShort, minShort, 0),
    filledTotal,
    detail: `have ${filledTotal}/${group.total_min}${parts.length ? ` · ${parts.join(', ')}` : ''}`,
  }
}

export interface GapLocation {
  id: string
  name: string
  status: string // 'open' (existing) | 'opening' (upcoming)
}

export async function fetchGapLocations(): Promise<GapLocation[]> {
  // Restaurants only: the required roster measures concept sites (Beertown,
  // Wildcraft, …). Locations without a concept — Head Office — run an entirely
  // different roster and stay out of the gap analysis.
  const { data, error } = await supabase
    .from('people_center_locations')
    .select('id, name, status')
    .in('status', ['open', 'opening'])
    .not('concept_id', 'is', null)
    .order('name')
  if (error) throw error
  return (data as unknown as GapLocation[]) ?? []
}

export type GapReason = 'new-site' | 'backfill' | 'understaffed'
export type GapPriority = 'high' | 'medium' | 'low'

export interface CompanyGap {
  location_id: string
  location_name: string
  location_status: 'open' | 'opening'
  kind: 'role' | 'group'
  position_id: string // role: the position id; group: the group id
  position_name: string // role: role name; group: group name
  member_position_ids?: string[] // group only — its roles, for role-filtering
  overrides_group_id?: string | null // group only — the global pool this one replaces
  level: number | null
  required: number
  projected: number
  gap: number
  reason: GapReason
  detail: string // movers "Name → Dest" (backfill), slated names (new-site), or ''
  incoming_names?: string[] // named hires here who haven't started — the maybes
  bench_names?: string[] // ranked successors for the seat, e.g. "Dinesh (#1)" — a plan, not fill
  // When the seat must be filled: the staffing deadline (handover date) of the
  // opening site (new-site), or of the mover's destination (backfill) — the
  // firm date set in Restaurant Center. null = now / not scheduled.
  needed_by: string | null
  priority: GapPriority
}

/** Company-wide missing roles across every location, accounting for moves: an
 * existing leader slated to a new site vacates their current seat, creating a
 * backfill gap at the origin. Three kinds: new-site (upcoming seats not yet
 * slated), backfill (open site losing someone to a new site), understaffed
 * (open site already below the required roster).
 *
 * includeIncoming: whether named hires who haven't started yet count as fill.
 * Either way their names are surfaced on the rows via incoming_names. */
export async function fetchCompanyGaps(includeIncoming = true): Promise<CompanyGap[]> {
  const [reqs, groups, locs, siteRes, assignRes, slotRes] = await Promise.all([
    fetchRoleRequirements(),
    fetchRequirementGroups(),
    fetchGapLocations(),
    // Staffing deadlines: Restaurant Center's opening_sites (handover date,
    // falling back to opening date), matched to locations by name — the same
    // link the Upcoming page uses (opening_sites carries no location id).
    supabase.from('opening_sites').select('name, handover_date, opening_date'),
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
         incumbent:people_center_people!people_center_succession_slots_incumbent_person_id_fkey ( full_name, status ),
         location:people_center_locations ( id, name, status ),
         candidates:people_center_succession_candidates ( rank, people:people_center_people ( full_name ) )`,
      ),
  ])
  if (assignRes.error) throw assignRes.error
  if (slotRes.error) throw slotRes.error
  if (siteRes.error) throw siteRes.error

  const key = (locId: string, posId: string) => `${locId}|${posId}`

  // location name (normalized) -> staffing deadline (ISO date)
  const norm = (s: string) => s.trim().toLowerCase()
  const deadlineByName = new Map<string, string>()
  type Site = { name: string | null; handover_date: string | null; opening_date: string | null }
  for (const s of (siteRes.data as unknown as Site[]) ?? []) {
    const d = s.handover_date ?? s.opening_date
    if (s.name && d) deadlineByName.set(norm(s.name), d)
  }

  // Priority is computed, not stored, so it never goes stale:
  //  high   — needed now/within 60 days with NO plan (no bench, no incoming),
  //           or a senior seat (GM/CdC, level <= 20) with no plan at any date
  //  medium — needed soon but a plan exists, or unplanned further out
  //  low    — far out with a plan
  // An unknown date counts as urgent: with nothing scheduled it can't be deferred.
  const todayMs = Date.now()
  const priorityFor = (
    neededBy: string | null,
    level: number | null,
    hasPlan: boolean,
  ): GapPriority => {
    const days = neededBy ? Math.round((Date.parse(neededBy) - todayMs) / 86400000) : 0
    const urgent = !neededBy || days <= 60
    const senior = (level ?? 99) <= 20
    if (!hasPlan && (urgent || senior)) return 'high'
    if (urgent || !hasPlan) return 'medium'
    return 'low'
  }

  // Current seats at OPEN locations, and everyone's origin (person → their seat).
  type A = {
    position_id: string | null
    person: { id: string; full_name: string; status: string } | null
    location: { id: string; status: string } | null
  }
  type CellPerson = { id: string; name: string; incoming: boolean }
  const curByCell = new Map<string, CellPerson[]>()
  // Incoming/active external hires assigned to an OPENING site — they belong on
  // that site's future roster alongside slated leaders (unioned + de-duped by
  // person below), so the "add incoming hire" flow works for upcoming sites.
  const openingAsgByCell = new Map<string, CellPerson[]>()
  for (const a of (assignRes.data as unknown as A[]) ?? []) {
    if (!a.position_id || !a.location || !a.person) continue
    const k = key(a.location.id, a.position_id)
    const st = a.person.status
    if (st !== 'incoming' && st !== 'active' && st !== 'leave') continue
    const cell = a.location.status === 'open' ? curByCell : a.location.status === 'opening' ? openingAsgByCell : null
    if (!cell) continue
    const arr = cell.get(k) ?? []
    arr.push({ id: a.person.id, name: a.person.full_name, incoming: st === 'incoming' })
    cell.set(k, arr)
  }

  // Slated leaders at OPENING locations → the future fill there, and the set of
  // people moving (person → destination) that drives backfill at their origin.
  type S = {
    position_id: string | null
    incumbent_person_id: string | null
    incumbent: { full_name: string; status: string } | null
    location: { id: string; name: string; status: string } | null
    candidates: { rank: number; people: { full_name: string } | null }[] | null
  }
  const slatedByCell = new Map<string, CellPerson[]>()
  const moverDest = new Map<string, string>()
  // Ranked successors per seat — a PLAN for the seat, never counted as fill.
  // RLS keeps candidates executive/admin-only; other viewers just get none.
  const benchByCell = new Map<string, { rank: number; name: string }[]>()
  for (const s of (slotRes.data as unknown as S[]) ?? []) {
    if (!s.position_id || !s.location) continue
    const k = key(s.location.id, s.position_id)
    for (const c of s.candidates ?? []) {
      if (!c.people?.full_name) continue
      const arr = benchByCell.get(k) ?? []
      arr.push({ rank: c.rank, name: c.people.full_name })
      benchByCell.set(k, arr)
    }
    if (s.location.status !== 'opening') continue
    if (!s.incumbent_person_id || !s.incumbent) continue
    const arr = slatedByCell.get(k) ?? []
    arr.push({ id: s.incumbent_person_id, name: s.incumbent.full_name, incoming: s.incumbent.status === 'incoming' })
    slatedByCell.set(k, arr)
    moverDest.set(s.incumbent_person_id, s.location.name)
  }
  const benchFor = (locId: string, posIds: string[]): string[] =>
    posIds
      .flatMap((p) => benchByCell.get(key(locId, p)) ?? [])
      .sort((a, b) => a.rank - b.rank)
      .map((c) => `${c.name} (#${c.rank})`)

  // Everyone attached to one (location, position): open → current staff minus
  // movers; opening → slated ∪ assigned hires, de-duped by person. Shared by
  // the single-role rows and the group evaluation. The incoming flag marks
  // hires who haven't started; whether they count is includeIncoming's call.
  const cellPeople = (loc: GapLocation, positionId: string): CellPerson[] => {
    const k = key(loc.id, positionId)
    if (loc.status === 'opening') {
      const byId = new Map<string, CellPerson>()
      for (const p of slatedByCell.get(k) ?? []) byId.set(p.id, p)
      for (const p of openingAsgByCell.get(k) ?? []) if (!byId.has(p.id)) byId.set(p.id, p)
      return [...byId.values()]
    }
    return (curByCell.get(k) ?? []).filter((p) => !moverDest.has(p.id))
  }
  const projectedFill = (loc: GapLocation, positionId: string): number =>
    cellPeople(loc, positionId).filter((p) => includeIncoming || !p.incoming).length

  const out: CompanyGap[] = []
  for (const loc of locs) {
    // Effective roster for THIS location: global defaults overlaid with the
    // location's own overrides (most-specific wins). A role owned by a pool is
    // not also counted as a single role, so we don't double-count.
    const locGroups = resolveGroupRequirements(groups, loc.id)
    const memberPos = new Set<string>()
    for (const g of locGroups) for (const r of g.roles) memberPos.add(r.position_id)
    const required = resolveSingleRequirements(reqs, loc.id).filter(
      (r) => r.required_count > 0 && !memberPos.has(r.position_id),
    )

    for (const r of required) {
      const people = cellPeople(loc, r.position_id)
      const projected = people.filter((p) => includeIncoming || !p.incoming).length
      const gap = Math.max(0, r.required_count - projected)
      if (gap <= 0) continue
      const incomingNames = people.filter((p) => p.incoming).map((p) => p.name)
      const benchNames = benchFor(loc.id, [r.position_id])
      const hasPlan = incomingNames.length > 0 || benchNames.length > 0
      if (loc.status === 'opening') {
        const named = people.filter((p) => !p.incoming).map((p) => p.name)
        const neededBy = deadlineByName.get(norm(loc.name)) ?? null
        out.push({
          location_id: loc.id,
          location_name: loc.name,
          location_status: 'opening',
          kind: 'role',
          position_id: r.position_id,
          position_name: r.position_name,
          level: r.level,
          required: r.required_count,
          projected,
          gap,
          reason: 'new-site',
          detail: named.length ? `named: ${named.join(', ')}` : '',
          incoming_names: incomingNames,
          bench_names: benchNames,
          needed_by: neededBy,
          priority: priorityFor(neededBy, r.level, hasPlan),
        })
      } else {
        const k = key(loc.id, r.position_id)
        const movers = (curByCell.get(k) ?? []).filter((p) => moverDest.has(p.id))
        // Backfill deadline = the earliest destination's staffing deadline —
        // the seat opens the day its holder leaves. Understaffed = now (null).
        const neededBy =
          movers
            .map((m) => deadlineByName.get(norm(moverDest.get(m.id) ?? '')))
            .filter((d): d is string => Boolean(d))
            .sort()[0] ?? null
        out.push({
          location_id: loc.id,
          location_name: loc.name,
          location_status: 'open',
          kind: 'role',
          position_id: r.position_id,
          position_name: r.position_name,
          level: r.level,
          required: r.required_count,
          projected,
          gap,
          reason: movers.length > 0 ? 'backfill' : 'understaffed',
          detail: movers.map((m) => `${m.name} → ${moverDest.get(m.id)}`).join(', '),
          incoming_names: incomingNames,
          bench_names: benchNames,
          needed_by: neededBy,
          priority: priorityFor(neededBy, r.level, hasPlan),
        })
      }
    }

    // Pooled group requirements for this location.
    for (const g of locGroups) {
      if (g.roles.length === 0) continue
      const filledByPos = new Map<string, number>()
      const incomingNames: string[] = []
      for (const gr of g.roles) {
        filledByPos.set(gr.position_id, projectedFill(loc, gr.position_id))
        for (const p of cellPeople(loc, gr.position_id)) if (p.incoming) incomingNames.push(p.name)
      }
      const { gap, filledTotal, detail } = groupGap(g, filledByPos)
      if (gap > 0) {
        const benchNames = benchFor(loc.id, g.roles.map((r) => r.position_id))
        const hasPlan = incomingNames.length > 0 || benchNames.length > 0
        const neededBy = loc.status === 'opening' ? deadlineByName.get(norm(loc.name)) ?? null : null
        const level = Math.min(...g.roles.map((r) => r.level ?? Infinity))
        out.push({
          location_id: loc.id,
          location_name: loc.name,
          location_status: loc.status === 'opening' ? 'opening' : 'open',
          kind: 'group',
          position_id: g.id,
          position_name: g.name,
          member_position_ids: g.roles.map((r) => r.position_id),
          overrides_group_id: g.overrides_group_id,
          level,
          required: g.total_min,
          projected: filledTotal,
          gap,
          reason: loc.status === 'opening' ? 'new-site' : 'understaffed',
          detail,
          incoming_names: incomingNames,
          bench_names: benchNames,
          needed_by: neededBy,
          priority: priorityFor(neededBy, Number.isFinite(level) ? level : null, hasPlan),
        })
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
  count: number // started people: active or on leave
  names: string[]
  // Named hires who haven't started yet — a "maybe" until their start date.
  // Callers decide whether they count (the gap view's Exclude incoming toggle).
  incomingCount: number
  incomingNames: string[]
}

export const EMPTY_FILL: Fill = { count: 0, names: [], incomingCount: 0, incomingNames: [] }

/** Who fills each role at a location. Open site → people currently assigned
 * there (started people and incoming hires tracked separately); opening site →
 * slated leaders (succession incumbents) plus assigned hires. Keyed by
 * position_id. */
export async function fetchFillForLocation(
  locationId: string,
  upcoming: boolean,
): Promise<Map<string, Fill>> {
  const map = new Map<string, Fill>()
  const add = (positionId: string | null, name: string | null, incoming: boolean) => {
    if (!positionId) return
    const f = map.get(positionId) ?? { count: 0, names: [], incomingCount: 0, incomingNames: [] }
    if (incoming) {
      f.incomingCount += 1
      if (name) f.incomingNames.push(name)
    } else {
      f.count += 1
      if (name) f.names.push(name)
    }
    map.set(positionId, f)
  }

  if (upcoming) {
    // Opening-site roster = slated leaders (succession incumbents) UNION
    // incoming/active external hires assigned to the site (the "add incoming
    // hire" flow), de-duped by person so someone both slated and assigned
    // counts once. Before opening, the whole roster is a future fill, so an
    // incoming hire assigned here belongs on it just like a slated leader.
    const seen = new Map<string, Set<string>>() // position_id -> person ids
    const addUnique = (
      positionId: string | null,
      personId: string | null,
      name: string | null,
      incoming: boolean,
    ) => {
      if (!positionId || !personId) return
      const s = seen.get(positionId) ?? new Set<string>()
      if (s.has(personId)) return
      s.add(personId)
      seen.set(positionId, s)
      add(positionId, name, incoming)
    }
    const [slotRes, asgRes] = await Promise.all([
      supabase
        .from('people_center_succession_slots')
        .select(
          `position_id,
           incumbent:people_center_people!people_center_succession_slots_incumbent_person_id_fkey ( id, full_name, status )`,
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
    type SlotRow = {
      position_id: string | null
      incumbent: { id: string; full_name: string; status: string } | null
    }
    for (const r of (slotRes.data as unknown as SlotRow[]) ?? []) {
      if (r.incumbent?.id)
        addUnique(r.position_id, r.incumbent.id, r.incumbent.full_name, r.incumbent.status === 'incoming')
    }
    type AsgRow = {
      position_id: string | null
      person: { id: string; full_name: string; status: string } | null
    }
    for (const r of (asgRes.data as unknown as AsgRow[]) ?? []) {
      const st = r.person?.status
      if (r.person && (st === 'incoming' || st === 'active' || st === 'leave')) {
        addUnique(r.position_id, r.person.id, r.person.full_name, st === 'incoming')
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
    // the two views never disagree). Started people (active/leave) fill the
    // seat; incoming hires are tracked separately as maybes.
    if (!r.person) continue
    const st = r.person.status
    if (st === 'active' || st === 'leave') add(r.position_id, r.person.full_name, false)
    else if (st === 'incoming') add(r.position_id, r.person.full_name, true)
  }
  return map
}

/** Ranked succession candidates for each seat at a location, keyed by
 * position_id — names like "Dinesh Tirumalasetti (#1)". A plan for the seat,
 * never counted as fill. RLS keeps candidates executive/admin-only; other
 * viewers simply get an empty map. */
export async function fetchBenchForLocation(locationId: string): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from('people_center_succession_slots')
    .select(
      `position_id,
       candidates:people_center_succession_candidates ( rank, people:people_center_people ( full_name ) )`,
    )
    .eq('location_id', locationId)
  if (error) throw error
  type Row = {
    position_id: string | null
    candidates: { rank: number; people: { full_name: string } | null }[] | null
  }
  const byPos = new Map<string, { rank: number; name: string }[]>()
  for (const r of (data as unknown as Row[]) ?? []) {
    if (!r.position_id) continue
    const arr = byPos.get(r.position_id) ?? []
    for (const c of r.candidates ?? []) {
      if (c.people?.full_name) arr.push({ rank: c.rank, name: c.people.full_name })
    }
    if (arr.length > 0) byPos.set(r.position_id, arr)
  }
  const map = new Map<string, string[]>()
  for (const [pos, arr] of byPos) {
    map.set(pos, arr.sort((a, b) => a.rank - b.rank).map((c) => `${c.name} (#${c.rank})`))
  }
  return map
}

// --- Current roster overlay --------------------------------------------------

export interface RosterPerson {
  name: string
  incoming: boolean // named hire who hasn't started yet
  movingTo: string | null // slated to an upcoming site — leaving opens this seat
}

/** Everyone at a location for the roster overlay, keyed by position_id. Open
 * site → current primary assignments (started people and incoming hires), each
 * flagged when slated to move to an upcoming site (the knock-on backfill).
 * Opening site → slated leaders ∪ assigned hires, like fetchFillForLocation. */
export async function fetchLocationRoster(
  locationId: string,
  upcoming: boolean,
): Promise<Map<string, RosterPerson[]>> {
  const map = new Map<string, RosterPerson[]>()
  const add = (positionId: string | null, p: RosterPerson) => {
    if (!positionId) return
    const arr = map.get(positionId) ?? []
    arr.push(p)
    map.set(positionId, arr)
  }

  if (upcoming) {
    const seen = new Map<string, Set<string>>() // position_id -> person ids
    const addUnique = (
      positionId: string | null,
      personId: string | null,
      name: string | null,
      incoming: boolean,
    ) => {
      if (!positionId || !personId || !name) return
      const s = seen.get(positionId) ?? new Set<string>()
      if (s.has(personId)) return
      s.add(personId)
      seen.set(positionId, s)
      add(positionId, { name, incoming, movingTo: null })
    }
    const [slotRes, asgRes] = await Promise.all([
      supabase
        .from('people_center_succession_slots')
        .select(
          `position_id,
           incumbent:people_center_people!people_center_succession_slots_incumbent_person_id_fkey ( id, full_name, status )`,
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
    type SlotRow = {
      position_id: string | null
      incumbent: { id: string; full_name: string; status: string } | null
    }
    for (const r of (slotRes.data as unknown as SlotRow[]) ?? []) {
      if (r.incumbent?.id)
        addUnique(r.position_id, r.incumbent.id, r.incumbent.full_name, r.incumbent.status === 'incoming')
    }
    type AsgRow = {
      position_id: string | null
      person: { id: string; full_name: string; status: string } | null
    }
    for (const r of (asgRes.data as unknown as AsgRow[]) ?? []) {
      const st = r.person?.status
      if (r.person && (st === 'incoming' || st === 'active' || st === 'leave')) {
        addUnique(r.position_id, r.person.id, r.person.full_name, st === 'incoming')
      }
    }
    return map
  }

  const { data, error } = await supabase
    .from('people_center_position_assignments')
    .select(`position_id, ended_on, person:people_center_people ( id, full_name, status )`)
    .eq('location_id', locationId)
    .eq('is_primary', true)
    .is('ended_on', null)
  if (error) throw error
  type Row = {
    position_id: string | null
    person: { id: string; full_name: string; status: string } | null
  }
  const rows = ((data as unknown as Row[]) ?? []).filter(
    (r) => r.person && ['active', 'leave', 'incoming'].includes(r.person.status),
  )

  // Who among them is slated to an upcoming site — their move opens this seat.
  const movingTo = new Map<string, string>()
  const ids = rows.map((r) => r.person!.id)
  if (ids.length > 0) {
    const { data: slots, error: e2 } = await supabase
      .from('people_center_succession_slots')
      .select(`incumbent_person_id, location:people_center_locations ( name, status )`)
      .in('incumbent_person_id', ids)
    if (e2) throw e2
    type SlotRow = {
      incumbent_person_id: string | null
      location: { name: string; status: string } | null
    }
    for (const s of (slots as unknown as SlotRow[]) ?? []) {
      if (s.incumbent_person_id && s.location?.status === 'opening')
        movingTo.set(s.incumbent_person_id, s.location.name)
    }
  }

  for (const r of rows) {
    add(r.position_id, {
      name: r.person!.full_name,
      incoming: r.person!.status === 'incoming',
      movingTo: movingTo.get(r.person!.id) ?? null,
    })
  }
  return map
}

// --- Gap seat assignments: per-seat owner/support + target date --------------
// Menu Center's launch-task owner model applied to staffing gaps: each open
// SEAT at a (location, role|pool) cell can carry an OWNER (who is responsible
// for filling it), a SUPPORT person, a target date, and a note. Owners are a
// linked person plus a name snapshot (free text stays possible for outside
// parties). Gaps stay derived — these rows only annotate them; when a cell's
// gap closes, its assignments simply stop matching a live gap.

export interface GapAssignment {
  id: string
  location_id: string
  position_id: string | null // role gaps: the position id
  group_name: string | null // pool gaps: the pool NAME (ids get recreated; names survive)
  seat_index: number
  owner_person_id: string | null
  owner_name: string
  support_person_id: string | null
  support_name: string
  target_date: string | null
  note: string
}

/** One cell = one (location, role|pool). Role cells key on the position id,
 * pool cells on the pool's lower-cased name — matching the DB's unique
 * indexes, so a recreated pool keeps its assignments. */
export function assignmentCellKey(
  locationId: string,
  kind: 'role' | 'group',
  positionIdOrGroupName: string,
): string {
  return `${locationId}|${kind}|${positionIdOrGroupName.toLowerCase()}`
}

export function cellKeyForGap(g: CompanyGap): string {
  return assignmentCellKey(g.location_id, g.kind, g.kind === 'role' ? g.position_id : g.position_name)
}

/** All assignments, grouped per cell and ordered by seat. RLS scopes what
 * comes back: gap viewers see everything, everyone else only their own rows
 * (owner or support) — which is exactly what My Tasks needs. */
export async function fetchGapAssignments(): Promise<Map<string, GapAssignment[]>> {
  const { data, error } = await supabase
    .from('people_center_gap_assignments')
    .select(
      'id, location_id, position_id, group_name, seat_index, owner_person_id, owner_name, support_person_id, support_name, target_date, note',
    )
  if (error) throw error
  const map = new Map<string, GapAssignment[]>()
  for (const a of ((data as unknown as GapAssignment[]) ?? [])) {
    const k = a.position_id
      ? assignmentCellKey(a.location_id, 'role', a.position_id)
      : assignmentCellKey(a.location_id, 'group', a.group_name ?? '')
    const arr = map.get(k) ?? []
    arr.push(a)
    map.set(k, arr)
  }
  for (const arr of map.values()) arr.sort((a, b) => a.seat_index - b.seat_index)
  return map
}

export interface GapAssignmentInput {
  id?: string // set = update this row; unset = create
  locationId: string
  positionId: string | null
  groupName: string | null
  seatIndex: number
  ownerPersonId: string | null
  ownerName: string
  supportPersonId: string | null
  supportName: string
  targetDate: string | null
  note: string
}

export async function saveGapAssignment(
  actor: Actor,
  input: GapAssignmentInput,
  label: string, // "Sous Chef — Beertown Peterborough (seat 2)" for the audit trail
): Promise<void> {
  const row = {
    location_id: input.locationId,
    position_id: input.positionId,
    group_name: input.groupName,
    seat_index: input.seatIndex,
    owner_person_id: input.ownerPersonId,
    owner_name: input.ownerName,
    support_person_id: input.supportPersonId,
    support_name: input.supportName,
    target_date: input.targetDate,
    note: input.note,
    updated_at: new Date().toISOString(),
    updated_by: actor.personId,
    updated_by_name: actor.name,
  }
  let id = input.id ?? null
  if (id) {
    const { error } = await supabase.from('people_center_gap_assignments').update(row).eq('id', id)
    if (error) throw error
  } else {
    const { data, error } = await supabase
      .from('people_center_gap_assignments')
      .insert(row)
      .select('id')
    if (error) throw error
    id = (data?.[0] as { id: string } | undefined)?.id ?? null
  }
  const who = [input.ownerName && `owner ${input.ownerName}`, input.supportName && `support ${input.supportName}`]
    .filter(Boolean)
    .join(', ')
  await recordAudit(
    actor,
    input.id ? 'update' : 'create',
    'gap_assignment',
    id,
    label,
    `${label}: ${who || 'no owner'}${input.targetDate ? `, target ${input.targetDate}` : ''}`,
  )
}

export async function deleteGapAssignment(actor: Actor, id: string, label: string): Promise<void> {
  const { error } = await supabase.from('people_center_gap_assignments').delete().eq('id', id)
  if (error) throw error
  await recordAudit(actor, 'delete', 'gap_assignment', id, label, `Cleared seat assignment: ${label}`)
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
