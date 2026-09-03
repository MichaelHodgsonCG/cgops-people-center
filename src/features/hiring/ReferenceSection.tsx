// The Reference Check Form, embedded in the Reference check step of the
// guided workflow — the fillable right half of the "2. Reference Checks" tab
// (CG Mgmt Interview Process Mar 2026), digitised field for field. One
// record per reference call, immutable once saved (RLS: reviewer inserts,
// only admin/executive can amend). A live tally shows progress against the
// standard: minimum 2 POSITIVE references, and for management at least 1
// self-sourced (CG sourced).

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, PhoneCall } from 'lucide-react'
import type { Actor } from '../../lib/activity'
import { errText } from '../../lib/errText'
import {
  REFERENCE_SOURCES,
  fetchReferenceChecks,
  recordReferenceCheck,
  type ApplicationRow,
  type ReferenceCheck,
  type ReferenceCheckEdits,
} from './api'

const inputCls = 'w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-xs'

const emptyEdits = (): ReferenceCheckEdits => ({
  source: '',
  contact_person: '',
  company: '',
  phone: '',
  contact_position: '',
  position_confirmed: '',
  job_performance: '',
  attendance: '',
  attitude: '',
  opportunities_concerns: '',
  would_rehire: '',
  other_comments: '',
  checked_on: new Date().toISOString().slice(0, 10),
})

export function ReferenceSection({ app, actor }: { app: ApplicationRow; actor: Actor }) {
  const [checks, setChecks] = useState<ReferenceCheck[]>([])
  const [recording, setRecording] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = () => {
    fetchReferenceChecks(app.id).then(setChecks).catch((e: Error) => setErr(e.message))
  }
  useEffect(load, [app.id])

  const positive = checks.filter((c) => c.would_rehire === 'Yes').length
  const selfSourced = checks.filter((c) => c.source === 'CG sourced').length
  const needSelfSourced = app.flow === 'mgmt'
  const met = positive >= 2 && (!needSelfSourced || selfSourced >= 1)

  return (
    <div className="mt-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal/50">
          <PhoneCall className="h-3.5 w-3.5" /> Reference check form
        </h4>
        {!recording && (
          <button
            onClick={() => setRecording(true)}
            className="rounded-md border border-surface-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted"
          >
            Record reference check
          </button>
        )}
      </div>

      <p className="mb-2 text-[11px]">
        <span className={`rounded-full px-2 py-0.5 font-medium ${met ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
          {positive} of 2 positive
          {needSelfSourced && ` · ${selfSourced} of 1 self-sourced`}
          {met ? ' — standard met' : ' — keep going'}
        </span>
      </p>

      {err && <p className="mb-2 text-xs text-danger">{err}</p>}

      {checks.length === 0 && !recording && (
        <p className="text-xs text-charcoal/55">No reference checks recorded yet.</p>
      )}

      <ul className="space-y-1.5">
        {checks.map((c, i) => (
          <RecordedCheck key={c.id} n={i + 1} check={c} />
        ))}
      </ul>

      {recording && (
        <CheckRecorder
          app={app}
          actor={actor}
          onDone={() => {
            setRecording(false)
            load()
          }}
          onCancel={() => setRecording(false)}
        />
      )}
    </div>
  )
}

function RecordedCheck({ n, check }: { n: number; check: ReferenceCheck }) {
  const [open, setOpen] = useState(false)
  const rehireCls =
    check.would_rehire === 'Yes'
      ? 'bg-success/10 text-success'
      : check.would_rehire === 'No'
        ? 'bg-danger/10 text-danger'
        : 'bg-surface-muted text-charcoal/50'
  return (
    <li className="rounded-md border border-surface-line">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-1.5 px-3 py-2 text-left text-sm hover:bg-surface-muted/50"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="font-medium">
          #{n} {check.contact_person || '?'}
        </span>
        {check.company && <span className="text-xs text-charcoal/55">— {check.company}</span>}
        {check.source && (
          <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] text-charcoal/60">
            {check.source}
          </span>
        )}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${rehireCls}`}>
          Rehire: {check.would_rehire || '?'}
        </span>
      </button>
      {open && (
        <dl className="grid grid-cols-1 gap-y-1.5 border-t border-surface-line px-3 py-2 text-xs sm:grid-cols-2 sm:gap-x-4">
          {(
            [
              ['Phone', check.phone],
              ['Their position', check.contact_position],
              ['Position confirmed', check.position_confirmed],
              ['Job performance', check.job_performance],
              ['Attendance / punctuality', check.attendance],
              ['Attitude', check.attitude],
              ['Opportunities / concerns', check.opportunities_concerns],
              ['Other comments', check.other_comments],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt className="text-[10px] uppercase tracking-wide text-charcoal/45">{k}</dt>
                <dd className="whitespace-pre-wrap text-charcoal/80">{v}</dd>
              </div>
            ))}
          <div className="sm:col-span-2 border-t border-surface-line/60 pt-1 text-[10px] text-charcoal/45">
            Checked {check.checked_on ?? 'date not given'} by {check.checked_by_name || '?'}
          </div>
        </dl>
      )}
    </li>
  )
}

