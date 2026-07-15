// Positions curation — the People Center side of the CGOPS position vocabulary
// (ADR 0012). CGOPS Operational Center → Positions is the master for the
// shared fields; People Center owns which positions it offers
// (show_in_people_center), whether they make a person People-Center population
// (people_center_eligible), and what kind an imported holder becomes
// (default_person_kind). Sync pulls from CGOPS; it never writes back.

import { supabase } from '../../lib/supabase'

export interface PositionAdminRow {
  id: string
  name: string
  people_center_eligible: boolean
  default_person_kind: 'manager' | 'emerging_leader' | 'key_team_member'
  show_in_people_center: boolean
  external_ref: string | null
}

export async function fetchPositionsAdmin(): Promise<PositionAdminRow[]> {
  const { data, error } = await supabase
    .from('people_center_positions')
    .select(
      'id, name, people_center_eligible, default_person_kind, show_in_people_center, external_ref',
    )
    .order('show_in_people_center', { ascending: false })
    .order('name')
  if (error) throw error
  return (data as PositionAdminRow[]) ?? []
}

type PositionConfig = Partial<
  Pick<
    PositionAdminRow,
    'people_center_eligible' | 'default_person_kind' | 'show_in_people_center'
  >
>

const BLOCKED =
  'The database did not accept this change — position config is admin-only.'

export async function updatePositionConfig(
  id: string,
  patch: PositionConfig,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_positions')
    .update(patch)
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error(BLOCKED)
}

export interface PositionSyncResult {
  created: number
  updated: number
  linked: number
}

/** Pull the CGOPS position master into People Center (ADR 0012). New CGOPS
 * positions land hidden + ineligible; an admin curates them here. */
export async function syncPositionsFromCgops(): Promise<PositionSyncResult> {
  const { data, error } = await supabase.rpc('people_center_sync_positions_from_cgops')
  if (error) throw error
  return data as PositionSyncResult
}
