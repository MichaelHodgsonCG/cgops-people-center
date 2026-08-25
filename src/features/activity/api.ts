// Activity Log (admin-only): a viewer over people_center_audit_log — the
// append-only compliance record (ADR 0003). Every mutation lands here via
// recordAudit, and sensitive reads (restricted/relationship notes) are
// audited inside the database functions. RLS already restricts SELECT to
// admins (people_center_is_admin); this api adds paging + filters only.

import { supabase } from '../../lib/supabase'

export interface AuditRow {
  id: string
  actor_name: string
  action: 'create' | 'update' | 'delete' | 'view'
  entity_type: string
  entity_label: string | null
  summary: string | null
  created_at: string
}

export interface AuditFilter {
  action: string // '' = all
  actor: string // ilike match on actor_name
  entityType: string // ilike match on entity_type
  search: string // ilike match on summary or entity_label
}

export const EMPTY_FILTER: AuditFilter = { action: '', actor: '', entityType: '', search: '' }

export const PAGE_SIZE = 50

/** One page of the audit log, newest first. Fetches one row beyond the page
 * to know whether a next page exists. */
export async function fetchAuditPage(
  filter: AuditFilter,
  offset: number,
): Promise<{ rows: AuditRow[]; hasMore: boolean }> {
  let q = supabase
    .from('people_center_audit_log')
    .select('id, actor_name, action, entity_type, entity_label, summary, created_at')
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE) // inclusive → PAGE_SIZE + 1 rows
  if (filter.action) q = q.eq('action', filter.action)
  if (filter.actor.trim()) q = q.ilike('actor_name', `%${filter.actor.trim()}%`)
  if (filter.entityType.trim()) q = q.ilike('entity_type', `%${filter.entityType.trim()}%`)
  if (filter.search.trim()) {
    // PostgREST or() syntax: commas separate conditions; strip characters
    // that would break the expression rather than trying to escape them.
    const s = filter.search.trim().replace(/[,()]/g, ' ')
    q = q.or(`summary.ilike.%${s}%,entity_label.ilike.%${s}%`)
  }
  const { data, error } = await q
  if (error) throw error
  const rows = ((data as unknown as AuditRow[]) ?? [])
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE }
}
