// Watch List — the CG Black List (do not interview/hire/re-hire) and Grey
// List (proceed with caution), digitised from Meg's Aug 2026 workbook.
// HIGHLY SENSITIVE — Michael's ruling (2026-09-03): the full list lives in
// the ADMIN CENTER and is nav-gated AND RLS-gated to ADMIN ONLY. Nobody
// else ever reads a row: everyone with hiring access gets an anonymous
// yellow "check with admin" flag on matching applications (checkWatchlist,
// a security-definer name check), and can REPORT a new name through the
// submit-only form below (WatchlistReportView, in the Hiring section) —
// insert without read. Removal is soft (inactive): the record is history.

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Plus, Search, ShieldAlert } from 'lucide-react'
import { actorFrom } from '../../lib/activity'
import { errText } from '../../lib/errText'
import { toPermissionUser } from '../../permissions'
import type { UserProfile } from '../../types'
import {
  fetchWatchlist,
  removeWatchlistEntry,
  saveWatchlistEntry,
  type WatchlistEdits,
  type WatchlistEntry,
} from './api'

interface WatchlistViewProps {
  session: Session
  profile: UserProfile | null
}

export function WatchlistView({ session, profile }: WatchlistViewProps) {
  const actor = actorFrom(profile, session)
  const user = profile ? toPermissionUser(profile) : null
  const isHq = user?.role === 'admin'

  const [entries, setEntries] = useState<WatchlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => {
    fetchWatchlist()
      .then(setEntries)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        e.former_cg.toLowerCase().includes(q) ||
        e.notes.toLowerCase().includes(q),
    )
  }, [entries, query])

  if (!isHq) {
    return <p className="p-6 text-sm text-charcoal/55">The watch list is limited to admins.</p>
  }
  if (loading) return <p className="p-6 text-sm text-charcoal/50">Loading watch list…</p>

  async function remove(entry: WatchlistEntry) {
    if (!window.confirm(`Remove ${entry.full_name} from the ${entry.list === 'black' ? 'Black' : 'Grey'} List? The record is kept inactive for history.`)) return
    setBusy(true)
    try {
      await removeWatchlistEntry(actor, entry)
      load()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const groups: { kind: 'black' | 'grey'; label: string; blurb: string }[] = [
    { kind: 'black', label: 'The Black List', blurb: 'Do not interview. Do not hire. Do not re-hire.' },
    { kind: 'grey', label: 'The Grey List', blurb: 'Proceed with caution — read the notes first.' },
  ]

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldAlert className="h-5 w-5 text-danger" /> Hiring watch list
          </h2>
          <p className="mt-1 text-sm text-charcoal/60">
            Visible to admins only. Applications by a listed name show everyone else a yellow
            "check with admin" flag — never the notes, never which list. Anyone with hiring access
            can report a new name from the Hiring section; those reports land here. Also check Push
            reports for anyone marked "not eligible for rehire" (employee attribute report) or the
            ROE reason report.
          </p>
        </div>
        <button
          onClick={() => {
            setAdding(true)
            setEditingId(null)
          }}
          className="flex items-center gap-1.5 rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Add entry
        </button>
      </div>

      {error && <p className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {adding && (
        <EntryForm
          entry={null}
          onCancel={() => setAdding(false)}
          onSave={async (edits) => {
            await saveWatchlistEntry(actor, null, edits)
            setAdding(false)
            load()
          }}
        />
      )}

      <div className="mb-3 flex items-center gap-2">
        <Search className="h-4 w-4 text-charcoal/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, role, location, notes…"
          className="w-full max-w-md rounded-md border border-surface-line bg-surface px-2.5 py-1.5 text-sm"
        />
        <span className="text-xs text-charcoal/50">
          {visible.length} of {entries.length}
        </span>
      </div>

      {groups.map((g) => {
        const rows = visible.filter((e) => e.list === g.kind)
        if (rows.length === 0 && query) return null
        return (
          <section key={g.kind} className="mb-6">
            <h3 className={`text-sm font-semibold ${g.kind === 'black' ? 'text-danger' : 'text-warning'}`}>
              {g.label} <span className="font-normal text-charcoal/50">— {g.blurb}</span>
            </h3>
            <div className="mt-2 space-y-1.5">
              {rows.length === 0 && <p className="text-sm text-charcoal/45">No entries.</p>}
              {rows.map((e) =>
                editingId === e.id ? (
                  <EntryForm
                    key={e.id}
                    entry={e}
                    onCancel={() => setEditingId(null)}
                    onSave={async (edits) => {
                      await saveWatchlistEntry(actor, e, edits)
                      setEditingId(null)
                      load()
                    }}
                  />
                ) : (
                  <div key={e.id} className="rounded-md border border-surface-line bg-surface px-3 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">
                        {e.full_name}
                        <span className="ml-2 text-xs font-normal text-charcoal/55">
                          {e.role || '?'}
                          {e.former_cg && e.former_cg !== '-' ? ` · ${e.former_cg}` : ''}
                          {e.noted_date ? ` · ${e.noted_date}` : ''}
                          {e.noted_by ? ` · noted by ${e.noted_by}` : ''}
                        </span>
                      </p>
                      <span className="flex gap-2 text-xs">
                        <button onClick={() => setEditingId(e.id)} className="font-medium text-charcoal/50 hover:text-charcoal">
                          Edit
                        </button>
                        <button onClick={() => void remove(e)} disabled={busy} className="font-medium text-charcoal/40 hover:text-danger disabled:opacity-50">
                          Remove
                        </button>
                      </span>
                    </div>
                    {e.notes && <p className="mt-0.5 text-xs text-charcoal/70">{e.notes}</p>}
                  </div>
                ),
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// Submit-only reporting (Hiring section): anyone with hiring access can add
// a name to the watch list without ever reading a row back — RLS grants
// insert to the hiring roles while select stays admin-only. Admin reviews
// what lands.
export function WatchlistReportView({ session, profile }: WatchlistViewProps) {
  const actor = actorFrom(profile, session)
  const [done, setDone] = useState(false)

  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert className="h-5 w-5 text-warning" /> Report to the watch list
        </h2>
        <p className="mt-1 text-sm text-charcoal/60">
          Know someone we should not hire, or should be cautious about? Report them here — the
          report goes straight onto the admin-held watch list. You will not be able to see the
          list itself; a matching applicant will show every reviewer a yellow "check with admin"
          flag.
        </p>
      </div>

      {done ? (
        <div className="rounded-xl border border-success/40 bg-success/5 px-4 py-6 text-center">
          <p className="text-sm font-medium text-success">Reported — thank you.</p>
          <p className="mt-1 text-sm text-charcoal/65">
            Admin can see your report, and any application under that name will now carry the
            caution flag.
          </p>
          <button
            onClick={() => setDone(false)}
            className="mt-3 rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            Report another name
          </button>
        </div>
      ) : (
        <EntryForm
          entry={null}
          reportMode
          defaultNotedBy={actor.name}
          onCancel={() => setDone(false)}
          onSave={async (edits) => {
            await saveWatchlistEntry(actor, null, edits)
            setDone(true)
          }}
        />
      )}
    </div>
  )
}

function EntryForm({
  entry,
  onSave,
  onCancel,
  reportMode,
  defaultNotedBy,
}: {
  entry: WatchlistEntry | null
  onSave: (edits: WatchlistEdits) => Promise<void>
  onCancel: () => void
  /** Submit-only reporting: hides the cancel button's "editing" framing and
   * keeps who-reported attribution fixed. */
  reportMode?: boolean
  defaultNotedBy?: string
}) {
  const [list, setList] = useState<'black' | 'grey'>(entry?.list ?? 'black')
  const [fullName, setFullName] = useState(entry?.full_name ?? '')
  const [role, setRole] = useState(entry?.role ?? '')
  const [formerCg, setFormerCg] = useState(entry?.former_cg ?? '')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const [notedDate, setNotedDate] = useState(entry?.noted_date ?? '')
  const [notedBy, setNotedBy] = useState(entry?.noted_by ?? defaultNotedBy ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!fullName.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await onSave({
        list,
        full_name: fullName.trim(),
        role: role.trim(),
        former_cg: formerCg.trim(),
        notes: notes.trim(),
        noted_date: notedDate.trim(),
        noted_by: notedBy.trim(),
      })
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  return (
    <div className="mb-3 rounded-md border border-cg-orange/40 bg-cg-orange-soft/30 p-3">
      <div className="mb-2 grid gap-2 sm:grid-cols-3">
        <select
          value={list}
          onChange={(e) => setList(e.target.value as 'black' | 'grey')}
          className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
        >
          <option value="black">Black List — do not hire</option>
          <option value="grey">Grey List — proceed with caution</option>
        </select>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm" />
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm" />
        <input value={formerCg} onChange={(e) => setFormerCg(e.target.value)} placeholder="Former CG Mgr/TM? (e.g. BTW)" className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm" />
        <input value={notedDate} onChange={(e) => setNotedDate(e.target.value)} placeholder="When (e.g. Summer 2023)" className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm" />
        <input value={notedBy} onChange={(e) => setNotedBy(e.target.value)} placeholder="Noted by" className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm" />
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        placeholder="Notes — why, and who to see for more"
        className="w-full rounded-md border border-surface-line bg-surface px-2.5 py-1.5 text-sm"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => void submit()}
          disabled={busy || !fullName.trim()}
          className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
        >
          {busy ? 'Saving…' : reportMode ? 'Report to watch list' : entry ? 'Save' : 'Add entry'}
        </button>
        {!reportMode && (
          <button onClick={onCancel} disabled={busy} className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted">
            Cancel
          </button>
        )}
        {err && <p className="text-xs text-danger">{err}</p>}
      </div>
    </div>
  )
}
