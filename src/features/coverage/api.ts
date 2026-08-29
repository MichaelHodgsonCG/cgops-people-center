// Covered-locations picker data access. Coverage is owned by People Center
// and keyed on the PERSON (ruling d98cb0cf: CGOPS owns locations, People
// Center owns people and location assignments): grants live in
// people_center_location_assignments (person_id + whole-region OR a single
// CGOPS locations.id). The legacy account-keyed people_center_user_scopes is
// read-only history — removals here clean up any matching legacy row so the
// transitional people_center_my_coverage() (which still honours legacy rows)
// can never resurrect a revoked grant.

import { supabase } from '../../lib/supabase'
import { recordAudit, type Actor } from '../../lib/activity'
import type { AppRole } from '../../types'

export interface ScopeUser {
  id: string
  auth_user_id: string
  email: string
  display_name: string | null
  role: AppRole
  person_id: string | null
  can_view_all: boolean
}

export interface Region {
  id: string
  name: string
  leader_person_id: string | null
}

export interface CoverageLocation {
  id: string
  name: string
  status: string | null
  region_id: string | null
  cgops_location_id: string | null // null = not yet mapped to CGOPS — ungrantable
}

export interface Assignment {
  id: string
  person_id: string
  region_id: string | null
  cgops_location_id: string | null
  source: string
}

export async function fetchScopeUsers(): Promise<ScopeUser[]> {
  const { data, error } = await supabase
    .from('people_center_user_profiles')
    .select('id, auth_user_id, email, display_name, role, person_id, can_view_all')
    .order('email')
  if (error) throw error
  return (data as ScopeUser[]) ?? []
}

export async function fetchRegions(): Promise<Region[]> {
  const { data, error } = await supabase
    .from('people_center_regions')
    .select('id, name, leader_person_id')
    .order('name')
  if (error) throw error
  return (data as Region[]) ?? []
}

export async function fetchCoverageLocations(): Promise<CoverageLocation[]> {
  const { data, error } = await supabase
    .from('people_center_locations')
    .select('id, name, status, region_id, cgops_location_id')
    .order('name')
  if (error) throw error
  return (data as CoverageLocation[]) ?? []
}

export async function fetchAssignments(personId: string): Promise<Assignment[]> {
  const { data, error } = await supabase
    .from('people_center_location_assignments')
    .select('id, person_id, region_id, cgops_location_id, source')
    .eq('person_id', personId)
  if (error) throw error
  return (data as Assignment[]) ?? []
}

export async function addAssignment(
  actor: Actor,
  user: ScopeUser,
  grant: { regionId?: string; cgopsLocationId?: string },
  label: string,
): Promise<void> {
  if (!user.person_id) throw new Error('This login is not linked to a person yet — link it in Users first.')
  const { data, error } = await supabase
    .from('people_center_location_assignments')
    .insert({
      person_id: user.person_id,
      region_id: grant.regionId ?? null,
      cgops_location_id: grant.cgopsLocationId ?? null,
      source: 'manual',
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('The database did not accept this grant (admin/executive only).')
  }
  await recordAudit(actor, 'create', 'location_assignment', data[0].id, user.email, `Granted ${label}`)
}

export async function removeAssignment(
  actor: Actor,
  a: Assignment,
  user: ScopeUser,
  label: string,
): Promise<void> {
  const { error } = await supabase
    .from('people_center_location_assignments')
    .delete()
    .eq('id', a.id)
  if (error) throw error
  // Clean up any matching LEGACY account-keyed scope so the transitional
  // my_coverage() can't re-grant what was just revoked.
  if (a.region_id) {
    await supabase
      .from('people_center_user_scopes')
      .delete()
      .eq('auth_user_id', user.auth_user_id)
      .eq('region_id', a.region_id)
  } else if (a.cgops_location_id) {
    const { data: pcLocs } = await supabase
      .from('people_center_locations')
      .select('id')
      .eq('cgops_location_id', a.cgops_location_id)
    const ids = ((pcLocs as { id: string }[]) ?? []).map((l) => l.id)
    if (ids.length > 0) {
      await supabase
        .from('people_center_user_scopes')
        .delete()
        .eq('auth_user_id', user.auth_user_id)
        .in('location_id', ids)
    }
  }
  await recordAudit(actor, 'delete', 'location_assignment', a.id, user.email, `Removed ${label}`)
}

export interface CoverageException {
  email: string
  display_name: string | null
  person_id: string | null
  reason: string
}

/** Fail-closed, made visible: logins that resolve to NO coverage (or aren't
 * linked to a person). Admin/executive callers only — others get zero rows. */
export async function fetchCoverageExceptions(): Promise<CoverageException[]> {
  const { data, error } = await supabase.rpc('people_center_coverage_exceptions')
  if (error) throw error
  return (data as CoverageException[]) ?? []
}
