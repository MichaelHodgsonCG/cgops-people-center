// Interviews — the patterned interview instruments (2026 BOH/FOH hourly),
// digitised from the paper forms. Managers read the guide here; recording a
// scored interview happens on the application itself (ApplicationPanel).
// Executive/admin edit in place — every save bumps the version; recorded
// interviews are unaffected because they snapshot the template they used.

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ClipboardCheck, PencilLine, Plus, Trash2 } from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import { errText } from '../../lib/errText'
import { can, toPermissionUser } from '../../permissions'
import type { UserProfile } from '../../types'
import {
  fetchInterviewTemplates,
  interviewMaxScore,
  saveInterviewTemplate,
  type InterviewQuestion,
  type InterviewTemplate,
  type InterviewTemplateEdits,
  type InterviewThreshold,
} from './api'

interface InterviewsViewProps {
  session: Session
  profile: UserProfile | null
  /** Hiring-section reference mode: same rows, no editing — the editors live in the Admin Center (spec 3f10f057). */
  readOnly?: boolean
}

export function InterviewsView({ session, profile, readOnly }: InterviewsViewProps) {
  const actor = actorFrom(profile, session)
  const user = profile ? toPermissionUser(profile) : null
  const canEdit = !readOnly && can(user, 'update', 'hiring')

  const [templates, setTemplates] = useState<InterviewTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const load = () => {
    fetchInterviewTemplates()
      .then(setTemplates)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  )

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading interviews…</p>

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardCheck className="h-5 w-5 text-cg-orange" /> Patterned interviews
        </h2>
        <p className="mt-1 text-sm text-charcoal/60">
          The structured interview guides managers use with candidates. Each creditable answer is
          worth one point; an acceptable alternate answer (noted) also counts. Interviews are
          recorded on the application itself — open one from Applications.
        </p>
      </div>

      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-1">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setSelectedId(t.id)
                setEditing(false)
              }}
              aria-current={selectedId === t.id ? 'true' : undefined}
              className={`rounded-md px-3 py-2 text-left text-sm ${
                selectedId === t.id
                  ? 'bg-cg-orange-soft font-medium text-cg-orange'
                  : 'border border-surface-line bg-surface text-charcoal/75 hover:bg-surface-muted'
              }`}
            >
              <span className="block">{t.name}</span>
              <span className={`block text-[11px] ${selectedId === t.id ? 'text-cg-orange/70' : 'text-charcoal/45'}`}>
                {t.questions.length} questions · max {interviewMaxScore(t.questions)} pts · v{t.version}
              </span>
            </button>
          ))}
        </div>

        <div>
          {!selected ? (
            <p className="rounded-xl border border-surface-line bg-surface px-4 py-10 text-center text-sm text-charcoal/55">
              Pick an interview to read the guide.
            </p>
          ) : editing && canEdit ? (
            <TemplateForm
              tpl={selected}
              onCancel={() => setEditing(false)}
              onSave={async (edits) => {
                await saveInterviewTemplate(actor, selected, edits)
                setEditing(false)
                load()
              }}
            />
          ) : (
            <article className="rounded-xl border border-surface-line bg-surface p-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-surface-line pb-3">
                <div>
                  <h3 className="text-base font-semibold">{selected.name}</h3>
                  <p className="mt-0.5 text-xs text-charcoal/55">
                    {selected.audience} · pass marks:{' '}
                    {selected.thresholds.map((th) => `${th.label} min ${th.min}`).join(' · ')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-charcoal/45">
                    v{selected.version}
                    {selected.updated_by_name
                      ? ` · last updated by ${selected.updated_by_name} on ${new Date(selected.updated_at).toLocaleDateString()}`
                      : selected.source_file
                        ? ` · digitised from ${selected.source_file}`
                        : ''}
                  </p>
                </div>
                {canEdit && (
                  <button
                    onClick={() => setEditing(true)}
                    className="flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
                  >
                    <PencilLine className="h-3.5 w-3.5" /> Edit
                  </button>
                )}
              </div>

              <div className="mb-4 whitespace-pre-wrap rounded-md bg-surface-muted/60 px-3 py-2 text-xs leading-relaxed text-charcoal/70">
                {selected.intro}
              </div>

              <ol className="space-y-4">
                {selected.questions.map((q, i) => (
                  <li key={i}>
                    <p className="text-sm font-medium">
                      {i + 1}. {q.prompt}
                    </p>
                    <ul className="mt-1 space-y-0.5 pl-4 text-sm text-charcoal/75">
                      {q.answers.map((a, j) => (
                        <li key={j} className="flex items-baseline gap-2">
                          <span className="shrink-0 text-[11px] font-medium text-charcoal/40">1</span> {a}
                        </li>
                      ))}
                      <li className="flex items-baseline gap-2 text-charcoal/55">
                        <span className="shrink-0 text-[11px] font-medium text-charcoal/40">1</span> Acceptable
                        alternate response (please note)
                      </li>
                      <li className="flex items-baseline gap-2 text-charcoal/55">
                        <span className="shrink-0 text-[11px] font-medium text-charcoal/40">0</span> Unacceptable
                        response
                      </li>
                    </ul>
                  </li>
                ))}
              </ol>
            </article>
          )}
        </div>
      </div>
    </div>
  )
}

