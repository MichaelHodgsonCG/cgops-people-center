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
  // management flow stages (Michael's direction, 2026-09-03)
  | 'culture_interview'
  | 'financial_interview'
  | 'tais'
  | 'final_interview'
  | 'approvals'
  | 'offer'

export type ApplicationFlow = 'tm' | 'mgmt'
export type MgmtTrack = 'foh' | 'boh'

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

export const MGMT_STATUS_FLOW: ApplicationStatus[] = [
  'submitted',
  'screening',
  'culture_interview',
  'reference_check',
  'financial_interview',
  'tais',
  'final_interview',
  'approvals',
  'offer',
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
  culture_interview: 'Culture interview',
  financial_interview: 'Financial interview',
  tais: 'TAIS',
  final_interview: 'Final interview',
  approvals: 'Approvals',
  offer: 'Offer',
}

export interface ApplicationRow {
  id: string
  applicant_id: string
  location_name: string
  desired_position: string
  source: string
  flow: ApplicationFlow
  track: MgmtTrack | null
  status: ApplicationStatus
  complete: boolean
  submitted_at: string
  updated_at: string
  retention_purge_after: string
  form: Record<string, unknown>
  applicant: { full_name: string; email: string | null; phone: string | null } | null
}

export async function fetchApplications(): Promise<ApplicationRow[]> {
  const { data, error } = await supabase
    .from('people_center_applications')
    .select(
      `id, applicant_id, location_name, desired_position, source, flow, track, status, complete,
       submitted_at, updated_at, retention_purge_after, form,
       applicant:people_center_applicants ( full_name, email, phone )`,
    )
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return ((data as unknown as ApplicationRow[]) ?? [])
}

// --- Pipeline presentation ---------------------------------------------------
// The application's path through the TM hiring process, shown as a phase
// tracker (pattern borrowed from Michael's roadmap boards: stages, a live
// status chip, updated-ago with a stale flag, and the next action).

export const PIPELINE_STAGES: ApplicationStatus[] = [
  'submitted',
  'screening',
  'interview',
  'reference_check',
  'decision_pending',
]

export const MGMT_PIPELINE_STAGES: ApplicationStatus[] = [
  'submitted',
  'screening',
  'culture_interview',
  'reference_check',
  'financial_interview',
  'tais',
  'final_interview',
  'approvals',
  'offer',
]

export const TERMINAL_STATUSES: ApplicationStatus[] = ['hired', 'not_hired', 'withdrawn']

export const pipelineFor = (app: ApplicationRow): ApplicationStatus[] =>
  app.flow === 'mgmt' ? MGMT_PIPELINE_STAGES : PIPELINE_STAGES

export const statusFlowFor = (app: ApplicationRow): ApplicationStatus[] =>
  app.flow === 'mgmt' ? MGMT_STATUS_FLOW : STATUS_FLOW

/** What moves this application forward, per stage — straight from the CG
 * hiring process (TM) and the Mgmt Interview Process + Michael's approval
 * ruling (mgmt). */
export const NEXT_ACTION: Partial<Record<ApplicationStatus, string>> = {
  submitted: 'Screen the application — review the answers, prior applications and any watch-list flag, then move to Screening.',
  screening: 'If they look right, contact the applicant and book the patterned interview.',
  interview: 'Record the patterned interview below, then move to Reference check.',
  reference_check: 'Complete at least 2 positive reference checks — record each call in the form below — then move to Decision pending.',
  decision_pending: 'Make the decision and communicate it to the applicant within one week.',
}

export const MGMT_NEXT_ACTION: Partial<Record<ApplicationStatus, string>> = {
  submitted: 'Review the application and any watch-list flag, then move to Screening — whoever contacts the applicant runs the screening questions.',
  screening: 'Run the screening call and record the answers below (Chef Screening Questions for BOH). If it goes well, move to Culture interview.',
  culture_interview: 'Run Step 1 — the Culture/Values Interview (guide in Mgmt Hiring). This or the financial interview must happen in person. Record notes, then request 3 professional references.',
  reference_check: 'Step 2 — minimum 2 POSITIVE references, at least 1 self-sourced; search the candidate online. Record each call in the form below, then move on.',
  financial_interview: 'Step 3 — send the Gourmet Haven case study + P&L in advance; use the tier for the role (GSM/SM/Sous · BM/AGM · GM/CDC) and record the interview below.',
  tais: 'Step 4 — AGM/GM/CDC only ($350, via Corey Dalton). A TAIS red flag is a HARD STOP. Other roles: move straight on.',
  final_interview: 'Step 5 — for AGM/GM/CDC this interview is held by the VP People, VP Ops, President or Corporate Chefs.',
  approvals: 'Collect the required sign-offs below. All named approvers must approve before the offer.',
  offer: 'Step 6 — prepare and present the offer (48-hour sign-back if they need time), then record the outcome.',
}

