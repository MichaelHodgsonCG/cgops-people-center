// Management Hiring — the CG Mgmt Interview Process (Mar 2026), one document
// per step: culture/values interview, reference checks, the tiered financial
// interviews with the Gourmet Haven case study + P&L, TAIS, final interview,
// offer presentation. Readable by manager altitude and up (RLS enforces);
// executive/admin edit in place, version bump + activity log on every save.

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Briefcase, PencilLine } from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import { errText } from '../../lib/errText'
import { can, toPermissionUser } from '../../permissions'
import type { UserProfile } from '../../types'
import { fetchHiringGuides, saveHiringGuide, type HiringGuide, type HiringGuideEdits } from './api'

interface MgmtProcessViewProps {
  session: Session
  profile: UserProfile | null
  /** Hiring-section reference mode: same rows, no editing — the editors live in the Admin Center (spec 3f10f057). */
  readOnly?: boolean
}

export function MgmtProcessView({ session, profile, readOnly }: MgmtProcessViewProps) {
  const actor = actorFrom(profile, session)
  const user = profile ? toPermissionUser(profile) : null
  const canEdit = !readOnly && can(user, 'update', 'hiring')

  const [guides, setGuides] = useState<HiringGuide[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const load = () => {
    fetchHiringGuides()
      .then(setGuides)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const selected = useMemo(() => guides.find((g) => g.id === selectedId) ?? null, [guides, selectedId])

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading management hiring process…</p>

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Briefcase className="h-5 w-5 text-cg-orange" /> Management hiring process
        </h2>
        <p className="mt-1 text-sm text-charcoal/60">
          The CG management interview process, step by step — culture interview, reference checks,
          the financial interview for the role tier, TAIS where it applies, final interview, and
          the offer. Work the steps in order; every step ends with a proceed / stop decision.
        </p>
      </div>

      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-1">
          {guides.map((g) => (
            <button
              key={g.id}
              onClick={() => {
                setSelectedId(g.id)
                setEditing(false)
              }}
              aria-current={selectedId === g.id ? 'true' : undefined}
              className={`rounded-md px-3 py-2 text-left text-sm ${
                selectedId === g.id
                  ? 'bg-cg-orange-soft font-medium text-cg-orange'
                  : 'border border-surface-line bg-surface text-charcoal/75 hover:bg-surface-muted'
              }`}
            >
              <span className="block">{g.title}</span>
              {g.subtitle && (
                <span className={`block text-[11px] ${selectedId === g.id ? 'text-cg-orange/70' : 'text-charcoal/45'}`}>
                  {g.subtitle}
                </span>
              )}
            </button>
          ))}
        </div>

        <div>
          {!selected ? (
            <p className="rounded-xl border border-surface-line bg-surface px-4 py-10 text-center text-sm text-charcoal/55">
              Pick a step to read it.
            </p>
          ) : editing && canEdit ? (
            <GuideForm
              guide={selected}
              onCancel={() => setEditing(false)}
              onSave={async (edits) => {
                await saveHiringGuide(actor, selected, edits)
                setEditing(false)
                load()
              }}
            />
          ) : (
            <article className="rounded-xl border border-surface-line bg-surface p-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-surface-line pb-3">
                <div>
                  <h3 className="text-base font-semibold">{selected.title}</h3>
                  {selected.subtitle && <p className="mt-0.5 text-xs text-charcoal/55">{selected.subtitle}</p>}
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
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal/85">{selected.body}</div>
            </article>
          )}
        </div>
      </div>
    </div>
  )
}

function GuideForm({
  guide,
  onSave,
  onCancel,
}: {
  guide: HiringGuide
  onSave: (edits: HiringGuideEdits) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState(guide.title)
  const [subtitle, setSubtitle] = useState(guide.subtitle)
  const [sort, setSort] = useState(guide.sort)
  const [body, setBody] = useState(guide.body)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!title.trim() || !body.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await onSave({ title: title.trim(), subtitle: subtitle.trim(), sort, body: body.trim() })
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-cg-orange/40 bg-cg-orange-soft/30 p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-charcoal/50">
        Edit — {guide.title} (saves as v{guide.version + 1})
      </p>
      <div className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_90px]">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm" />
        <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Subtitle (who / when)" className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm" />
        <input
          type="number"
          value={sort}
          onChange={(e) => setSort(Number(e.target.value))}
          title="Order"
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={24}
        className="w-full rounded-md border border-surface-line bg-surface px-3 py-2 font-mono text-[13px] leading-relaxed"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy || !title.trim() || !body.trim()}
          className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save new version'}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted">
          Cancel
        </button>
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </div>
  )
}