function TemplateForm({
  tpl,
  onSave,
  onCancel,
}: {
  tpl: InterviewTemplate
  onSave: (edits: InterviewTemplateEdits) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(tpl.name)
  const [audience, setAudience] = useState(tpl.audience)
  const [intro, setIntro] = useState(tpl.intro)
  // Answers edited as one-per-line text so a manager-level edit stays simple.
  const [questions, setQuestions] = useState<{ prompt: string; answersText: string }[]>(
    tpl.questions.map((q) => ({ prompt: q.prompt, answersText: q.answers.join('\n') })),
  )
  const [thresholds, setThresholds] = useState<InterviewThreshold[]>(tpl.thresholds)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function updateQuestion(i: number, patch: Partial<{ prompt: string; answersText: string }>) {
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  }

  async function submit() {
    const parsed: InterviewQuestion[] = questions
      .map((q) => ({
        prompt: q.prompt.trim(),
        answers: q.answersText
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
      }))
      .filter((q) => q.prompt && q.answers.length > 0)
    if (!name.trim() || parsed.length === 0) return
    setBusy(true)
    setErr(null)
    try {
      await onSave({
        name: name.trim(),
        audience: audience.trim(),
        intro: intro.trim(),
        questions: parsed,
        thresholds: thresholds
          .map((t) => ({ label: t.label.trim(), min: Number(t.min) || 0 }))
          .filter((t) => t.label),
      })
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-cg-orange/40 bg-cg-orange-soft/30 p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-charcoal/50">
        Edit — {tpl.name} (saves as v{tpl.version + 1}; recorded interviews keep the version they used)
      </p>
      <div className="mb-2 grid gap-2 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Interview name"
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        />
        <input
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="Audience (e.g. Back of House)"
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        />
      </div>
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-charcoal/50">
        Interviewer's opening script
      </label>
      <textarea
        value={intro}
        onChange={(e) => setIntro(e.target.value)}
        rows={6}
        className="mb-3 w-full rounded-md border border-surface-line bg-surface px-3 py-2 text-[13px] leading-relaxed"
      />

      <div className="space-y-3">
        {questions.map((q, i) => (
          <div key={i} className="rounded-md border border-surface-line bg-surface p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-charcoal/50">
                Question {i + 1}
              </span>
              <button
                onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                title="Remove question"
                className="text-charcoal/35 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              value={q.prompt}
              onChange={(e) => updateQuestion(i, { prompt: e.target.value })}
              rows={2}
              placeholder="Question prompt…"
              className="mb-1.5 w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
            />
            <label className="mb-0.5 block text-[11px] text-charcoal/50">
              Creditable answers — one per line, 1 point each (the alternate-response point is automatic)
            </label>
            <textarea
              value={q.answersText}
              onChange={(e) => updateQuestion(i, { answersText: e.target.value })}
              rows={Math.max(3, q.answersText.split('\n').length)}
              className="w-full rounded-md border border-surface-line bg-surface px-2 py-1.5 text-[13px] leading-relaxed"
            />
          </div>
        ))}
      </div>
      <button
        onClick={() => setQuestions((qs) => [...qs, { prompt: '', answersText: '' }])}
        className="mt-2 flex items-center gap-1.5 rounded-md border border-surface-line bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
      >
        <Plus className="h-3.5 w-3.5" /> Add question
      </button>

      <div className="mt-3">
        <label className="mb-1 block text-[11px] uppercase tracking-wide text-charcoal/50">
          Pass marks (minimum score per role)
        </label>
        <div className="space-y-1.5">
          {thresholds.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={t.label}
                onChange={(e) =>
                  setThresholds((ts) => ts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))
                }
                placeholder="Role (e.g. Cook)"
                className="min-w-48 rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
              />
              <input
                type="number"
                value={t.min}
                onChange={(e) =>
                  setThresholds((ts) => ts.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))
                }
                className="w-20 rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => setThresholds((ts) => ts.filter((_, j) => j !== i))}
                title="Remove"
                className="text-charcoal/35 hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setThresholds((ts) => [...ts, { label: '', min: 0 }])}
          className="mt-1.5 flex items-center gap-1.5 rounded-md border border-surface-line bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Add pass mark
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy || !name.trim()}
          className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save new version'}
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