export const nextActionFor = (app: ApplicationRow): string | undefined =>
  app.flow === 'mgmt' ? MGMT_NEXT_ACTION[app.status] : NEXT_ACTION[app.status]

/** Which hiring-guide documents (people_center_hiring_guides.sort) belong
 * inside each management step of the guided workflow, so a manager reads the
 * step's guide right on the candidate's profile. */
export const STAGE_GUIDE_SORTS: Partial<Record<ApplicationStatus, number[]>> = {
  culture_interview: [10],
  reference_check: [20],
  financial_interview: [30, 40, 50, 60],
  tais: [70],
  final_interview: [80],
  offer: [90],
}

// Role tiering — the process differs by the role being interviewed for:
// the financial interview has three tiers, and TAIS is AGM/GM/CDC only.
// The workflow shows the applicable tier and tucks the others away (still
// reachable, in case the role changes mid-process).

/** desired_position → the hiring-guide sort of the matching financial tier. */
export const FINANCIAL_TIER_SORT: Record<string, number> = {
  'Guest Service Manager': 30,
  'Service Manager': 30,
  'Sous Chef': 30,
  'Beverage Manager': 40,
  'Assistant General Manager': 40,
  'General Manager': 50,
  'Chef de Cuisine': 50,
}
export const FINANCIAL_TIER_SORTS = [30, 40, 50]

export const TAIS_ROLES = ['Assistant General Manager', 'General Manager', 'Chef de Cuisine']

// --- Step logistics ----------------------------------------------------------
// The small fill-ins from the CG Mgmt Interview Process tabs, as structured
// fields (Michael, 2026-09-03): Where (In person / Zoom) on the culture,
// financial and final interviews, the TAIS link, and the offer's Signed
// back?. One updatable row per (application, stage); every save audited.

export interface StepFieldDef {
  key: string
  label: string
  kind: 'select' | 'text'
  options?: string[]
  placeholder?: string
}

export const STEP_FIELDS: Partial<Record<ApplicationStatus, StepFieldDef[]>> = {
  culture_interview: [{ key: 'where', label: 'Where?', kind: 'select', options: ['In person', 'Zoom'] }],
  financial_interview: [{ key: 'where', label: 'Where?', kind: 'select', options: ['In person', 'Zoom'] }],
  final_interview: [{ key: 'where', label: 'Where?', kind: 'select', options: ['In person', 'Zoom'] }],
  tais: [{ key: 'tais_link', label: 'TAIS link', kind: 'text', placeholder: 'Link to the TAIS report…' }],
  offer: [
    { key: 'where', label: 'Where?', kind: 'select', options: ['In person', 'Zoom'] },
    { key: 'signed_back', label: 'Signed back?', kind: 'select', options: ['Yes', 'No'] },
  ],
}

export type StepDetailsMap = Record<string, Record<string, string>>

export async function fetchStepDetails(applicationId: string): Promise<StepDetailsMap> {
  const { data, error } = await supabase
    .from('people_center_step_details')
    .select('stage, details')
    .eq('application_id', applicationId)
  if (error) throw error
  const map: StepDetailsMap = {}
  for (const row of (data as { stage: string; details: Record<string, string> }[]) ?? []) {
    map[row.stage] = row.details ?? {}
  }
  return map
}

export async function saveStepDetails(
  actor: Actor,
  app: ApplicationRow,
  stage: ApplicationStatus,
  details: Record<string, string>,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_step_details')
    .upsert(
      {
        application_id: app.id,
        stage,
        details,
        updated_at: new Date().toISOString(),
        updated_by: actor.personId,
        updated_by_name: actor.name,
      },
      { onConflict: 'application_id,stage' },
    )
    .select('stage')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('The database did not accept this change — you are not the reviewer for this position.')
  }
  const summary = Object.entries(details)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(' · ')
  await recordAudit(
    actor,
    'update',
    'application_step',
    app.id,
    app.applicant?.full_name ?? 'applicant',
    `${STATUS_LABELS[stage]} details (${app.desired_position} — ${app.location_name}): ${summary || 'cleared'}`,
  )
}

