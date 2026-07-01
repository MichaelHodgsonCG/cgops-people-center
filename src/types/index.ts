// Domain types mirroring the Phase 0 schema (see supabase/migrations).

export const APP_ROLES = [
  'admin',
  'executive',
  'regional_leader',
  'location_leader',
  'viewer',
] as const

export type AppRole = (typeof APP_ROLES)[number]

export interface UserProfile {
  id: string
  auth_user_id: string
  email: string
  display_name: string | null
  role: AppRole
  person_id: string | null
  created_at: string
  updated_at: string
  updated_by: string | null
  updated_by_name: string | null
}

export interface UserScope {
  id: string
  auth_user_id: string
  region_id: string | null
  location_id: string | null
}

export type AuditAction = 'create' | 'update' | 'delete' | 'view'

export interface AuditLogEntry {
  id: string
  actor_person_id: string | null
  actor_auth_uid: string | null
  actor_name: string
  action: AuditAction
  entity_type: string
  entity_id: string | null
  entity_label: string | null
  summary: string | null
  created_at: string
}

export interface AppEvent {
  id: string
  event_type: string
  person_id: string | null
  actor_person_id: string | null
  entity_type: string | null
  entity_id: string | null
  context: Record<string, unknown>
  created_at: string
}