function CheckRecorder({
  app,
  actor,
  onDone,
  onCancel,
}: {
  app: ApplicationRow
  actor: Actor
  onDone: () => void
  onCancel: () => void
}) {
  const [edits, setEdits] = useState<ReferenceCheckEdits>(emptyEdits)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (patch: Partial<ReferenceCheckEdits>) => setEdits((e) => ({ ...e, ...patch }))

  async function save() {
    if (!edits.contact_person.trim()) {
      setErr('Please give the contact person at minimum.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await recordReferenceCheck(actor, app, {
        ...edits,
        contact_person: edits.contact_person.trim(),
        company: edits.company.trim(),
      })
      onDone()
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-md border border-cg-orange/40 bg-cg-orange-soft/20 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-charcoal/50">Reference source</span>
          <select value={edits.source} onChange={(e) => set({ source: e.target.value })} className={inputCls}>
            <option value="">— pick —</option>
            {REFERENCE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-charcoal/50">Date</span>
          <input type="date" value={edits.checked_on} onChange={(e) => set({ checked_on: e.target.value })} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-charcoal/50">Contact person</span>
          <input value={edits.contact_person} onChange={(e) => set({ contact_person: e.target.value })} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-charcoal/50">Phone #</span>
          <input value={edits.phone} onChange={(e) => set({ phone: e.target.value })} className={inputCls} type="tel" />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-charcoal/50">Company</span>
          <input value={edits.company} onChange={(e) => set({ company: e.target.value })} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-charcoal/50">Their position</span>
          <input value={edits.contact_position} onChange={(e) => set({ contact_position: e.target.value })} className={inputCls} />
        </label>
      </div>
      <label className="mt-2 block">
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-charcoal/50">
          Confirm position — what did they confirm the candidate did there?
        </span>
        <input value={edits.position_confirmed} onChange={(e) => set({ position_confirmed: e.target.value })} className={inputCls} />
      </label>
      {(
        [
          ['job_performance', 'Job performance'],
          ['attendance', 'Attendance / punctuality'],
          ['attitude', 'Attitude'],
          ['opportunities_concerns', 'Opportunities / concerns'],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="mt-2 block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-charcoal/50">{label}</span>
          <textarea value={edits[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<ReferenceCheckEdits>)} rows={2} className={inputCls} />
        </label>
      ))}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <span className="font-medium">Would you rehire?</span>
        {['Yes', 'No'].map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" checked={edits.would_rehire === o} onChange={() => set({ would_rehire: o })} />
            {o}
          </label>
        ))}
        {edits.would_rehire === 'No' && (
          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">
            No — STOP! Per the process, a No is a hard look before proceeding.
          </span>
        )}
      </div>
      <label className="mt-2 block">
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-charcoal/50">Other comments</span>
        <textarea
          value={edits.other_comments}
          onChange={(e) => set({ other_comments: e.target.value })}
          rows={2}
          placeholder="Anything a future interviewer should follow up on…"
          className={inputCls}
        />
      </label>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-md bg-cg-orange px-3 py-1.5 text-xs font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save reference check'}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-surface-line px-3 py-1.5 text-xs hover:bg-surface-muted"
        >
          Cancel
        </button>
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </div>
  )
}