/** A dated, attributed note on one step of the workflow — stored as an
 * application event (`note.<stage>`), so it lives in the same immutable
 * history as stage moves and interviews. */
export async function recordStageNote(
  actor: Actor,
  app: ApplicationRow,
  stage: ApplicationStatus,
  note: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_application_events')
    .insert({
      application_id: app.id,
      event: `note.${stage}`,
      actor_person_id: actor.personId,
      actor_name: actor.name,
      detail: note,
    })
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('The database did not accept this note — you are not the reviewer for this position.')
  }
  await recordAudit(
    actor,
    'create',
    'application_note',
    app.id,
    app.applicant?.full_name ?? 'applicant',
    `Note on ${STATUS_LABELS[stage]} (${app.desired_position} — ${app.location_name}): ${note}`,
  )
}

// --- Screening traffic light -------------------------------------------------
// Derived FLAGS from the application's own answers (plus the watch-list
// check when the caller has it): red = stop and check before proceeding,
// yellow = proceed with caution, green = nothing in the answers to flag.
// Display-only by design — nothing is ever auto-advanced or auto-rejected;
// every reason is shown so the reviewer judges it (Michael's standing rule).

export type ScreenLevel = 'green' | 'yellow' | 'red'
export interface ScreenFlag {
  level: 'red' | 'yellow'
  reason: string
}

const saidNo = (v: unknown) => typeof v === 'string' && v.trim().toLowerCase() === 'no'
const saidYes = (v: unknown) => typeof v === 'string' && v.trim().toLowerCase() === 'yes'

export function screenApplication(
  app: ApplicationRow,
  watch: WatchlistMatch[] = [],
): { level: ScreenLevel; flags: ScreenFlag[] } {
  const flags: ScreenFlag[] = []
  const f = app.form as Record<string, any>
  const roleText = (Array.isArray(f.positions) ? f.positions.join(', ') : app.desired_position) ?? ''
  const alcoholRole = /server|bartender/i.test(roleText)

  for (const w of watch) {
    flags.push(
      w.list === 'black'
        ? { level: 'red', reason: 'Name matches the CG do-not-hire list — contact HQ before proceeding (it may be a different person with the same name).' }
        : { level: 'yellow', reason: 'Name matches the CG proceed-with-caution list — check with HQ.' },
    )
  }

  const we = f.work_eligibility
  if (saidNo(we) || saidNo(we?.legal_right_to_work_in_canada)) {
    flags.push({ level: 'red', reason: 'Answered No to having the legal right to work in Canada.' })
  }
  if (saidNo(we?.can_submit_documents)) {
    flags.push({ level: 'red', reason: 'Cannot submit documents proving the right to work.' })
  }
  if (saidNo(f.essential_functions)) {
    flags.push({ level: 'red', reason: 'Answered No to being able to perform the essential functions of the job.' })
  }
  if (saidNo(f.minimum_age)) {
    flags.push(
      alcoholRole
        ? { level: 'red', reason: `Not of legal age to serve alcohol — applying for ${roleText}.` }
        : { level: 'yellow', reason: 'Not of legal age to serve alcohol.' },
    )
  }
  if (saidNo(f.alcohol_service?.can_submit_proof_of_age)) {
    flags.push({ level: 'yellow', reason: 'Cannot submit proof of age.' })
  }
  if (alcoholRole && saidNo(f.alcohol_service?.smart_serve_certified)) {
    flags.push({ level: 'yellow', reason: `No Smart Serve certification — required for ${roleText}.` })
  }
  if (saidYes(f.affiliated_history?.ever_employed)) {
    const where = f.affiliated_history?.location
    flags.push({
      level: 'yellow',
      reason: `Says they worked at ${where || 'an affiliated restaurant'} — verify our records (and Push) before proceeding.`,
    })
  }
  const av = f.availability ?? {}
  const terms = typeof av.jobs_terminated_from === 'string' ? av.jobs_terminated_from : ''
  if (['2', '3', '4 or more'].includes(terms)) {
    flags.push({ level: 'yellow', reason: `Terminated from ${terms} job${terms === '2' ? 's' : 's'} — worth asking about.` })
  }
  if (saidNo(av.holidays_and_weekends)) {
    flags.push({ level: 'yellow', reason: 'Cannot work holidays and weekends.' })
  }
  if (saidNo(av.adequate_transportation)) {
    flags.push({ level: 'yellow', reason: 'No adequate transportation for early/late shifts.' })
  }
  if (saidNo(av.flexible_for_training)) {
    flags.push({ level: 'yellow', reason: 'Schedule not flexible for required training.' })
  }

  const level: ScreenLevel = flags.some((x) => x.level === 'red')
    ? 'red'
    : flags.length > 0
      ? 'yellow'
      : 'green'
  return { level, flags }
}

