// Patterned-interview recording on an application (ApplicationPanel mounts
// this). The manager runs the live scoring sheet: a checkbox per creditable
// answer, the automatic alternate-response point with its note, a running
// score against the pass marks. Saving writes an immutable record that
// snapshots the template used, adds an application event, and audits.
// RLS decides who may record (admin/executive + the configured reviewer) —
// a refused insert fails loud, mirroring setApplicationStatus.

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ClipboardCheck } from 'lucide-react'
import type { Actor } from '../../lib/activity'
import { errText } from '../../lib/errText'
import {
  fetchApplicationInterviews,
  fetchInterviewTemplates,
  interviewFailed,
  interviewMaxScore,
  interviewScore,
  recordApplicationInterview,
  type ApplicationInterview,
  type ApplicationRow,
  type InterviewAnswer,
  type InterviewTemplate,
  type TemplateKind,
} from './api'

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function InterviewSection({
  app,
  actor,
  kinds,
  bare,
  title,
}: {
  app: ApplicationRow
  actor: Actor
  /** Limit to these template kinds (both the templates offered and the
   * records shown) — the guided workflow mounts the questionnaire recorder in
   * the screening step and the scored recorder in the interview step. */
  kinds?: TemplateKind[]
  /** Render without the outer bordered section — for embedding in a step card. */
  bare?: boolean
  title?: string
}) {
  const [interviews, setInterviews] = useState<ApplicationInterview[]>([])
  const [templates, setTemplates] = useState<InterviewTemplate[]>([])
  const [recording, setRecording] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = () => {
    fetchApplicationInterviews(app.id).then(setInterviews).catch((e: Error) => setErr(e.message))
  }
  useEffect(load, [app.id])
  useEffect(() => {
    // Screening questionnaires belong to the management flow; TM applications
    // keep the scored hourly instruments only.
    fetchInterviewTemplates()
      .then((ts) => setTemplates(app.flow === 'mgmt' ? ts : ts.filter((t) => t.kind !== 'questionnaire')))
      .catch(() => setTemplates([]))
  }, [app.flow])

  // Legacy records predate template.kind in the snapshot — they were all scored.
  const visibleInterviews = kinds
    ? interviews.filter((iv) => kinds.includes(iv.template.kind ?? 'scored'))
    : interviews
  const visibleTemplates = kinds ? templates.filter((t) => kinds.includes(t.kind)) : templates
  const noun = kinds?.length === 1 && kinds[0] === 'questionnaire' ? 'screening' : 'interview'

  const content = (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-charcoal/50">
          <ClipboardCheck className="h-3.5 w-3.5" /> {title ?? 'Patterned interviews'}
        </h4>
        {!recording && visibleTemplates.length > 0 && (
          <button
            onClick={() => setRecording(true)}
            className="rounded-md border border-surface-line px-2.5 py-1 text-xs font-medium hover:bg-surface-muted"
          >
            Record {noun}
          </button>
        )}
      </div>

      {err && <p className="mb-2 text-xs text-danger">{err}</p>}

      {visibleInterviews.length === 0 && !recording && (
        <p className="text-xs text-charcoal/55">No {noun} recorded yet.</p>
      )}

      <ul className="space-y-1.5">
        {visibleInterviews.map((iv) => (
          <RecordedInterview key={iv.id} iv={iv} />
        ))}
      </ul>

      {recording && (
        <InterviewRecorder
          app={app}
          actor={actor}
          templates={visibleTemplates}
          onDone={() => {
            setRecording(false)
            load()
          }}
          onCancel={() => setRecording(false)}
        />
      )}
    </>
  )

  return bare ? (
    <div className="mt-2">{content}</div>
  ) : (
    <section className="mb-3 rounded-xl border border-surface-line p-3">{content}</section>
  )
}

