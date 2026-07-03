// Write-side discipline for the two append-only streams (ADR 0003):
// audit_log is the COMPLIANCE record (every mutation; sensitive reads are
// audited inside the database functions, not here); events is the DOMAIN
// record (business-meaningful moments, pointers only — never note content,
// and never anything for relationship/restricted material).

import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { UserProfile } from '../types'

export interface Actor {
  personId: string | null
  authUid: string | null
  name: string
}

export function actorFrom(profile: UserProfile | null, session: Session | null): Actor {
  return {
    personId: profile?.person_id ?? null,
    authUid: session?.user.id ?? null,
    name:
      profile?.display_name ?? profile?.email ?? session?.user.email ?? 'unknown',
  }
}

export async function recordAudit(
  actor: Actor,
  action: 'create' | 'update' | 'delete',
  entityType: string,
  entityId: string | null,
  entityLabel: string | null,
  summary: string,
): Promise<void> {
  const { error } = await supabase.from('people_center_audit_log').insert({
    actor_person_id: actor.personId,
    actor_auth_uid: actor.authUid,
    actor_name: actor.name,
    action,
    entity_type: entityType,
    entity_id: entityId,
    entity_label: entityLabel,
    summary,
  })
  if (error) console.error('audit write failed:', error.message)
}

export async function recordEvent(
  actor: Actor,
  eventType: string,
  personId: string | null,
  entityType: string | null,
  entityId: string | null,
  context: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.from('people_center_events').insert({
    event_type: eventType,
    person_id: personId,
    actor_person_id: actor.personId,
    entity_type: entityType,
    entity_id: entityId,
    context,
  })
  if (error) console.error('event write failed:', error.message)
}