export const STALE_AFTER_DAYS = 7

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export function isStale(app: ApplicationRow): boolean {
  return !TERMINAL_STATUSES.includes(app.status) && daysSince(app.updated_at) >= STALE_AFTER_DAYS
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

// --- Job descriptions --------------------------------------------------------
// The documents applicants acknowledge (acks doc='job_description'), stored
// digitally per role title and editable by executive/admin (RLS enforced).

export interface JobDescription {
  id: string
  role_title: string
  department: string
  reports_to: string
  body: string
  source_file: string
  version: number
  active: boolean
  updated_at: string
  updated_by_name: string | null
}

export async function fetchJobDescriptions(): Promise<JobDescription[]> {
  const { data, error } = await supabase
    .from('people_center_job_descriptions')
    .select('id, role_title, department, reports_to, body, source_file, version, active, updated_at, updated_by_name')
    .order('role_title')
  if (error) throw error
  return (data as JobDescription[]) ?? []
}

export interface JobDescriptionEdits {
  role_title: string
  department: string
  reports_to: string
  body: string
}

export async function saveJobDescription(
  actor: Actor,
  existing: JobDescription | null,
  edits: JobDescriptionEdits,
): Promise<void> {
  if (existing) {
    const { data, error } = await supabase
      .from('people_center_job_descriptions')
      .update({
        ...edits,
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: actor.personId,
        updated_by_name: actor.name,
      })
      .eq('id', existing.id)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) {
      throw new Error('The database did not accept this change — editing is executive/admin only.')
    }
  } else {
    const { error } = await supabase.from('people_center_job_descriptions').insert({
      ...edits,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    if (error) throw error
  }
  await recordAudit(
    actor,
    existing ? 'update' : 'create',
    'job_description',
    existing?.id ?? edits.role_title,
    edits.role_title,
    existing
      ? `Job description for ${edits.role_title} updated (v${existing.version + 1})`
      : `Job description for ${edits.role_title} added`,
  )
}

// --- Management approvals ----------------------------------------------------
// Michael's ruling (2026-09-03): Megan Stover + John Mackay approve all FOH
// managers; Todd Clarmo + Michael Hodgson approve all BOH chefs. Required
// approvers are data (people_center_mgmt_approvers); a signature can only be
// written by the approver themselves — RLS enforces it, the UI just reflects
// it. Approvals are immutable.

export interface MgmtApprover {
  track: MgmtTrack
  person_id: string
  person_name: string
}

export async function fetchMgmtApprovers(): Promise<MgmtApprover[]> {
  const { data, error } = await supabase
    .from('people_center_mgmt_approvers')
    .select('track, person_id, person_name')
    .order('person_name')
  if (error) throw error
  return (data as MgmtApprover[]) ?? []
}

export interface ApplicationApproval {
  id: string
  application_id: string
  approver_person_id: string
  approver_name: string
  decision: 'approved' | 'rejected'
  note: string
  created_at: string
}

export async function fetchApprovals(applicationId: string): Promise<ApplicationApproval[]> {
  const { data, error } = await supabase
    .from('people_center_application_approvals')
    .select('id, application_id, approver_person_id, approver_name, decision, note, created_at')
    .eq('application_id', applicationId)
    .order('created_at')
  if (error) throw error
  return (data as ApplicationApproval[]) ?? []
}

export async function recordApproval(
  actor: Actor,
  app: ApplicationRow,
  decision: 'approved' | 'rejected',
  note: string,
): Promise<void> {
  if (!actor.personId) throw new Error('Your login is not linked to a person record — approvals are personal.')
  const { data, error } = await supabase
    .from('people_center_application_approvals')
    .insert({
      application_id: app.id,
      approver_person_id: actor.personId,
      approver_name: actor.name,
      decision,
      note,
    })
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('The database did not accept this approval — only the named approvers for this track can sign, and only for themselves.')
  }
  const { error: evErr } = await supabase.from('people_center_application_events').insert({
    application_id: app.id,
    event: `approval.${decision}`,
    actor_person_id: actor.personId,
    actor_name: actor.name,
    detail: note,
  })
  if (evErr) throw evErr
  await recordAudit(
    actor,
    'create',
    'application_approval',
    app.id,
    app.applicant?.full_name ?? 'applicant',
    `${decision === 'approved' ? 'Approved' : 'Rejected'} ${app.desired_position} candidate (${app.location_name})${note ? `: ${note}` : ''}`,
  )
}

// --- Reference checks --------------------------------------------------------
// The fillable Reference Check Form from the CG Mgmt Interview Process
// ("2. Reference Checks" tab, right half): one record per reference call,
// captured inside the Reference check step. The standard: minimum 2 POSITIVE
// references, at least 1 self-sourced for management. Records are immutable
// for the recorder (same shape as recorded interviews).

export const REFERENCE_SOURCES = ['Candidate provided', 'CG sourced'] as const

export interface ReferenceCheck {
  id: string
  application_id: string
  source: string
  contact_person: string
  company: string
  phone: string
  contact_position: string
  position_confirmed: string
  job_performance: string
  attendance: string
  attitude: string
  opportunities_concerns: string
  would_rehire: string
  other_comments: string
  checked_on: string | null
  checked_by_name: string
  created_at: string
}

export interface ReferenceCheckEdits {
  source: string
  contact_person: string
  company: string
  phone: string
  contact_position: string
  position_confirmed: string
  job_performance: string
  attendance: string
  attitude: string
  opportunities_concerns: string
  would_rehire: string
  other_comments: string
  checked_on: string
}

export async function fetchReferenceChecks(applicationId: string): Promise<ReferenceCheck[]> {
  const { data, error } = await supabase
    .from('people_center_reference_checks')
    .select(
      'id, application_id, source, contact_person, company, phone, contact_position, position_confirmed, job_performance, attendance, attitude, opportunities_concerns, would_rehire, other_comments, checked_on, checked_by_name, created_at',
    )
    .eq('application_id', applicationId)
    .order('created_at')
  if (error) throw error
  return (data as ReferenceCheck[]) ?? []
}

export async function recordReferenceCheck(
  actor: Actor,
  app: ApplicationRow,
  edits: ReferenceCheckEdits,
): Promise<void> {
  const { data, error } = await supabase
    .from('people_center_reference_checks')
    .insert({
      application_id: app.id,
      ...edits,
      checked_on: edits.checked_on || null,
      checked_by: actor.personId,
      checked_by_name: actor.name,
    })
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('The database did not accept this reference check — you are not the reviewer for this position.')
  }
  const { error: evErr } = await supabase.from('people_center_application_events').insert({
    application_id: app.id,
    event: 'reference.recorded',
    actor_person_id: actor.personId,
    actor_name: actor.name,
    detail: `${edits.contact_person}${edits.company ? ` (${edits.company})` : ''} — rehire: ${edits.would_rehire || '?'}`,
  })
  if (evErr) throw evErr
  await recordAudit(
    actor,
    'create',
    'reference_check',
    app.id,
    app.applicant?.full_name ?? 'applicant',
    `Reference check recorded (${app.desired_position} — ${app.location_name}): ${edits.contact_person}, rehire ${edits.would_rehire || '?'}`,
  )
}

