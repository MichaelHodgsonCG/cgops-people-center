// Team Member hiring — Phase 1 data access (work order a1164da2). Reads the
// hiring record the public edge function writes; never touches the public
// path itself. RLS scopes rows to admin/executive plus the configured
// reviewer for each position (people_center_hiring_reviewers — the reviewer
// is DATA, per Michael's ruling). An applicant is NOT a person: nothing here
// joins people_center_people except to pick reviewers.

import { supabase } from '../../lib/supabase'
import { recordAudit, type Actor } from '../../lib/activity'

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'screening'
  | 'interview'
  | 'reference_check'
  | 'decision_pending'
  | 'hired'
  | 'not_hired'
  | 'withdrawn'

export const STATUS_FLOW: ApplicationStatus[] = [
  'submitted',
  'screening',
  'interview',
  'reference_check',
  'decision_pending',
  'hired',
  'not_hired',
  'withdrawn',
]

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  draft: 'Draft (incomplete)',
  submitted: 'Submitted',
  screening: 'Screening',
  interview: 'Interview',
  reference_check: 'Reference check',
  decision_pending: 'Decision pending',
  hired: 'Hired',
  not_hired: 'Not hired',
  withdrawn: 'Withdrawn',
}

export interface ApplicationRow {
  id: string
  applicant_id: string
  location_name: string
  desired_position: string
  source: string
  status: ApplicationStatus
  complete: boolean
  submitted_at: string
  retention_purge_after: string
  form: Record<string, unknown>
  applicant: { full_name: string; email: string | null; phone: string | null } | null
}

export async function fetchApplications(): Promise<ApplicationRow[]> {
  const { data, error } = await supabase
    .from('people_center_applications')
    .select(
      `id, applicant_id, location_name, desired_position, source, status, complete,
       submitted_at, retention_purge_after, form,
       applicant:people_center_applicants ( full_name, email, phone )`,
    )
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return ((data as unknown as ApplicationRow[]) ?? [])
}

export interface ApplicationAck {
  doc: string
  acknowledged_at: string
}

export interface ApplicationEvent {
  event: string
  actor_name: string
  detail: string
  created_at: string
}

export async function fetchApplicationDetail(
  applicationId: string,
): Promise<{ acks: ApplicationAck[]; events: ApplicationEvent[] }> {
  const [acks, events] = await Promise.all([
    supabase
      .from('people_center_application_acks')
      .select('doc, acknowledged_at')
      .eq('application_id', applicationId),
    supabase
      .from('people_center_application_events')
      .select('event, actor_name, detail, created_at')
      .eq('application_id', applicationId)
      .order('created_at'),
  ])
  if (acks.error) throw acks.error
  if (events.error) throw events.error
  return {
    acks: (acks.data as ApplicationAck[]) ?? [],
    events: (events.data as ApplicationEvent[]) ?? [],
  }
}

/** How many OTHER applications this applicant has on file — surfaced to the
 * hiring manager, never acted on automatically (Michael accepted Ember's
 * pushback: prior applications inform a human, they don't screen anyone out). */
export async function fetchPriorApplications(
  applicantId: string,
  excludeApplicationId: string,
): Promise<{ id: string; location_name: string; desired_position: string; status: string; submitted_at: string }[]> {
  const { data, error } = await supabase
    .from('people_center_applications')
    .select('id, location_name, desired_position, status, submitted_at')
    .eq('applicant_id', applicantId)
    .neq('id', excludeApplicationId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return (data as { id: string; location_name: string; desired_position: string; status: string; submitted_at: string }[]) ?? []
}

export async function setApplicationStatus(
  actor: Actor,
  app: ApplicationRow,
  status: ApplicationStatus,
  note: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_applications')
    .update({
      status,
      updated_at: new Date().toISOString(),
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .eq('id', app.id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('The database did not accept this change — you are not the reviewer for this position.')
  }
  const { error: evErr } = await supabase.from('people_center_application_events').insert({
    application_id: app.id,
    event: `stage.${status}`,
    actor_person_id: actor.personId,
    actor_name: actor.name,
    detail: note,
  })
  if (evErr) throw evErr
  await recordAudit(
    actor,
    'update',
    'application',
    app.id,
    app.applicant?.full_name ?? 'applicant',
    `Application (${app.desired_position} — ${app.location_name}) → ${STATUS_LABELS[status]}${note ? `: ${note}` : ''}`,
  )
}

export interface HiringReviewer {
  position_id: string
  reviewer_person_id: string
  reviewer_name?: string
}

export async function fetchHiringReviewers(): Promise<HiringReviewer[]> {
  const { data, error } = await supabase
    .from('people_center_hiring_reviewers')
    .select('position_id, reviewer_person_id, reviewer:people_center_people ( full_name )')
  if (error) throw error
  type Row = { position_id: string; reviewer_person_id: string; reviewer: { full_name: string } | null }
  return (((data as unknown as Row[]) ?? [])).map((r) => ({
    position_id: r.position_id,
    reviewer_person_id: r.reviewer_person_id,
    reviewer_name: r.reviewer?.full_name,
  }))
}

export async function setHiringReviewer(
  actor: Actor,
  positionId: string,
  positionName: string,
  reviewerPersonId: string | null,
  reviewerName: string | null,
): Promise<void> {
  if (reviewerPersonId) {
    const { error } = await supabase.from('people_center_hiring_reviewers').upsert(
      {
        position_id: positionId,
        reviewer_person_id: reviewerPersonId,
        updated_at: new Date().toISOString(),
        updated_by: actor.personId,
        updated_by_name: actor.name,
      },
      { onConflict: 'position_id' },
    )
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('people_center_hiring_reviewers')
      .delete()
      .eq('position_id', positionId)
    if (error) throw error
  }
  await recordAudit(
    actor,
    'update',
    'hiring_reviewer',
    positionId,
    positionName,
    reviewerPersonId
      ? `Hiring reviewer for ${positionName} set to ${reviewerName ?? 'a person'}`
      : `Hiring reviewer for ${positionName} cleared`,
  )
}

export interface HiringPosition {
  id: string
  name: string
}

/** Every CGOPS position, for the reviewer settings — TM roles (Server,
 * Dishwasher, …) are not in the curated People Center set, so this reads the
 * full catalog. */
export async function fetchAllPositions(): Promise<HiringPosition[]> {
  const { data, error } = await supabase
    .from('people_center_positions')
    .select('id, name')
    .order('name')
  if (error) throw error
  return (data as HiringPosition[]) ?? []
}
