// Searchable person typeahead — Menu Center's launch-task owner pattern: pick
// a roster person (stores name + person id) or type any free-text name for an
// outside party (stores name only). Typing a name that exactly matches one
// roster person auto-links on blur.

import { useEffect, useRef, useState } from 'react'
import { Link2 } from 'lucide-react'

export interface PickedPerson {
  name: string
  personId: string | null
}

export interface PickerPerson {
  id: string
  full_name: string
}

export function PersonPicker({
  people,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  people: PickerPerson[]
  value: PickedPerson
  onChange: (v: PickedPerson) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const q = value.name.trim().toLowerCase()
  const matches =
    q.length === 0
      ? []
      : people.filter((p) => p.full_name.toLowerCase().includes(q)).slice(0, 8)

  function commitText() {
    // Exact (case-insensitive) match to one roster person → auto-link.
    const exact = people.filter((p) => p.full_name.trim().toLowerCase() === q)
    if (q && !value.personId && exact.length === 1) {
      onChange({ name: exact[0].full_name, personId: exact[0].id })
    }
  }

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-1">
        <input
          value={value.name}
          disabled={disabled}
          placeholder={placeholder ?? 'Name…'}
          onChange={(e) => {
            onChange({ name: e.target.value, personId: null })
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => commitText()}
          className="w-full rounded-md border border-surface-line bg-surface px-2 py-1 text-sm disabled:opacity-60"
        />
        {value.personId && (
          <Link2 className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Linked to a person record" />
        )}
      </div>
      {open && !disabled && matches.length > 0 && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-56 w-full min-w-48 overflow-auto rounded-md border border-surface-line bg-surface py-1 shadow-lg">
          {matches.map((p) => (
            <button
              key={p.id}
              // mousedown, not click — fire before the input's blur handler
              onMouseDown={(e) => {
                e.preventDefault()
                onChange({ name: p.full_name, personId: p.id })
                setOpen(false)
              }}
              className={`block w-full px-2.5 py-1.5 text-left text-sm hover:bg-surface-muted ${
                p.id === value.personId ? 'font-medium text-cg-orange' : ''
              }`}
            >
              {p.full_name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