// --- Pipeline speed ----------------------------------------------------------
// Every stage move across every application, for the Admin Center's Pipeline
// Speed tracker: time-between-steps per candidate, and per-manager pace
// (each stage.<status> event closes the previous stage; the mover took that
// long). RLS scopes rows — an admin sees everything.

export interface StageMoveEvent {
  application_id: string
  event: string
  actor_name: string
  created_at: string
}

export async function fetchAllStageEvents(): Promise<StageMoveEvent[]> {
  const { data, error } = await supabase
    .from('people_center_application_events')
    .select('application_id, event, actor_name, created_at')
    .like('event', 'stage.%')
    .order('created_at')
  if (error) throw error
  return (data as StageMoveEvent[]) ?? []
}

// --- Hiring watch list -------------------------------------------------------
// The CG Black List (do not interview/hire/re-hire) + Grey List (proceed with
// caution). Table access is admin/executive ONLY (RLS). Everyone else gets
// checkWatchlist(): a security-definer name check that says WHICH list a name
// is on and nothing more — the application panel uses it to tell a reviewer
// "contact HQ before proceeding" without exposing a word of the notes.

export type WatchlistKind = 'black' | 'grey'

export interface WatchlistEntry {
  id: string
  list: WatchlistKind
  full_name: string
  role: string
  former_cg: string
  notes: string
  noted_date: string
  noted_by: string
  active: boolean
  updated_at: string
  updated_by_name: string | null
}