function RecordedInterview({ iv }: { iv: ApplicationInterview }) {
  const [open, setOpen] = useState(false)
  const questionnaire = iv.template.kind === 'questionnaire'
  const failed = !questionnaire && interviewFailed(iv.answers)
  const max = interviewMaxScore(iv.template.questions)
  return (
    <li className="rounded-md border border-surface-line">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-muted/50"
      >
        <span className="flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span>
            {!questionnaire && (
              <>
                <span className="font-medium">
                  {iv.score}/{max}
                </span>{' '}
                ·{' '}
              </>
            )}
            {iv.template.name}{' '}
            <span className="text-xs text-charcoal/50">
              (v{iv.template.version}) — {iv.interviewer_name}, {fmtDate(iv.conducted_at)}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 gap-1">
          {failed ? (
            <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Fail — unacceptable response
            </span>
          ) : (
            !questionnaire &&
            iv.template.thresholds.map((th) => (
              <span
                key={th.label}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  iv.score >= th.min ? 'bg-success/10 text-success' : 'bg-surface-muted text-charcoal/50'
                }`}
              >
                {th.label} {iv.score >= th.min ? '✓' : `< ${th.min}`}
              </span>
            ))
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-surface-line px-3 py-2">
          <ol className="space-y-2 text-xs">
            {iv.template.questions.map((q, i) => {
              const a = iv.answers[i]
              if (questionnaire) {
                return (
                  <li key={i}>
                    <p className="font-medium text-charcoal/80">
                      {i + 1}. {q.prompt}
                    </p>
                    {a?.text?.trim() ? (
                      <p className="mt-0.5 whitespace-pre-wrap pl-4 text-charcoal/70">{a.text}</p>
                    ) : (
                      <p className="mt-0.5 pl-4 text-charcoal/45">Not answered.</p>
                    )}
                  </li>
                )
              }
              const pts = a ? a.picked.length + (a.alt_credit ? 1 : 0) : 0
              return (
                <li key={i}>
                  <p className="font-medium text-charcoal/80">
                    {i + 1}. {q.prompt} <span className="text-charcoal/45">— {pts} pt{pts === 1 ? '' : 's'}</span>
                  </p>
                  {a?.unacceptable && (
                    <p className="mt-0.5 pl-4 font-medium text-danger">
                      ⛔ Unacceptable response — fails the interview{a.unacceptable_note ? `: ${a.unacceptable_note}` : ''}
                    </p>
                  )}
                  {a && (a.picked.length > 0 || a.alt_credit) ? (
                    <ul className="mt-0.5 pl-4 text-charcoal/65">
                      {a.picked.map((idx) => (
                        <li key={idx}>✓ {q.answers[idx] ?? `answer #${idx + 1}`}</li>
                      ))}
                      {a.alt_credit && <li>✓ Alternate: {a.alt_note || '(no note)'}</li>}
                    </ul>
                  ) : (
                    <p className="mt-0.5 pl-4 text-charcoal/45">No creditable response.</p>
                  )}
                </li>
              )
            })}
          </ol>
          {iv.notes && (
            <p className="mt-2 border-t border-surface-line pt-2 text-xs text-charcoal/70">
              <span className="font-medium">Notes:</span> {iv.notes}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

function InterviewRecorder({
  app,
  actor,
  templates,
  onDone,
  onCancel,
}: {
  app: ApplicationRow
  actor: Actor
  templates: InterviewTemplate[]
  onDone: () => void
  onCancel: () => void
}) {
  const [templateId, setTemplateId] = useState('')
  const template = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  )
  const [answers, setAnswers] = useState<InterviewAnswer[]>([])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setAnswers(
      template
        ? template.questions.map(() => ({
            picked: [],
            alt_credit: false,
            alt_note: '',
            text: '',
            unacceptable: false,
            unacceptable_note: '',
          }))
        : [],
    )
  }, [template])

  const questionnaire = template?.kind === 'questionnaire'
  const failed = !questionnaire && interviewFailed(answers)

  function toggle(qi: number, ai: number) {
    setAnswers((prev) =>
      prev.map((a, i) =>
        i === qi
          ? {
              ...a,
              picked: a.picked.includes(ai) ? a.picked.filter((x) => x !== ai) : [...a.picked, ai],
            }
          : a,
      ),
    )
  }

  function setAlt(qi: number, patch: Partial<InterviewAnswer>) {
    setAnswers((prev) => prev.map((a, i) => (i === qi ? { ...a, ...patch } : a)))
  }

  async function save() {
    if (!template) return
    setBusy(true)
    setErr(null)
    try {
      await recordApplicationInterview(actor, app, template, answers, notes.trim())
      onDone()
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  const score = interviewScore(answers)

  return (
    <div className="mt-2 rounded-md border border-cg-orange/40 bg-cg-orange-soft/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">— choose the interview —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {template && !questionnaire && (
          <span className="text-xs font-medium text-charcoal/70">
            Score so far: {score}/{interviewMaxScore(template.questions)}
            {' · '}
            {template.thresholds.map((th) => `${th.label} min ${th.min}`).join(' · ')}
          </span>
        )}
        {questionnaire && (
          <span className="text-xs text-charcoal/60">
            Screening questionnaire — write down the answers in the applicant's own words.
          </span>
        )}
      </div>

      {template && (
        <>
          <div className="mb-2 whitespace-pre-wrap rounded-md bg-surface px-3 py-2 text-[11px] leading-relaxed text-charcoal/60">
            {template.intro}
          </div>
          <ol className="space-y-3">
            {template.questions.map((q, qi) => {
              const a = answers[qi]
              if (!a) return null
              if (questionnaire) {
                return (
                  <li key={qi} className="rounded-md border border-surface-line bg-surface p-2.5">
                    <p className="mb-1 text-sm font-medium">
                      {qi + 1}. {q.prompt}
                    </p>
                    <textarea
                      value={a.text ?? ''}
                      onChange={(e) => setAlt(qi, { text: e.target.value })}
                      rows={2}
                      placeholder="Their answer…"
                      className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
                    />
                  </li>
                )
              }
              const pts = a.picked.length + (a.alt_credit ? 1 : 0)
              return (
                <li key={qi} className="rounded-md border border-surface-line bg-surface p-2.5">
                  <p className="mb-1 text-sm font-medium">
                    {qi + 1}. {q.prompt}{' '}
                    <span className="text-xs font-normal text-charcoal/45">— {pts} pt{pts === 1 ? '' : 's'}</span>
                  </p>
                  <div className="space-y-0.5">
                    {/* Michael's rule: the unacceptable option leads every list,
                        and one unacceptable response fails the whole interview. */}
                    <div className={`rounded-md px-2 py-1 ${a.unacceptable ? 'bg-danger/10' : ''}`}>
                      <label className="flex cursor-pointer items-baseline gap-2 text-sm font-medium text-danger">
                        <input
                          type="checkbox"
                          checked={!!a.unacceptable}
                          onChange={() => setAlt(qi, { unacceptable: !a.unacceptable })}
                          className="translate-y-0.5"
                        />
                        Unacceptable response — fails the whole interview (rude, discriminatory, inappropriate)
                      </label>
                      {a.unacceptable && (
                        <input
                          value={a.unacceptable_note ?? ''}
                          onChange={(e) => setAlt(qi, { unacceptable_note: e.target.value })}
                          placeholder="Note what was said…"
                          className="mt-1 w-full rounded-md border border-danger/40 bg-surface px-2 py-1 text-xs"
                        />
                      )}
                    </div>
                    {q.answers.map((ans, ai) => (
                      <label key={ai} className="flex cursor-pointer items-baseline gap-2 text-sm text-charcoal/80">
                        <input
                          type="checkbox"
                          checked={a.picked.includes(ai)}
                          onChange={() => toggle(qi, ai)}
                          className="translate-y-0.5"
                        />
                        {ans}
                      </label>
                    ))}
                    <div className="flex flex-wrap items-baseline gap-2 text-sm text-charcoal/70">
                      <label className="flex cursor-pointer items-baseline gap-2">
                        <input
                          type="checkbox"
                          checked={a.alt_credit}
                          onChange={() => setAlt(qi, { alt_credit: !a.alt_credit })}
                          className="translate-y-0.5"
                        />
                        Acceptable alternate response
                      </label>
                      {a.alt_credit && (
                        <input
                          value={a.alt_note}
                          onChange={(e) => setAlt(qi, { alt_note: e.target.value })}
                          placeholder="Note the answer given…"
                          className="min-w-48 flex-1 rounded-md border border-surface-line bg-surface px-2 py-1 text-xs"
                        />
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Overall notes for the record (optional)"
            className="mt-2 w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          />
        </>
      )}

      {failed && (
        <p className="mt-2 rounded-md bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
          This interview is a FAIL — an unacceptable response was recorded. The score does not
          matter; do not proceed with this candidate.
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={busy || !template}
          className={`rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
            failed ? 'bg-danger hover:opacity-90' : 'bg-cg-orange hover:bg-cg-orange-hover'
          }`}
        >
          {busy
            ? 'Saving…'
            : !template
              ? 'Save interview'
              : questionnaire
                ? 'Save screening'
                : failed
                  ? 'Save interview — FAILED'
                  : `Save interview (${score}/${interviewMaxScore(template.questions)})`}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
        >
          Cancel
        </button>
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </div>
  )
}
