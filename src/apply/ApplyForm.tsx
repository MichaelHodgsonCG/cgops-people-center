// The guided Team Member application (work order a1164da2, Phase 2 slice).
// Brand websites link here (…/apply, optionally ?location=<id>&position=<role>
// &source=indeed); managers preview it via ?preview=1 — preview never submits.
//
// SECURITY SHAPE: this page never touches the database. It reads its config
// (restaurants, roles + job descriptions, uniform standards) from the
// hiring-intake edge function's public GET and submits to its gated POST —
// while Michael's HIRING_INTAKE_ENABLED gate is off, submission returns a
// friendly "not open yet". The standard applies: complete IN FULL, never
// 'See Resume' — every step validates before Continue.

import { useEffect, useMemo, useRef, useState } from 'react'

const INTAKE_URL = 'https://qzzhifdwoixqjgugbevq.supabase.co/functions/v1/hiring-intake'

interface ConfigLocation {
  id: string
  name: string
  opening: boolean
  brand: string
}
interface ConfigPosition {
  role_title: string
  department: string
  reports_to: string
  body: string
}
interface ConfigUniform {
  brand: string
  audience: string
  title: string
  body: string
  effective: string
}
interface Config {
  enabled: boolean
  turnstile_site_key: string | null
  locations: ConfigLocation[]
  positions: ConfigPosition[]
  uniform_standards: ConfigUniform[]
}

interface Job {
  employer: string
  role: string
  from: string
  to: string
  reason_for_leaving: string
}
interface Reference {
  name: string
  relationship: string
  phone: string
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const SHIFTS = ['Days', 'Evenings'] as const

const STEPS = [
  'Restaurant & role',
  'Job description',
  'Uniform & grooming',
  'About you',
  'Eligibility & availability',
  'Work history',
  'References',
  'Review & submit',
] as const

const inputCls =
  'w-full rounded-md border border-surface-line bg-surface px-3 py-2 text-sm focus:border-cg-orange focus:outline-none'
const btnPrimary =
  'rounded-md bg-cg-orange px-4 py-2 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50'
const btnGhost =
  'rounded-md border border-surface-line px-4 py-2 text-sm text-charcoal/70 hover:bg-surface-muted disabled:opacity-50'

export function ApplyForm() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const preview = params.get('preview') === '1'

  const [config, setConfig] = useState<Config | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [stepError, setStepError] = useState<string | null>(null)

