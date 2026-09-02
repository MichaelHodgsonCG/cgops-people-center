// Uniforms — grooming & uniform standards per brand and side of house (the
// documents applicants acknowledge as 'uniform_grooming'). Grouped by brand
// in the list because each restaurant brand has its own standard; more
// brands land by adding a document, no code change. Executive/admin edit in
// place; every save bumps the version and lands in the activity log.

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { PencilLine, Plus, Shirt } from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import { errText } from '../../lib/errText'
import { can, toPermissionUser } from '../../permissions'
import type { UserProfile } from '../../types'
import {
  fetchUniformStandards,
  saveUniformStandard,
  type UniformStandard,
  type UniformStandardEdits,
} from './api'

interface UniformsViewProps {
  session: Session
  profile: UserProfile | null
}

export function UniformsView({ session, profile }: UniformsViewProps) {
  const actor = actorFrom(profile, session)
  const user = profile ? toPermissionUser(profile) : null
  const canEdit = can(user, 'update', 'hiring')

  const [docs, setDocs] = useState<UniformStandard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = () => {
    fetchUniformStandards()
      .then(setDocs)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const selected = useMemo(() => docs.find((d) => d.id === selectedId) ?? null, [docs, selectedId])
  const brands = useMemo(() => {
    const order: string[] = []
    const byBrand = new Map<string, UniformStandard[]>()
    for (const d of docs) {
      if (!byBrand.has(d.brand)) {
        byBrand.set(d.brand, [])
        order.push(d.brand)
      }
      byBrand.get(d.brand)!.push(d)
    }
    return order.map((b) => ({ brand: b, docs: byBrand.get(b)! }))
  }, [docs])

  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading uniform standards…</p>

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Shirt className="h-5 w-5 text-cg-orange" /> Uniforms
          </h2>
          <p className="mt-1 text-sm text-charcoal/60">
            Grooming & uniform standards per brand and side of house — the documents applicants
            acknowledge when they apply. Every edit bumps the version and is logged.
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
            <Plus className="h-3.5 w-3.5" /> Add standard
          </button>
        )}
      </div>

      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {adding && canEdit && (
        <StandardForm
          doc={null}
          onCancel={() => setAdding(false)}
          onSave={async (edits) => {
            await saveUniformStandard(actor, null, edits)
            setAdding(false)
            load()
          }}
        />
      )}

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-3">
          {brands.length === 0 && (
            <p className="rounded-xl border border-surface-line bg-surface px-4 py-6 text-center text-sm text-charcoal/55">
              No uniform standards yet.
            </p>
          )}
          {brands.map((g) => (
            <div key={g.brand}>
              <p className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-charcoal/45">
                {g.brand}
              </p>
              <div className="flex flex-col gap-1">
                {g.docs.map((d) => (
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
                    <span className="block">{d.title}</span>
                    <span className={`block text-[11px] ${selectedId === d.id ? 'text-cg-orange/70' : 'text-charcoal/45'}`}>
                      {d.audience || 'All'} · {d.effective || '—'} · v{d.version}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div>
          {!selected ? (
            <p className="rounded-xl border border-surface-line bg-surface px-4 py-10 text-center text-sm text-charcoal/55">
              Pick a standard to read it.
            </p>
          ) : editing && canEdit ? (
            <StandardForm
              doc={selected}
              onCancel={() => setEditing(false)}
              onSave={async (edits) => {
                await saveUniformStandard(actor, selected, edits)
                setEditing(false)
                load()
              }}
            />
          ) : (
            <article className="rounded-xl border border-surface-line bg-surface p-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-surface-line pb-3">
                <div>
                  <h3 className="text-base font-semibold">{selected.title}</h3>
                  <p className="mt-0.5 text-xs text-charcoal/55">
                    {selected.brand} · {selected.audience || 'All Team Members'}
                    {selected.effective ? ` · ${selected.effective}` : ''}
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

function StandardForm({
  doc,
  onSave,
  onCancel,
}: {
  doc: UniformStandard | null
  onSave: (edits: UniformStandardEdits) => Promise<void>
  onCancel: () => void
}) {
  const [brand, setBrand] = useState(doc?.brand ?? '')
  const [audience, setAudience] = useState(doc?.audience ?? 'FOH')
  const [title, setTitle] = useState(doc?.title ?? '')
  const [effective, setEffective] = useState(doc?.effective ?? '')
  const [body, setBody] = useState(doc?.body ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!brand.trim() || !title.trim() || !body.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await onSave({
        brand: brand.trim(),
        audience: audience.trim(),
        title: title.trim(),
        effective: effective.trim(),
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
        {doc ? `Edit — ${doc.title} (saves as v${doc.version + 1})` : 'New uniform standard'}
      </p>
      <div className="mb-2 grid gap-2 sm:grid-cols-4">
        <input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Brand (e.g. Wildcraft)"
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        />
        <select
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        >
          <option value="FOH">FOH</option>
          <option value="BOH">BOH</option>
          <option value="Management">Management</option>
          <option value="">All / whole house</option>
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm sm:col-span-2"
        />
      </div>
      <input
        value={effective}
        onChange={(e) => setEffective(e.target.value)}
        placeholder="Effective (as printed, e.g. Feb 2026)"
        className="mb-2 w-full max-w-60 rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={22}
        placeholder="The full standard text…"
        className="w-full rounded-md border border-surface-line bg-surface px-3 py-2 font-mono text-[13px] leading-relaxed"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy || !brand.trim() || !title.trim() || !body.trim()}
          className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          {busy ? 'Saving…' : doc ? 'Save new version' : 'Add standard'}
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
