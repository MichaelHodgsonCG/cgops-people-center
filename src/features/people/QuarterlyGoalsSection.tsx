// Quarterly development goals on the cheat sheet (F27 sheets digitized).
// Visible to whoever RLS lets read them (HQ, the subject's chain, the person
// themselves, their coach); editable by HQ + ancestors. Goals are UTL tasks:
// they surface in the owner's and coach's My Tasks and, via the people
// resolver, in CGOPS My Day.

import { useEffect, useMemo, useState } from 'react'
import { Plus, Target } from 'lucide-react'
import { errText } from '../../lib/errText'
import type { Actor } from '../../lib/activity'
import { PersonPicker, type PickedPerson } from '../../components/PersonPicker'
import { fetchPeopleOptions, type PersonOption } from '../bench/api'
import {
  GOAL_KIND_LABELS,
  GOAL_STATUSES,
  OUTSTANDING,
  fetchFiscalQuarters,
  fetchGoalsForPerson,
  saveGoal,
  setGoalStatus,
  type DevGoal,
  type FiscalQuarter,
  type GoalKind,
  type GoalStatus,
} from '../tasks/api'

const STATUS_CLASS: Record<GoalStatus, string> = {
  open: 'bg-surface-muted text-charcoal/70',
  in_progress: 'bg-info/10 text-info',
  blocked: 'bg-danger/10 text-danger',
  done: 'bg-success/10 text-success',
  dropped: 'bg-surface-muted text-charcoal/45',
  not_applicable: 'bg-surface-muted text-charcoal/45',
}

