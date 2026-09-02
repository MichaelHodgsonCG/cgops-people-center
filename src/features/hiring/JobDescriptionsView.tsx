// Job Descriptions — the digital home of the documents applicants must
// acknowledge in the TM hiring flow. Seeded from the 2017 CG description
// PDFs; anyone with hiring access can read, executive/admin edit in place
// (each save bumps the version and lands in the activity log). The public
// intake form will serve these same documents to applicants via the edge
// function when it goes live.

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BookOpenText, PencilLine, Plus } from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import { errText } from '../../lib/errText'
import { can, toPermissionUser } from '../../permissions'
import type { UserProfile } from '../../types'
import {
  fetchJobDescriptions,
  saveJobDescription,
  type JobDescription,
  type JobDescriptionEdits,
} from './api'

interface JobDescriptionsViewProps {
  session: Session
  profile: UserProfile | null
}

export function JobDescriptionsView({ session, profile }: JobDescriptionsViewProps) {
  const actor = actorFrom(profile, session)
  const user = profile ? toPermissionUser(profile) : null
  const canEdit = can(user, 'update', 'hiring')

  const [docs, setDocs] = useState<JobDescription[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = () => {
    fetchJobDescriptions()
      .then(setDocs)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const selected = useMemo(
    () => docs.find((d) => d.id === selectedId) ?? null,
    [docs, selectedId],
  )

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading job descriptions…</p>

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <BookOpenText className="h-5 w-5 text-cg-orange" /> Job descriptions
          </h2>
          <p className="mt-1 text-sm text-charcoal/60">
            The documents applicants acknowledge when they apply. One per role, company-wide —
            every edit bumps the version and is logged.
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => {
              setAdding(true)
              setSelectedId(null)
              setEditing(false)
            }}
            className="flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
          >
            <Plus className="h-3.5 w-3.5" /> Add description
          </button>
        )}
      </div>

      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {adding && canEdit && (
        <DescriptionForm
          doc={null}
          onCancel={() => setAdding(false)}
          onSave={async (edits) => {
            await saveJobDescription(actor, null, edits)
            setAdding(false)
            load()
          }}
        />
      )}

      <div className="grid gap-4 md:grid-cols-[240px_1fr]">
        {/* Role list */}
        <div className="flex flex-col gap-1">
          {docs.length === 0 && (
            <p className="rounded-xl border border-surface-line bg-surface px-4 py-6 text-center text-sm text-charcoal/55">
              No job descriptions yet.
            </p>
          )}
          {docs.map((d) => (
            <button
              key={d.id}
              onClick={() => {
                setSelectedId(d.id)
                setEditing(false)
                setAdding(false)
              }}
              aria-current={selectedId === d.id ? 'true' : undefined}
              className={`rounded-md px-3 py-2 text-left text-sm ${
                selectedId === d.id
                  ? 'bg-cg-orange-soft font-medium text-cg-orange'
                  : 'border border-surface-line bg-surface text-charcoal/75 hover:bg-surface-muted'
              }`}
            >
              <span className="block">{d.role_title}</span>
              <span className={`block text-[11px] ${selectedId === d.id ? 'text-cg-orange/70' : 'text-charcoal/45'}`}>
                {d.department} · v{d.version}
              </span>
            </button>
          ))}
        </div>

        {/* Document */}
        <div>
          {!selected ? (
            <p className="rounded-xl border border-surface-line bg-surface px-4 py-10 text-center text-sm text-charcoal/55">
              Pick a role to read its job description.
            </p>
          ) : editing && canEdit ? (
            <DescriptionForm
              doc={selected}
              onCancel={() => setEditing(false)}
              onSave={async (edits) => {
                await saveJobDescription(actor, selected, edits)
                setEditing(false)
                load()
              }}
            />
          ) : (
            <article className="rounded-xl border border-surface-line bg-surface p-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-surface-line pb-3">
                <div>
                  <h3 className="text-base font-semibold">{selected.role_title} — Job Description</h3>
                  <p className="mt-0.5 text-xs text-charcoal/55">
                    Department: {selected.department || '—'} · Reports to: {selected.reports_to || '—'}
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
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal/85">
                {selected.body}
              </div>
            </article>
          )}
        </div>
      </div>
    </div>
  )
}

function DescriptionForm({
  doc,
  onSave,
  onCancel,
}: {
  doc: JobDescription | null
  onSave: (edits: JobDescriptionEdits) => Promise<void>
  onCancel: () => void
}) {
  const [roleTitle, setRoleTitle] = useState(doc?.role_title ?? '')
  const [department, setDepartment] = useState(doc?.department ?? '')
  const [reportsTo, setReportsTo] = useState(doc?.reports_to ?? '')
  const [body, setBody] = useState(doc?.body ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!roleTitle.trim() || !body.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await onSave({
        role_title: roleTitle.trim(),
        department: department.trim(),
        reports_to: reportsTo.trim(),
        body: body.trim(),
      })
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-cg-orange/40 bg-cg-orange-soft/30 p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-charcoal/50">
        {doc ? `Edit — ${doc.role_title} (saves as v${doc.version + 1})` : 'New job description'}
      </p>
      <div className="mb-2 grid gap-2 sm:grid-cols-3">
        <input
          value={roleTitle}
          onChange={(e) => setRoleTitle(e.target.value)}
          placeholder="Role title (e.g. Server)"
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        />
        <input
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          placeholder="Department"
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        />
        <input
          value={reportsTo}
          onChange={(e) => setReportsTo(e.target.value)}
          placeholder="Reports to"
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={22}
        placeholder="The full job description text…"
        className="w-full rounded-md border border-surface-line bg-surface px-3 py-2 font-mono text-[13px] leading-relaxed"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy || !roleTitle.trim() || !body.trim()}
          className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          {busy ? 'Saving…' : doc ? 'Save new version' : 'Add description'}
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
