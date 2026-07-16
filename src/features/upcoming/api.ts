// Upcoming-locations planning data (Phase 2). We do NOT store a separate plan:
// the upcoming restaurants already exist in people_center_locations
// (status='opening') and the Bench/succession model already plots slated
// leaders into them. This reads those succession seats so the Upcoming view can
// REFLECT the plan (read-only) next to the opening dates. Editing stays in the
// Bench — one source of truth. Succession rows are admin/executive-only (RLS),
// so non-privileged callers get an empty list.

import { supabase } from '../../lib/supabase'

export interface UpcomingSeat {
  id: string
  location_name: string | null
  position_name: string | null
  position_level: number | null
  incumbent_name: string | null
}

interface RawSeat {
  id: string
  positions: { name: string; level: number | null } | null
  locations: { name: string; status: string | null } | null
  incumbent: { full_name: string } | null
}

/** Succession seats at locations that are still opening (the upcoming sites).
 * Same table + embeds the Bench uses, filtered to status='opening'. */
export async function fetchUpcomingSeats(): Promise<UpcomingSeat[]> {
  const { data, error } = await supabase
    .from('people_center_succession_slots')
    .select(
      `id, position_id, location_id,
       positions:people_center_positions ( name, level ),
       locations:people_center_locations ( name, status ),
       incumbent:people_center_people!people_center_succession_slots_incumbent_person_id_fkey ( full_name )`,
    )
  if (error) throw error
  return ((data as unknown as RawSeat[]) ?? [])
    .filter((r) => r.locations?.status === 'opening')
    .map((r) => ({
      id: r.id,
      location_name: r.locations?.name ?? null,
      position_name: r.positions?.name ?? null,
      position_level: r.positions?.level ?? null,
      incumbent_name: r.incumbent?.full_name ?? null,
    }))
}
