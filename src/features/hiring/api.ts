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
  updated_at: string
  retention_purge_after: string
  form: Record<string, unknown>
  applicant: { full_name: string; email: string | null; phone: string | null } | null
}

export async function fetchApplications(): Promise<ApplicationRow[]> {
  const { data, error } = await supabase
    .from('people_center_applications')
    .select(
      `id, applicant_id, location_name, desired_position, source, status, complete,
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

export const TERMINAL_STATUSES: ApplicationStatus[] = ['hired', 'not_hired', 'withdrawn']

/** What moves this application forward, per stage — straight from the CG
 * hiring process. */
export const NEXT_ACTION: Partial<Record<ApplicationStatus, string>> = {
  submitted: 'Screen the application — review the answers, prior applications and any watch-list flag, then move to Screening.',
  screening: 'If they look right, contact the applicant and book the patterned interview.',
  interview: 'Record the patterned interview below, then move to Reference check.',
  reference_check: 'Complete at least 2 positive reference checks (Mgmt Hiring — Step 2 has the form), then move to Decision pending.',
  decision_pending: 'Make the decision and communicate it to the applicant within one week.',
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

export interface InterviewTemplate {
  id: string
  name: string
  audience: string
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

/** Per question, index-aligned with the template's questions. */
export interface InterviewAnswer {
  picked: number[] // indices into question.answers, 1 point each
  alt_credit: boolean // "acceptable alternate response" credited (1 point)
  alt_note: string
}

export interface TemplateSnapshot {
  name: string
  version: number
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
    .select('id, name, audience, intro, questions, thresholds, source_file, version, active, updated_at, updated_by_name')
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
  const score = interviewScore(answers)
  const snapshot: TemplateSnapshot = {
    name: template.name,
    version: template.version,
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
    event: 'interview.recorded',
    actor_person_id: actor.personId,
    actor_name: actor.name,
    detail: `${template.name} — score ${score}/${interviewMaxScore(template.questions)}`,
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