export interface WatchlistEdits {
  list: WatchlistKind
  full_name: string
  role: string
  former_cg: string
  notes: string
  noted_date: string
  noted_by: string
}

export async function fetchWatchlist(): Promise<WatchlistEntry[]> {
  const { data, error } = await supabase
    .from('people_center_hiring_watchlist')
    .select('id, list, full_name, role, former_cg, notes, noted_date, noted_by, active, updated_at, updated_by_name')
    .eq('active', true)
    .order('full_name')
  if (error) throw error
  return (data as WatchlistEntry[]) ?? []
}

export async function saveWatchlistEntry(
  actor: Actor,
  existing: WatchlistEntry | null,
  edits: WatchlistEdits,
): Promise<void> {
  if (existing) {
    const { data, error } = await supabase
      .from('people_center_hiring_watchlist')
      .update({
        ...edits,
        updated_at: new Date().toISOString(),
        updated_by: actor.personId,
        updated_by_name: actor.name,
      })
      .eq('id', existing.id)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) throw new Error('The database did not accept this change.')
  } else {
    const { error } = await supabase.from('people_center_hiring_watchlist').insert({
      ...edits,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    if (error) throw error
  }
  await recordAudit(
    actor,
    existing ? 'update' : 'create',
    'watchlist_entry',
    existing?.id ?? edits.full_name,
    edits.full_name,
    `${existing ? 'Updated' : 'Added'} ${edits.list === 'black' ? 'Black List' : 'Grey List'} entry for ${edits.full_name}`,
  )
}

export async function removeWatchlistEntry(actor: Actor, entry: WatchlistEntry): Promise<void> {
  // Soft removal: keep the record (it is itself history), just stop matching.
  const { data, error } = await supabase
    .from('people_center_hiring_watchlist')
    .update({
      active: false,
      updated_at: new Date().toISOString(),
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .eq('id', entry.id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('The database did not accept this change.')
  await recordAudit(
    actor,
    'update',
    'watchlist_entry',
    entry.id,
    entry.full_name,
    `Removed ${entry.full_name} from the ${entry.list === 'black' ? 'Black' : 'Grey'} List (kept inactive for history)`,
  )
}

export interface WatchlistMatch {
  list: WatchlistKind
  matched_name: string
}

/** Exact-name check anyone signed in may run — returns which list (if any),
 * never the notes. */
export async function checkWatchlist(name: string): Promise<WatchlistMatch[]> {
  const { data, error } = await supabase.rpc('people_center_watchlist_check', { p_name: name })
  if (error) throw error
  return (data as WatchlistMatch[]) ?? []
}

/** The full entries for a name — RLS returns rows only to admin/executive,
 * so the application panel can show HQ the notes and everyone else nothing. */
export async function fetchWatchlistEntriesByName(name: string): Promise<WatchlistEntry[]> {
  const { data, error } = await supabase
    .from('people_center_hiring_watchlist')
    .select('id, list, full_name, role, former_cg, notes, noted_date, noted_by, active, updated_at, updated_by_name')
    .eq('active', true)
    .ilike('full_name', name.trim())
  if (error) throw error
  return (data as WatchlistEntry[]) ?? []
}

// --- Management hiring guides ------------------------------------------------
// The CG Mgmt Interview Process (Mar 2026), one document per step. Readable
// by manager altitude and up (RLS); edited by executive/admin.

export interface HiringGuide {
  id: string
  sort: number
  title: string
  subtitle: string
  body: string
  source_file: string
  version: number
  active: boolean
  updated_at: string
  updated_by_name: string | null
}

export interface HiringGuideEdits {
  sort: number
  title: string
  subtitle: string
  body: string
}

export async function fetchHiringGuides(): Promise<HiringGuide[]> {
  const { data, error } = await supabase
    .from('people_center_hiring_guides')
    .select('id, sort, title, subtitle, body, source_file, version, active, updated_at, updated_by_name')
    .eq('active', true)
    .order('sort')
  if (error) throw error
  return (data as HiringGuide[]) ?? []
}

export async function saveHiringGuide(
  actor: Actor,
  existing: HiringGuide | null,
  edits: HiringGuideEdits,
): Promise<void> {
  if (existing) {
    const { data, error } = await supabase
      .from('people_center_hiring_guides')
      .update({
        ...edits,
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: actor.personId,
        updated_by_name: actor.name,
      })
      .eq('id', existing.id)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) {
      throw new Error('The database did not accept this change — editing is executive/admin only.')
    }
  } else {
    const { error } = await supabase.from('people_center_hiring_guides').insert({
      ...edits,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    if (error) throw error
  }
  await recordAudit(
    actor,
    existing ? 'update' : 'create',
    'hiring_guide',
    existing?.id ?? edits.title,
    edits.title,
    existing
      ? `Hiring guide "${edits.title}" updated (v${existing.version + 1})`
      : `Hiring guide "${edits.title}" added`,
  )
}

// --- Uniform & grooming standards --------------------------------------------
// The second document of the acknowledgement pair (acks doc='uniform_grooming').
// Per BRAND + audience (FOH/BOH) — these differ by restaurant brand, unlike
// job descriptions. Same read/write shape as job descriptions.

export interface UniformStandard {
  id: string
  brand: string
  audience: string
  title: string
  body: string
  source_file: string
  effective: string
  version: number
  active: boolean
  updated_at: string
  updated_by_name: string | null
}

export interface UniformStandardEdits {
  brand: string
  audience: string
  title: string
  body: string
  effective: string
}

export async function fetchUniformStandards(): Promise<UniformStandard[]> {
  const { data, error } = await supabase
    .from('people_center_uniform_standards')
    .select('id, brand, audience, title, body, source_file, effective, version, active, updated_at, updated_by_name')
    .order('brand')
    .order('audience')
  if (error) throw error
  return (data as UniformStandard[]) ?? []
}

export async function saveUniformStandard(
  actor: Actor,
  existing: UniformStandard | null,
  edits: UniformStandardEdits,
): Promise<void> {
  if (existing) {
    const { data, error } = await supabase
      .from('people_center_uniform_standards')
      .update({
        ...edits,
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: actor.personId,
        updated_by_name: actor.name,
      })
      .eq('id', existing.id)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) {
      throw new Error('The database did not accept this change — editing is executive/admin only.')
    }
  } else {
    const { error } = await supabase.from('people_center_uniform_standards').insert({
      ...edits,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    if (error) throw error
  }
  await recordAudit(
    actor,
    existing ? 'update' : 'create',
    'uniform_standard',
    existing?.id ?? edits.title,
    edits.title,
    existing
      ? `Uniform standard "${edits.title}" (${edits.brand}) updated (v${existing.version + 1})`
      : `Uniform standard "${edits.title}" (${edits.brand}) added`,
  )
}

// --- Patterned interviews ----------------------------------------------------
// The 2026 BOH/FOH hourly patterned interview instruments: structured
// templates (each creditable answer = 1 point, per-role pass thresholds),
// editable by executive/admin; managers record scored interviews against an
// application. A recorded interview SNAPSHOTS the template so the record
// stays exactly what the interviewer saw, even after the template is edited.

export interface InterviewQuestion {
  prompt: string
  answers: string[]
}

export interface InterviewThreshold {
  label: string
  min: number
}

export type TemplateKind = 'scored' | 'questionnaire'

export interface InterviewTemplate {
  id: string
  name: string
  audience: string
  kind: TemplateKind
  intro: string
  questions: InterviewQuestion[]
  thresholds: InterviewThreshold[]
  source_file: string
  version: number
  active: boolean
  updated_at: string
  updated_by_name: string | null
}

export interface InterviewTemplateEdits {
  name: string
  audience: string
  intro: string
  questions: InterviewQuestion[]
  thresholds: InterviewThreshold[]
}

/** Per question, index-aligned with the template's questions. Scored
 * templates use picked/alt_*; questionnaires use text (free-form answer). */
export interface InterviewAnswer {
  picked: number[] // indices into question.answers, 1 point each
  alt_credit: boolean // "acceptable alternate response" credited (1 point)
  alt_note: string
  text?: string // questionnaire answer, in the applicant's own words
}

export interface TemplateSnapshot {
  name: string
  version: number
  kind?: TemplateKind
  intro: string
  questions: InterviewQuestion[]
  thresholds: InterviewThreshold[]
}

export interface ApplicationInterview {
  id: string
  application_id: string
  template_id: string | null
  template: TemplateSnapshot
  answers: InterviewAnswer[]
  score: number
  notes: string
  interviewer_name: string
  conducted_at: string
}

export function interviewMaxScore(questions: InterviewQuestion[]): number {
  // "Acceptable alternate response" adds a point per question beyond the
  // listed answers, so the printed minimums stay comparable to the paper form
  // by counting listed answers only.
  return questions.reduce((n, q) => n + q.answers.length, 0)
}

export function interviewScore(answers: InterviewAnswer[]): number {
  return answers.reduce((n, a) => n + a.picked.length + (a.alt_credit ? 1 : 0), 0)
}

export async function fetchInterviewTemplates(): Promise<InterviewTemplate[]> {
  const { data, error } = await supabase
    .from('people_center_interview_templates')
    .select('id, name, audience, kind, intro, questions, thresholds, source_file, version, active, updated_at, updated_by_name')
    .order('name')
  if (error) throw error
  return (data as InterviewTemplate[]) ?? []
}

export async function saveInterviewTemplate(
  actor: Actor,
  existing: InterviewTemplate | null,
  edits: InterviewTemplateEdits,
): Promise<void> {
  if (existing) {
    const { data, error } = await supabase
      .from('people_center_interview_templates')
      .update({
        ...edits,
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: actor.personId,
        updated_by_name: actor.name,
      })
      .eq('id', existing.id)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0) {
      throw new Error('The database did not accept this change — editing is executive/admin only.')
    }
  } else {
    const { error } = await supabase.from('people_center_interview_templates').insert({
      ...edits,
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    if (error) throw error
  }
  await recordAudit(
    actor,
    existing ? 'update' : 'create',
    'interview_template',
    existing?.id ?? edits.name,
    edits.name,
    existing
      ? `Interview template "${edits.name}" updated (v${existing.version + 1})`
      : `Interview template "${edits.name}" added`,
  )
}

export async function fetchApplicationInterviews(
  applicationId: string,
): Promise<ApplicationInterview[]> {
  const { data, error } = await supabase
    .from('people_center_application_interviews')
    .select('id, application_id, template_id, template, answers, score, notes, interviewer_name, conducted_at')
    .eq('application_id', applicationId)
    .order('conducted_at')
  if (error) throw error
  return (data as ApplicationInterview[]) ?? []
}

export async function recordApplicationInterview(
  actor: Actor,
  app: ApplicationRow,
  template: InterviewTemplate,
  answers: InterviewAnswer[],
  notes: string,
): Promise<void> {
  const score = template.kind === 'questionnaire' ? 0 : interviewScore(answers)
  const snapshot: TemplateSnapshot = {
    name: template.name,
    version: template.version,
    kind: template.kind,
    intro: template.intro,
    questions: template.questions,
    thresholds: template.thresholds,
  }
  const { data, error } = await supabase
    .from('people_center_application_interviews')
    .insert({
      application_id: app.id,
      template_id: template.id,
      template: snapshot,
      answers,
      score,
      notes,
      interviewer_person_id: actor.personId,
      interviewer_name: actor.name,
    })
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('The database did not accept this interview — you are not the reviewer for this position.')
  }
  const { error: evErr } = await supabase.from('people_center_application_events').insert({
    application_id: app.id,
    event: template.kind === 'questionnaire' ? 'screening.recorded' : 'interview.recorded',
    actor_person_id: actor.personId,
    actor_name: actor.name,
    detail:
      template.kind === 'questionnaire'
        ? template.name
        : `${template.name} — score ${score}/${interviewMaxScore(template.questions)}`,
  })
  if (evErr) throw evErr
  await recordAudit(
    actor,
    'create',
    'application_interview',
    app.id,
    app.applicant?.full_name ?? 'applicant',
    `Patterned interview recorded (${app.desired_position} — ${app.location_name}): ${template.name}, score ${score}`,
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
