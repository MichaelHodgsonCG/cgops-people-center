// Per-seat owner/support editor for one gap cell (location × role-or-pool) —
// Menu Center's launch-task owner model: each open seat gets its own OWNER
// (responsible for filling it), SUPPORT, target date, and note. A gap of 3
// Sous = seats 1..3, each independently owned ("Chef hires the Sous, ROL
// supports"). Read-only for gap viewers without edit rights.

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { errText } from '../../lib/errText'
import type { Actor } from '../../lib/activity'
import { PersonPicker, type PickedPerson, type PickerPerson } from '../../components/PersonPicker'
import {
  deleteGapAssignment,
  saveGapAssignment,
  type GapAssignment,
} from './api'

export interface SeatCell {
  locationId: string
  locationName: string
  kind: 'role' | 'group'
  positionId: string | null // role cells
  groupName: string | null // pool cells (assignments key on the pool name)
  roleLabel: string
  gap: number
  neededBy: string | null
}

interface SeatEdit {
  id: string | null
  owner: PickedPerson
  support: PickedPerson
  targetDate: string // '' = none
  note: string
}

const blankSeat = (): SeatEdit => ({
  id: null,
  owner: { name: '', personId: null },
  support: { name: '', personId: null },
  targetDate: '',
  note: '',
})

const isBlank = (s: SeatEdit) =>
  !s.owner.name.trim() && !s.support.name.trim() && !s.targetDate && !s.note.trim()

export function SeatOwnersPanel({
  actor,
  canEdit,
  cell,
  assignments,
  people,
  onClose,
  onSaved,
}: {
  actor: Actor
  canEdit: boolean
  cell: SeatCell
  assignments: GapAssignment[]
  people: PickerPerson[]
  onClose: () => void
  onSaved: () => void
}) {
  // Show a row per open seat, plus any already-assigned seats beyond the gap
  // (the gap may have shrunk since they were assigned).
  const seatCount = Math.max(cell.gap, ...assignments.map((a) => a.seat_index), 1)

  const initial = useMemo<SeatEdit[]>(() => {
    const byIndex = new Map(assignments.map((a) => [a.seat_index, a]))
    return Array.from({ length: seatCount }, (_, i) => {
      const a = byIndex.get(i + 1)
      if (!a) return blankSeat()
      return {
        id: a.id,
        owner: { name: a.owner_name, personId: a.owner_person_id },
        support: { name: a.support_name, personId: a.support_person_id },
        targetDate: a.target_date ?? '',
        note: a.note,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [seats, setSeats] = useState<SeatEdit[]>(initial)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function patch(i: number, p: Partial<SeatEdit>) {
    setSeats((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)))
  }

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      for (let i = 0; i < seats.length; i++) {
        const s = seats[i]
        const label = `${cell.roleLabel} — ${cell.locationName} (seat ${i + 1})`
        if (isBlank(s)) {
          if (s.id) await deleteGapAssignment(actor, s.id, label)
          continue
        }
        const orig = initial[i]
        const changed =
          s.id === null ||
          s.owner.name !== orig.owner.name ||
          s.owner.personId !== orig.owner.personId ||
          s.support.name !== orig.support.name ||
          s.support.personId !== orig.support.personId ||
          s.targetDate !== orig.targetDate ||
          s.note !== orig.note
        if (!changed) continue
        await saveGapAssignment(
          actor,
          {
            id: s.id ?? undefined,
            locationId: cell.locationId,
            positionId: cell.kind === 'role' ? cell.positionId : null,
            groupName: cell.kind === 'group' ? cell.groupName : null,
            seatIndex: i + 1,
            ownerPersonId: s.owner.personId,
            ownerName: s.owner.name.trim(),
            supportPersonId: s.support.personId,
            supportName: s.support.name.trim(),
            targetDate: s.targetDate || null,
            note: s.note.trim(),
          },
          label,
        )
      }
      onSaved()
      onClose()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-charcoal/40 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-surface-line bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">
              {cell.roleLabel} — {cell.locationName}
            </h3>
            <p className="mt-0.5 text-xs text-charcoal/55">
              {cell.gap} open seat{cell.gap === 1 ? '' : 's'}
              {cell.neededBy ? ` · needed by ${cell.neededBy}` : ''} · Owner = responsible for
              filling the seat; Support = helping. Pick a person or type any name.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-charcoal/50 hover:text-charcoal">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          {seats.map((s, i) => (
            <div key={i} className="rounded-lg border border-surface-line p-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-charcoal/45">
                Seat {i + 1}
                {i + 1 > cell.gap && (
                  <span className="ml-1.5 rounded-full bg-success/10 px-1.5 py-0.5 text-[10px] font-medium normal-case text-success">
                    filled — gap has closed for this seat
                  </span>
                )}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-0.5 block text-[11px] text-charcoal/50">Owner</span>
                  <PersonPicker
                    people={people}
                    value={s.owner}
                    onChange={(v) => patch(i, { owner: v })}
                    placeholder="Who fills this seat?"
                    disabled={!canEdit}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-0.5 block text-[11px] text-charcoal/50">Support</span>
                  <PersonPicker
                    people={people}
                    value={s.support}
                    onChange={(v) => patch(i, { support: v })}
                    placeholder="Who supports?"
                    disabled={!canEdit}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-0.5 block text-[11px] text-charcoal/50">Target date</span>
                  <input
                    type="date"
                    value={s.targetDate}
                    disabled={!canEdit}
                    onChange={(e) => patch(i, { targetDate: e.target.value })}
                    className="w-full rounded-md border border-surface-line bg-surface px-2 py-1 text-sm disabled:opacity-60"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-0.5 block text-[11px] text-charcoal/50">Goal / note</span>
                  <input
                    value={s.note}
                    disabled={!canEdit}
                    placeholder="e.g. internal promote preferred"
                    onChange={(e) => patch(i, { note: e.target.value })}
                    className="w-full rounded-md border border-surface-line bg-surface px-2 py-1 text-sm disabled:opacity-60"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-surface-line px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && (
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-md bg-cg-orange px-3 py-1.5 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save owners'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
