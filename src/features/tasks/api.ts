// Quarterly development goals (F27 sheets digitized) — UTL v1 conformant
// tasks: owner = the person the goal develops, support = their coach/GM,
// typed due_date, canonical status, completed_at/by. RLS scopes reads to
// HQ + the subject's chain + the owner/support themselves; the My Day
// resolver (resolve_my_people_tasks) serves the cross-platform rollup.

import { supabase } from '../../lib/supabase'
import { recordAudit, type Actor } from '../../lib/activity'

export type GoalKind = 'mission_impact' | 'improve_kpi' | 'improve_accountability' | 'custom'
export type GoalStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'dropped' | 'not_applicable'

export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  mission_impact: 'Mission impact',
  improve_kpi: 'Improve a KPI',
  improve_accountability: 'Improve an accountability',
  custom: 'Custom',
}

export const GOAL_STATUSES: GoalStatus[] = [
  'open',
  'in_progress',
  'blocked',
  'done',
  'dropped',
  'not_applicable',
]

export const OUTSTANDING: GoalStatus[] = ['open', 'in_progress', 'blocked']

export interface DevGoal {
  id: string
  owner_person_id: string
  owner_name: string
  support_person_id: string | null
  support_name: string
  kind: GoalKind
  title: string
  detail: string
  baseline: string
  target: string
  fiscal_year: number | null
  quarter: number | null
  due_date: string | null
  status: GoalStatus
  completed_at: string | null
  completed_by_name: string | null
  checkin1_on: string | null
  checkin1_note: string
  checkin2_on: string | null
  checkin2_note: string
}

const GOAL_COLS =
  'id, owner_person_id, owner_name, support_person_id, support_name, kind, title, detail, baseline, target, fiscal_year, quarter, due_date, status, completed_at, completed_by_name, checkin1_on, checkin1_note, checkin2_on, checkin2_note'

export async function fetchGoalsForPerson(personId: string): Promise<DevGoal[]> {
  const { data, error } = await supabase
    .from('people_center_dev_goals')
    .select(GOAL_COLS)
    .eq('owner_person_id', personId)
    .order('due_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return ((data as unknown as DevGoal[]) ?? [])
}

/** Goals where I'M the owner or the coach — the My Tasks feed. RLS already
 * permits these rows for any role. */
export async function fetchMyGoals(personId: string): Promise<DevGoal[]> {
  const { data, error } = await supabase
    .from('people_center_dev_goals')
    .select(GOAL_COLS)
    .or(`owner_person_id.eq.${personId},support_person_id.eq.${personId}`)
    .in('status', OUTSTANDING)
    .order('due_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return ((data as unknown as DevGoal[]) ?? [])
}

export interface GoalInput {
  id?: string
  ownerPersonId: string
  ownerName: string
  supportPersonId: string | null
  supportName: string
  kind: GoalKind
  title: string
  detail: string
  baseline: string
  target: string
  fiscalYear: number | null
  quarter: number | null
  dueDate: string | null
  checkin1On: string | null
  checkin1Note: string
  checkin2On: string | null
  checkin2Note: string
}

export async function saveGoal(actor: Actor, input: GoalInput): Promise<void> {
  const row = {
    owner_person_id: input.ownerPersonId,
    owner_name: input.ownerName,
    support_person_id: input.supportPersonId,
    support_name: input.supportName,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    baseline: input.baseline,
    target: input.target,
    fiscal_year: input.fiscalYear,
    quarter: input.quarter,
    due_date: input.dueDate,
    checkin1_on: input.checkin1On,
    checkin1_note: input.checkin1Note,
    checkin2_on: input.checkin2On,
    checkin2_note: input.checkin2Note,
    updated_at: new Date().toISOString(),
    updated_by: actor.personId,
    updated_by_name: actor.name,
  }
  if (input.id) {
    const { data, error } = await supabase
      .from('people_center_dev_goals')
      .update(row)
      .eq('id', input.id)
      .select('id')
    if (error) throw error
    if (!data || data.length === 0)
      throw new Error('The database did not accept this save — no goal-edit permission for this person.')
  } else {
    const { error } = await supabase.from('people_center_dev_goals').insert(row)
    if (error) throw error
  }
  await recordAudit(
    actor,
    input.id ? 'update' : 'create',
    'dev_goal',
    input.id ?? null,
    input.ownerName,
    `${input.id ? 'Updated' : 'Set'} quarterly goal for ${input.ownerName}: ${input.title}`,
  )
}

/** Status changes stamp completed_at/by on 'done' and clear them on reopen
 * (UTL §2). */
export async function setGoalStatus(
  actor: Actor,
  goal: DevGoal,
  status: GoalStatus,
): Promise<void> {
  const done = status === 'done'
  const { data, error } = await supabase
    .from('people_center_dev_goals')
    .update({
      status,
      completed_at: done ? new Date().toISOString() : null,
      completed_by_person_id: done ? actor.personId : null,
      completed_by_name: done ? actor.name : null,
      updated_at: new Date().toISOString(),
      updated_by: actor.personId,
      updated_by_name: actor.name,
    })
    .eq('id', goal.id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0)
    throw new Error('The database did not accept this change — no goal-edit permission for this person.')
  await recordAudit(
    actor,
    'update',
    'dev_goal',
    goal.id,
    goal.owner_name,
    `Goal "${goal.title}" → ${status.replace(/_/g, ' ')}`,
  )
}

export interface FiscalQuarter {
  fiscal_year: number
  quarter: number
  starts_on: string
  ends_on: string
}

/** Quarter boundaries derived from the CGOPS fiscal_calendar (13 periods;
 * Q1-3 = 3 periods, Q4 = 4). Drives the quarter picker + default due date. */
export async function fetchFiscalQuarters(): Promise<FiscalQuarter[]> {
  const { data, error } = await supabase
    .from('people_center_fiscal_quarters')
    .select('fiscal_year, quarter, starts_on, ends_on')
    .order('fiscal_year')
    .order('quarter')
  if (error) throw error
  return ((data as unknown as FiscalQuarter[]) ?? [])
}
