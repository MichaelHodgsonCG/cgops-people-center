// Covered-locations picker data access. Manages people_center_user_scopes
// (bespoke coverage grants) and computes each user's EFFECTIVE coverage so an
// admin/executive can see — and understand the derivation of — why a person
// can see a given location. RLS is the enforcement layer (scopes are
// admin/executive-manageable, migration 20260724150000); this module mirrors
// the same model the database uses (people_center_my_coverage +
// people_center_covers_location): region-derived default ∪ scope grants, with
// can_view_all short-circuiting to everything.

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
}

export interface ScopeGrant {
  id: string
  auth_user_id: string
  region_id: string | null
  location_id: string | null
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
    .select('id, name, status, region_id')
    .order('name')
  if (error) throw error
  return (data as CoverageLocation[]) ?? []
}

export async function fetchScopes(authUserId: string): Promise<ScopeGrant[]> {
  const { data, error } = await supabase
    .from('people_center_user_scopes')
    .select('id, auth_user_id, region_id, location_id')
    .eq('auth_user_id', authUserId)
  if (error) throw error
  return (data as ScopeGrant[]) ?? []
}

export async function addScope(
  actor: Actor,
  user: ScopeUser,
  grant: { regionId?: string; locationId?: string },
  label: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_user_scopes')
    .insert({
      auth_user_id: user.auth_user_id,
      region_id: grant.regionId ?? null,
      location_id: grant.locationId ?? null,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('The database did not accept this grant (admin/executive only).')
  }
  await recordAudit(actor, 'create', 'user_scope', data[0].id, user.email, `Granted ${label}`)
}

export async function removeScope(
  actor: Actor,
  scopeId: string,
  userEmail: string,
  label: string,
): Promise<void> {
  const { error } = await supabase
    .from('people_center_user_scopes')
    .delete()
    .eq('id', scopeId)
  if (error) throw error
  await recordAudit(actor, 'delete', 'user_scope', scopeId, userEmail, `Removed ${label}`)
}