export function QuarterlyGoalsSection({
  personId,
  personName,
  actor,
  canEdit,
}: {
  personId: string
  personName: string
  actor: Actor
  canEdit: boolean
}) {
  const [goals, setGoals] = useState<DevGoal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<DevGoal | 'new' | null>(null)
  const [showClosed, setShowClosed] = useState(false)

  const reload = () => {
    fetchGoalsForPerson(personId).then(setGoals).catch((e: Error) => setError(e.message))
  }
  useEffect(reload, [personId])

  if (goals === null && !error) return null // still loading — keep the panel quiet
  const open = (goals ?? []).filter((g) => OUTSTANDING.includes(g.status))
  const closed = (goals ?? []).filter((g) => !OUTSTANDING.includes(g.status))
  // RLS returns nothing to viewers outside the visibility circle — then only
  // render the section if the viewer could add goals.
  if (!canEdit && (goals?.length ?? 0) === 0) return null

  return (
    <section className="rounded-xl border border-surface-line p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal/50">
        <Target className="h-3.5 w-3.5" /> Quarterly development goals
      </h3>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      {open.length === 0 && closed.length === 0 && (
        <p className="mb-2 text-sm text-charcoal/55">No goals set yet.</p>
      )}

      <ul className="space-y-2">
        {open.map((g) => (
          <GoalRow key={g.id} goal={g} actor={actor} canEdit={canEdit} onChanged={reload} onEdit={() => setEditing(g)} />
        ))}
      </ul>

      {closed.length > 0 && (
        <button
          onClick={() => setShowClosed((v) => !v)}
          className="mt-2 text-xs font-medium text-charcoal/50 hover:text-charcoal"
        >
          {showClosed ? 'Hide' : 'Show'} {closed.length} closed goal{closed.length === 1 ? '' : 's'}
        </button>
      )}
      {showClosed && (
        <ul className="mt-2 space-y-2 opacity-70">
          {closed.map((g) => (
            <GoalRow key={g.id} goal={g} actor={actor} canEdit={canEdit} onChanged={reload} onEdit={() => setEditing(g)} />
          ))}
        </ul>
      )}

      {canEdit &&
        (editing ? (
          <GoalForm
            personId={personId}
            personName={personName}
            actor={actor}
            initial={editing === 'new' ? null : editing}
            onDone={() => {
              setEditing(null)
              reload()
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button
            onClick={() => setEditing('new')}
            className="mt-3 flex items-center gap-1.5 rounded-md border border-surface-line px-3 py-1.5 text-sm font-medium hover:bg-surface-muted"
          >
            <Plus className="h-4 w-4" /> Add goal
          </button>
        ))}
    </section>
  )
}

function GoalRow({
  goal,
  actor,
  canEdit,
  onChanged,
  onEdit,
}: {
  goal: DevGoal
  actor: Actor
  canEdit: boolean
  onChanged: () => void
  onEdit: () => void
}) {
  const [err, setErr] = useState<string | null>(null)
  const label =
    goal.fiscal_year && goal.quarter ? `F${String(goal.fiscal_year).slice(-2)} Q${goal.quarter}` : null

  return (
    <li className="rounded-lg border border-surface-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{goal.title}</span>
        <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-charcoal/60">
          {GOAL_KIND_LABELS[goal.kind]}
        </span>
        {label && (
          <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-charcoal/60">{label}</span>
        )}
        {canEdit ? (
          <select
            value={goal.status}
            onChange={(e) => {
              setGoalStatus(actor, goal, e.target.value as GoalStatus)
                .then(onChanged)
                .catch((er) => setErr(errText(er)))
            }}
            className={`ml-auto rounded-md border border-surface-line px-1.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[goal.status]}`}
          >
            {GOAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        ) : (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[goal.status]}`}>
            {goal.status.replace(/_/g, ' ')}
          </span>
        )}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-charcoal/60">
        {goal.due_date && (
          <span className={Date.parse(goal.due_date) < Date.now() && OUTSTANDING.includes(goal.status) ? 'font-medium text-danger' : ''}>
            due {goal.due_date}
          </span>
        )}
        {(goal.baseline || goal.target) && (
          <span>
            {goal.baseline || '—'} → {goal.target || '—'}
          </span>
        )}
        {goal.support_name && <span>coach: {goal.support_name}</span>}
        {goal.checkin1_on && <span>check-in 1: {goal.checkin1_on}</span>}
        {goal.checkin2_on && <span>check-in 2: {goal.checkin2_on}</span>}
      </p>
      {goal.detail && <p className="mt-1 text-xs text-charcoal/55">{goal.detail}</p>}
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      {canEdit && (
        <button onClick={onEdit} className="mt-1 text-xs font-medium text-cg-orange hover:underline">
          Edit
        </button>
      )}
    </li>
  )
}

function GoalForm({
  personId,
  personName,
  actor,
  initial,
  onDone,
  onCancel,
}: {
  personId: string
  personName: string
  actor: Actor
  initial: DevGoal | null
  onDone: () => void
  onCancel: () => void
}) {
  const [quarters, setQuarters] = useState<FiscalQuarter[]>([])
  const [people, setPeople] = useState<PersonOption[]>([])
  const [kind, setKind] = useState<GoalKind>(initial?.kind ?? 'custom')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [detail, setDetail] = useState(initial?.detail ?? '')
  const [baseline, setBaseline] = useState(initial?.baseline ?? '')
  const [target, setTarget] = useState(initial?.target ?? '')
  const [quarterKey, setQuarterKey] = useState(
    initial?.fiscal_year && initial?.quarter ? `${initial.fiscal_year}|${initial.quarter}` : '',
  )
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [coach, setCoach] = useState<PickedPerson>({
    name: initial?.support_name ?? '',
    personId: initial?.support_person_id ?? null,
  })
  const [checkin1, setCheckin1] = useState(initial?.checkin1_on ?? '')
  const [checkin2, setCheckin2] = useState(initial?.checkin2_on ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetchFiscalQuarters().then(setQuarters).catch((e: Error) => setErr(e.message))
    fetchPeopleOptions().then(setPeople).catch((e: Error) => setErr(e.message))
  }, [])

  // Show the current + next fiscal year's quarters — enough for planning.
  const quarterOptions = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const current = quarters.find((q) => q.starts_on <= today && today <= q.ends_on)
    return quarters.filter((q) => !current || q.fiscal_year >= current.fiscal_year)
  }, [quarters])

  function pickQuarter(key: string) {
    setQuarterKey(key)
    const [fy, q] = key.split('|').map(Number)
    const match = quarters.find((x) => x.fiscal_year === fy && x.quarter === q)
    // Picking a quarter defaults the due date to its end (still editable).
    if (match) setDueDate(match.ends_on)
  }

  async function save() {
    if (!title.trim()) {
      setErr('Give the goal a title (the SMART goal in one line).')
      return
    }
    const [fy, q] = quarterKey ? quarterKey.split('|').map(Number) : [null, null]
    setSaving(true)
    setErr(null)
    try {
      await saveGoal(actor, {
        id: initial?.id,
        ownerPersonId: personId,
        ownerName: personName,
        supportPersonId: coach.personId,
        supportName: coach.name.trim(),
        kind,
        title: title.trim(),
        detail: detail.trim(),
        baseline: baseline.trim(),
        target: target.trim(),
        fiscalYear: fy,
        quarter: q,
        dueDate: dueDate || null,
        checkin1On: checkin1 || null,
        checkin1Note: initial?.checkin1_note ?? '',
        checkin2On: checkin2 || null,
        checkin2Note: initial?.checkin2_note ?? '',
      })
      onDone()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-cg-orange/40 bg-cg-orange-soft/20 p-3">
      <div className="flex flex-wrap gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as GoalKind)}
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        >
          {(Object.keys(GOAL_KIND_LABELS) as GoalKind[]).map((k) => (
            <option key={k} value={k}>
              {GOAL_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select
          value={quarterKey}
          onChange={(e) => pickQuarter(e.target.value)}
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Quarter…</option>
          {quarterOptions.map((q) => (
            <option key={`${q.fiscal_year}|${q.quarter}`} value={`${q.fiscal_year}|${q.quarter}`}>
              F{String(q.fiscal_year).slice(-2)} Q{q.quarter} (ends {q.ends_on})
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-charcoal/60">
          Due
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-md border border-surface-line bg-surface px-2 py-1 text-sm"
          />
        </label>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="SMART goal in one line…"
        className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={baseline}
          onChange={(e) => setBaseline(e.target.value)}
          placeholder="Current result / baseline"
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        />
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Measurable target"
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        />
      </div>
      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        rows={2}
        placeholder="Key actions…"
        className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
      />
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-0.5 block text-[11px] text-charcoal/50">Coach (GM/mentor)</span>
          <PersonPicker people={people} value={coach} onChange={setCoach} placeholder="Coach…" />
        </label>
        <label className="text-sm">
          <span className="mb-0.5 block text-[11px] text-charcoal/50">Check-in 1</span>
          <input
            type="date"
            value={checkin1}
            onChange={(e) => setCheckin1(e.target.value)}
            className="w-full rounded-md border border-surface-line bg-surface px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-0.5 block text-[11px] text-charcoal/50">Check-in 2</span>
          <input
            type="date"
            value={checkin2}
            onChange={(e) => setCheckin2(e.target.value)}
            className="w-full rounded-md border border-surface-line bg-surface px-2 py-1 text-sm"
          />
        </label>
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          {saving ? 'Saving…' : initial ? 'Save goal' : 'Add goal'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