  // Selections + answers
  const [locationId, setLocationId] = useState(params.get('location') ?? '')
  const [position, setPosition] = useState(params.get('position') ?? '')
  const [ackJd, setAckJd] = useState(false)
  const [ackUniform, setAckUniform] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [workEligibility, setWorkEligibility] = useState('')
  const [minimumAge, setMinimumAge] = useState('')
  const [avail, setAvail] = useState<Record<string, boolean>>({})
  const [startDate, setStartDate] = useState('')
  const [hoursPerWeek, setHoursPerWeek] = useState('')
  const [availNotes, setAvailNotes] = useState('')
  const [jobs, setJobs] = useState<Job[]>([
    { employer: '', role: '', from: '', to: '', reason_for_leaving: '' },
  ])
  const [refs, setRefs] = useState<Reference[]>([
    { name: '', relationship: '', phone: '' },
    { name: '', relationship: '', phone: '' },
  ])

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(INTAKE_URL)
      .then((r) => {
        if (!r.ok) throw new Error('load')
        return r.json()
      })
      .then(setConfig)
      .catch(() =>
        setLoadError('The application form could not load. Please refresh, or visit the restaurant to apply in person.'),
      )
  }, [])

  const location = config?.locations.find((l) => l.id === locationId) ?? null
  const role = config?.positions.find((p) => p.role_title === position) ?? null
  const audience = role?.department === 'Kitchen' ? 'BOH' : 'FOH'
  const uniformDoc =
    config?.uniform_standards.find((u) => u.brand === location?.brand && u.audience === audience) ??
    null

  function go(next: number) {
    setStepError(null)
    setStep(next)
    topRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  function validate(): string | null {
    switch (step) {
      case 0:
        if (!locationId) return 'Please choose a restaurant.'
        if (!position) return 'Please choose a position.'
        return null
      case 1:
        if (!ackJd) return 'Please confirm you have read the job description.'
        return null
      case 2:
        if (!ackUniform) return 'Please confirm you have read the grooming & uniform standards.'
        return null
      case 3:
        if (!fullName.trim()) return 'Please enter your full name.'
        if (!email.trim() && !phone.trim()) return 'Please provide an email address or phone number.'
        if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
          return 'That email address does not look right.'
        return null
      case 4:
        if (!workEligibility) return 'Please answer the work-eligibility question.'
        if (!minimumAge) return 'Please answer the age question.'
        if (!Object.values(avail).some(Boolean)) return 'Please pick at least one day/shift you are available.'
        return null
      case 5: {
        const complete = jobs.filter((j) => j.employer.trim() && j.role.trim())
        if (complete.length === 0)
          return 'Please add at least one job (or volunteer/school experience) — the application must be completed in full.'
        return null
      }
      case 6: {
        const complete = refs.filter((r) => r.name.trim() && r.phone.trim())
        if (complete.length < 2) return 'Please provide at least two references with a name and phone number.'
        return null
      }
      default:
        return null
    }
  }

  function next() {
    const err = validate()
    if (err) {
      setStepError(err)
      return
    }
    go(step + 1)
  }

  async function submit() {
    if (preview) return
    setSubmitting(true)
    setSubmitError(null)
    const availability = {
      days: DAYS.flatMap((d) => SHIFTS.filter((s) => avail[`${d}|${s}`]).map((s) => `${d} ${s}`)),
      earliest_start: startDate,
      hours_per_week: hoursPerWeek,
      notes: availNotes.trim(),
    }
    const payload = {
      applicant: { full_name: fullName.trim(), email: email.trim(), phone: phone.trim() },
      application: {
        location_id: locationId,
        desired_position: position,
        source: params.get('source') === 'indeed' ? 'indeed' : 'website',
        form: {
          work_eligibility: workEligibility,
          minimum_age: minimumAge,
          availability,
          work_history: jobs.filter((j) => j.employer.trim() && j.role.trim()),
          references: refs.filter((r) => r.name.trim() && r.phone.trim()),
        },
      },
      acks: { job_description: true, uniform_grooming: true },
    }
    try {
      const r = await fetch(INTAKE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        setSubmitError(data.error ?? 'Something went wrong — please try again.')
        setSubmitting(false)
        return
      }
      setDone(true)
    } catch {
      setSubmitError('Could not reach the server — please check your connection and try again.')
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <Shell>
        <p className="rounded-xl border border-surface-line bg-surface px-4 py-8 text-center text-sm text-charcoal/70">
          {loadError}
        </p>
      </Shell>
    )
  }
  if (!config) {
    return (
      <Shell>
        <p className="py-16 text-center text-sm text-charcoal/50">Loading…</p>
      </Shell>
    )
  }
  if (done) {
    return (
      <Shell>
        <div className="rounded-xl border border-surface-line bg-surface px-5 py-10 text-center">
          <p className="text-lg font-semibold">Application received — thank you, {fullName.split(' ')[0]}!</p>
          <p className="mt-2 text-sm text-charcoal/65">
            The team at {location?.name} will review your application for {position} and be in touch.
          </p>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div ref={topRef} />
      {preview && (
        <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-center text-xs font-medium text-warning">
          PREVIEW — this is the applicant experience; submissions are disabled in preview.
        </p>
      )}

      {/* Progress */}
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide text-charcoal/45">
          Step {step + 1} of {STEPS.length}
        </p>
        <p className="text-base font-semibold">{STEPS[step]}</p>
        <div className="mt-2 flex gap-1">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-cg-orange' : 'bg-surface-line'}`}
            />
          ))}
        </div>
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-charcoal/65">
            Thanks for your interest in joining the Charcoal Group family. This takes about 10
            minutes — please complete every section in full.
          </p>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Which restaurant are you applying to?</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
              <option value="">— choose a restaurant —</option>
              {config.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.opening ? ' (opening soon)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Which position?</span>
            <select value={position} onChange={(e) => setPosition(e.target.value)} className={inputCls}>
              <option value="">— choose a position —</option>
              {config.positions.map((p) => (
                <option key={p.role_title} value={p.role_title}>
                  {p.role_title} — {p.department}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {step === 1 && role && (
        <div className="space-y-3">
          <p className="text-sm text-charcoal/65">
            Please read the job description for the {role.role_title} position before continuing.
          </p>
          <div className="max-h-96 overflow-y-auto rounded-md border border-surface-line bg-surface p-4">
            <p className="text-sm font-semibold">{role.role_title} — Job Description</p>
            <p className="mb-2 text-xs text-charcoal/55">
              Department: {role.department} · Reports to: {role.reports_to}
            </p>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal/80">{role.body}</div>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={ackJd} onChange={() => setAckJd((v) => !v)} className="mt-0.5" />
            I have read and understood the {role.role_title} job description.
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          {uniformDoc ? (
            <>
              <p className="text-sm text-charcoal/65">
                Every Team Member follows the grooming & uniform standards. Please read the standard
                for {location?.name} before continuing.
              </p>
              <div className="max-h-96 overflow-y-auto rounded-md border border-surface-line bg-surface p-4">
                <p className="text-sm font-semibold">{uniformDoc.title}</p>
                {uniformDoc.effective && (
                  <p className="mb-2 text-xs text-charcoal/55">{uniformDoc.effective}</p>
                )}
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal/80">
                  {uniformDoc.body}
                </div>
              </div>
            </>
          ) : (
            <p className="rounded-md border border-surface-line bg-surface px-4 py-4 text-sm text-charcoal/70">
              {location?.brand ?? 'This restaurant'} has grooming & uniform standards every Team
              Member follows — covering personal hygiene, hair, jewellery, and the issued uniform.
              The full document will be provided to you by the restaurant.
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={ackUniform}
              onChange={() => setAckUniform((v) => !v)}
              className="mt-0.5"
            />
            I have read the grooming & uniform standards{uniformDoc ? '' : ' summary'} and agree to
            follow them if hired.
          </label>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Full name</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} autoComplete="name" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} type="email" autoComplete="email" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} type="tel" autoComplete="tel" />
          </label>
          <p className="text-xs text-charcoal/50">Provide at least one way for us to reach you — both is best.</p>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <RadioGroup
            label="Are you legally eligible to work in Canada?"
            value={workEligibility}
            onChange={setWorkEligibility}
            options={['Yes', 'No']}
          />
          <RadioGroup
            label="Are you 18 years of age or older?"
            value={minimumAge}
            onChange={setMinimumAge}
            options={['Yes', 'No']}
            hint="Some positions (like Server and Bartender) require you to be 18+ with Smart Serve."
          />
          <div>
            <span className="mb-1 block text-sm font-medium">When are you available to work?</span>
            <div className="overflow-hidden rounded-md border border-surface-line">
              <table className="w-full text-center text-sm">
                <thead>
                  <tr className="bg-surface-muted text-xs uppercase tracking-wide text-charcoal/50">
                    <th className="px-2 py-1.5 text-left font-medium"> </th>
                    {DAYS.map((d) => (
                      <th key={d} className="px-1 py-1.5 font-medium">{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SHIFTS.map((s) => (
                    <tr key={s} className="border-t border-surface-line">
                      <td className="px-2 py-1.5 text-left text-xs text-charcoal/60">{s}</td>
                      {DAYS.map((d) => {
                        const k = `${d}|${s}`
                        return (
                          <td key={k} className="px-1 py-1.5">
                            <input
                              type="checkbox"
                              checked={!!avail[k]}
                              onChange={() => setAvail((a) => ({ ...a, [k]: !a[k] }))}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Earliest start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Hours per week you'd like</span>
              <input value={hoursPerWeek} onChange={(e) => setHoursPerWeek(e.target.value)} className={inputCls} placeholder="e.g. 25–35" />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Anything else about your availability? (optional)</span>
            <textarea value={availNotes} onChange={(e) => setAvailNotes(e.target.value)} rows={2} className={inputCls} />
          </label>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          <p className="text-sm text-charcoal/65">
            Tell us where you've worked — most recent first. Please complete this in full rather than
            referring to a resume. School or volunteer experience counts if this is your first job.
          </p>
          {jobs.map((j, i) => (
            <div key={i} className="rounded-md border border-surface-line bg-surface p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-charcoal/50">Job {i + 1}</span>
                {jobs.length > 1 && (
                  <button
                    onClick={() => setJobs((js) => js.filter((_, k) => k !== i))}
                    className="text-xs text-charcoal/40 hover:text-danger"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={j.employer} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, employer: e.target.value } : x)))} placeholder="Employer" className={inputCls} />
                <input value={j.role} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, role: e.target.value } : x)))} placeholder="Your role" className={inputCls} />
                <input value={j.from} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)))} placeholder="From (e.g. May 2024)" className={inputCls} />
                <input value={j.to} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, to: e.target.value } : x)))} placeholder="To (or 'present')" className={inputCls} />
              </div>
              <input
                value={j.reason_for_leaving}
                onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, reason_for_leaving: e.target.value } : x)))}
                placeholder="Reason for leaving"
                className={`${inputCls} mt-2`}
              />
            </div>
          ))}
          <button
            onClick={() => setJobs((js) => [...js, { employer: '', role: '', from: '', to: '', reason_for_leaving: '' }])}
            className={btnGhost}
          >
            + Add another job
          </button>
        </div>
      )}

      {step === 6 && (
        <div className="space-y-3">
          <p className="text-sm text-charcoal/65">
            Please give us at least two references — people who know your work, like a past manager,
            coach, or teacher.
          </p>
          {refs.map((r, i) => (
            <div key={i} className="rounded-md border border-surface-line bg-surface p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-charcoal/50">Reference {i + 1}</span>
                {refs.length > 2 && (
                  <button onClick={() => setRefs((rs) => rs.filter((_, k) => k !== i))} className="text-xs text-charcoal/40 hover:text-danger">
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <input value={r.name} onChange={(e) => setRefs((rs) => rs.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className={inputCls} />
                <input value={r.relationship} onChange={(e) => setRefs((rs) => rs.map((x, k) => (k === i ? { ...x, relationship: e.target.value } : x)))} placeholder="How they know you" className={inputCls} />
                <input value={r.phone} onChange={(e) => setRefs((rs) => rs.map((x, k) => (k === i ? { ...x, phone: e.target.value } : x)))} placeholder="Phone" className={inputCls} type="tel" />
              </div>
            </div>
          ))}
          <button onClick={() => setRefs((rs) => [...rs, { name: '', relationship: '', phone: '' }])} className={btnGhost}>
            + Add another reference
          </button>
        </div>
      )}

      {step === 7 && (
        <div className="space-y-3">
          <div className="rounded-md border border-surface-line bg-surface p-4 text-sm">
            <ReviewRow label="Applying to" value={`${position} — ${location?.name ?? ''}`} />
            <ReviewRow label="Name" value={fullName} />
            <ReviewRow label="Contact" value={[email, phone].filter(Boolean).join(' · ')} />
            <ReviewRow label="Eligible to work in Canada" value={workEligibility} />
            <ReviewRow label="18 or older" value={minimumAge} />
            <ReviewRow
              label="Availability"
              value={
                DAYS.flatMap((d) => SHIFTS.filter((s) => avail[`${d}|${s}`]).map((s) => `${d} ${s.toLowerCase()}`)).join(', ') +
                (startDate ? ` · from ${startDate}` : '') +
                (hoursPerWeek ? ` · ${hoursPerWeek} hrs/wk` : '')
              }
            />
            <ReviewRow
              label="Work history"
              value={jobs.filter((j) => j.employer.trim()).map((j) => `${j.role} at ${j.employer}`).join('; ')}
            />
            <ReviewRow
              label="References"
              value={refs.filter((r) => r.name.trim()).map((r) => r.name).join(', ')}
            />
            <ReviewRow label="Documents" value="Job description ✓ · Grooming & uniform standards ✓" />
          </div>
          {!config.enabled && !preview && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              Online applications are not open yet — submitting will let you know. You can always
              apply in person at the restaurant.
            </p>
          )}
          {submitError && <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{submitError}</p>}
        </div>
      )}

      {stepError && <p className="mt-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{stepError}</p>}

      <div className="mt-6 flex items-center justify-between">
        <button onClick={() => go(step - 1)} disabled={step === 0 || submitting} className={btnGhost}>
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button onClick={next} className={btnPrimary}>
            Continue
          </button>
        ) : preview ? (
          <span className="text-sm font-medium text-charcoal/50">Preview complete — submission disabled</span>
        ) : (
          <button onClick={() => void submit()} disabled={submitting} className={btnPrimary}>
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-muted px-4 py-6 text-charcoal sm:py-10">
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-5 text-center">
          <p className="text-xs uppercase tracking-widest text-charcoal/45">Charcoal Group</p>
          <h1 className="text-xl font-semibold">Join our team</h1>
        </header>
        <main className="rounded-2xl border border-surface-line bg-surface p-4 shadow-sm sm:p-6">{children}</main>
        <p className="mt-4 text-center text-[11px] text-charcoal/40">
          Your application is kept confidential and retained in line with employment legislation.
        </p>
      </div>
    </div>
  )
}

function RadioGroup({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  hint?: string
}) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <div className="flex gap-4">
        {options.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input type="radio" checked={value === o} onChange={() => onChange(o)} />
            {o}
          </label>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-charcoal/50">{hint}</p>}
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-surface-line/60 py-1.5 last:border-0">
      <span className="block text-[11px] uppercase tracking-wide text-charcoal/45">{label}</span>
      <span className="text-charcoal/85">{value || '—'}</span>
    </div>
  )
}
