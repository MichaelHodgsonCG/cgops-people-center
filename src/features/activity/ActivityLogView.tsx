// Activity Log — admin-only viewer over the append-only audit trail
// (people_center_audit_log): who did what, when. Mutations from every
// feature land here via recordAudit; reads of restricted/relationship
// notes are audited by the database functions and show as 'view' rows.
// Access: nav + route are gated by the admin_area resource, and the
// table's RLS is admin-only regardless — other roles get zero rows.

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ScrollText } from 'lucide-react'
import type { UserProfile } from '../../types'
import {
  EMPTY_FILTER,
  PAGE_SIZE,
  fetchAuditPage,
  type AuditFilter,
  type AuditRow,
} from './api'

const ACTION_CLASS: Record<AuditRow['action'], string> = {
  create: 'bg-success/10 text-success',
  update: 'bg-info/10 text-info',
  delete: 'bg-danger/10 text-danger',
  view: 'bg-warning/10 text-warning',
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

interface ActivityLogViewProps {
  session: Session
  profile: UserProfile | null
}

export function ActivityLogView(_props: ActivityLogViewProps) {
  const [filter, setFilter] = useState<AuditFilter>(EMPTY_FILTER)
  // The filter the queries actually run with — follows `filter` after a
  // short debounce so typing doesn't fire a request per keystroke.
  const [applied, setApplied] = useState<AuditFilter>(EMPTY_FILTER)
  const [rows, setRows] = useState<AuditRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setApplied(filter), 300)
    return () => clearTimeout(t)
  }, [filter])

  useEffect(() => {
    let stale = false
    setLoading(true)
    setError(null)
    fetchAuditPage(applied, 0)
      .then((r) => {
        if (stale) return
        setRows(r.rows)
        setHasMore(r.hasMore)
      })
      .catch((e: Error) => !stale && setError(e.message))
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
  }, [applied])

  async function loadMore() {
    setLoadingMore(true)
    setError(null)
    try {
      const r = await fetchAuditPage(applied, rows.length)
      setRows((prev) => [...prev, ...r.rows])
      setHasMore(r.hasMore)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  const isFiltered = useMemo(
    () => Boolean(applied.action || applied.actor || applied.entityType || applied.search),
    [applied],
  )

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <ScrollText className="h-5 w-5 text-cg-orange" /> Activity Log
      </h2>
      <p className="mt-1 mb-4 text-sm text-charcoal/60">
        The append-only audit trail: every change made in People Center, and audited reads of
        sensitive notes. Admin-only.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-charcoal/50">Action</span>
          <select
            value={filter.action}
            onChange={(e) => setFilter((f) => ({ ...f, action: e.target.value }))}
            className="rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">All actions</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="view">View (audited reads)</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-charcoal/50">Who</span>
          <input
            value={filter.actor}
            onChange={(e) => setFilter((f) => ({ ...f, actor: e.target.value }))}
            placeholder="Anyone"
            className="w-40 rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-charcoal/50">What (type)</span>
          <input
            value={filter.entityType}
            onChange={(e) => setFilter((f) => ({ ...f, entityType: e.target.value }))}
            placeholder="person, note, gap…"
            className="w-40 rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-0.5 block text-[11px] uppercase tracking-wide text-charcoal/50">Search</span>
          <input
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            placeholder="Summary or name…"
            className="w-56 rounded-md border border-surface-line bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        {isFiltered && (
          <button
            onClick={() => setFilter(EMPTY_FILTER)}
            className="rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-muted"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-danger">Could not load the activity log: {error}</p>}
      {loading ? (
        <p className="text-sm text-charcoal/50">Loading activity…</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-surface-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-line text-xs uppercase tracking-wide text-charcoal/50">
                  <th className="px-4 py-3 font-medium whitespace-nowrap">When</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">What</th>
                  <th className="px-4 py-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-charcoal/50">
                      {isFiltered ? 'Nothing matches these filters.' : 'No activity recorded yet.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-b border-surface-line/60 align-top last:border-0">
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap text-charcoal/60">
                        {fmtWhen(r.created_at)}
                      </td>
                      <td className="px-4 py-2.5 font-medium">{r.actor_name}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${ACTION_CLASS[r.action]}`}
                        >
                          {r.action}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-charcoal/60">
                          {r.entity_type.replace(/_/g, ' ')}
                        </span>
                        {r.entity_label && <span className="ml-1.5">{r.entity_label}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-charcoal/60">{r.summary ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-charcoal/50">
            <span>
              Showing {rows.length} entr{rows.length === 1 ? 'y' : 'ies'}
              {isFiltered ? ' (filtered)' : ''}
            </span>
            {hasMore && (
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-md border border-surface-line px-3 py-1.5 text-xs font-medium hover:bg-surface-muted disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : `Load ${PAGE_SIZE} more`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
