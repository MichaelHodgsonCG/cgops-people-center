// The guided Team Member application (work order a1164da2, Phase 2 slice),
// carrying the FULL official CG Application for Employment (V.2026.01):
// every question on the paper form has a home here — multi-role selection,
// address & phones, minimum pay, affiliated-restaurant history, work rights,
// legal age to serve + Smart Serve, PT/FT & seasonal/permanent, the per-day
// CAN-work grid with earliest-in/latest-out, holidays/training/transport,
// last-3-jobs work history with supervisor + may-we-contact, personal
// references, essential functions, how-did-you-hear, and the signed
// declaration (which itself states the 3-year retention).
//
// Brand websites link here (…/apply, optionally ?location=<id>&position=<role>
// &source=indeed); managers preview via ?preview=1 — preview never submits.
//
// SECURITY SHAPE: this page never touches the database. It reads config
// (restaurants, roles + job descriptions, uniform standards) from the
// hiring-intake edge function's public GET and submits to its gated POST —
// while HIRING_INTAKE_ENABLED is off, submission returns a friendly "not
// open yet". The standard applies: complete IN FULL, never 'See Resume' —
// every step validates before Continue.

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
  company: string
  address: string
  position_duties: string
  supervisor: string
  supervisor_phone: string
  may_contact: string
  from: string
  to: string
  hours_per_week: string
  reason_for_leaving: string
  weekly_earnings: string
}
interface Reference {
  name: string
  phone: string
  years_known: string
  relationship: string
}
interface DayAvail {
  can: boolean
  earliest: string
  latest: string
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const AFFILIATED =
  "Moose Winooski's, Charcoal Steak House, Martini's, dels, The Bauer Kitchen, The Bauer Bakery, Wildcraft, Wildcraft Wherever, Beertown Public House, Sociable Kitchen + Tavern, Solé"

const DECLARATION =
  'I declare that I am qualified to perform all the duties of the position that I am seeking. I also declare that the information I have provided on this application is correct and that any false statements or omissions will justify my rejection or dismissal. I authorize the company to contact any of my previous employers as well as any reference source to verify the facts and information that I have furnished regarding my experience, qualifications and character. I authorize any person(s) having knowledge to provide such information in good faith. I authorize The Charcoal Group and its agents to verify any information related to my application or resume. I understand that my application will remain on file for 3 years in accordance with Employment Standards Legislation.'

const STEPS = [
  'Restaurant & positions',
  'Job description',
  'Uniform & grooming',
  'About you',
  'Eligibility',
  'Availability & pay',
  'Work history',
  'References',
  'Declaration & submit',
] as const

const emptyJob = (): Job => ({
  company: '',
  address: '',
  position_duties: '',
  supervisor: '',
  supervisor_phone: '',
  may_contact: '',
  from: '',
  to: '',
  hours_per_week: '',
  reason_for_leaving: '',
  weekly_earnings: '',
})

const inputCls =
  'w-full rounded-md border border-surface-line bg-surface px-3 py-2 text-sm focus:border-cg-orange focus:outline-none'
const btnPrimary =
  'rounded-md bg-cg-orange px-4 py-2 text-sm font-medium text-white hover:bg-cg-orange-hover disabled:opacity-50'
const btnGhost =
  'rounded-md border border-surface-line px-4 py-2 text-sm text-charcoal/70 hover:bg-surface-muted disabled:opacity-50'
const btnSmall =
  'rounded-md border border-surface-line px-2.5 py-1.5 text-xs font-medium text-charcoal/70 hover:bg-surface-muted'

export function ApplyForm() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const preview = params.get('preview') === '1'

  const [config, setConfig] = useState<Config | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [stepError, setStepError] = useState<string | null>(null)

  // Step 0 — restaurant & positions (multi-select + Other)
  const [locationId, setLocationId] = useState(params.get('location') ?? '')
  const [roles, setRoles] = useState<string[]>(() => {
    const p = params.get('position')
    return p ? [p] : []
  })
  const [otherRole, setOtherRole] = useState('')

  // Steps 1–2 — document acknowledgements
  const [ackJd, setAckJd] = useState(false)
  const [ackUniform, setAckUniform] = useState(false)

  // Step 3 — about you
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [street, setStreet] = useState('')
  const [apt, setApt] = useState('')
  const [city, setCity] = useState('')
  const [province, setProvince] = useState('')
  const [postal, setPostal] = useState('')
  const [dayPhone, setDayPhone] = useState('')
  const [eveningPhone, setEveningPhone] = useState('')
  const [altPhone, setAltPhone] = useState('')
  const [email, setEmail] = useState('')

  // Step 4 — eligibility
  const [legalRight, setLegalRight] = useState('')
  const [canProveRight, setCanProveRight] = useState('')
  const [legalAgeAlcohol, setLegalAgeAlcohol] = useState('')
  const [canProveAge, setCanProveAge] = useState('')
  const [smartServe, setSmartServe] = useState('')
  const [smartServeNo, setSmartServeNo] = useState('')
  const [essentialFunctions, setEssentialFunctions] = useState('')
  const [everAffiliated, setEverAffiliated] = useState('')
  const [affiliatedWhere, setAffiliatedWhere] = useState('')
  const [affiliatedManager, setAffiliatedManager] = useState('')

  // Step 5 — availability & pay
  const [dateAvailable, setDateAvailable] = useState('')
  const [employmentType, setEmploymentType] = useState('')
  const [seasonalPermanent, setSeasonalPermanent] = useState('')
  const [minPayHour, setMinPayHour] = useState('')
  const [minPayWeek, setMinPayWeek] = useState('')
  const [days, setDays] = useState<Record<string, DayAvail>>(() =>
    Object.fromEntries(DAYS.map((d) => [d, { can: false, earliest: '', latest: '' }])),
  )
  const [holidaysWeekends, setHolidaysWeekends] = useState('')
  const [trainingFlexible, setTrainingFlexible] = useState('')
  const [transportation, setTransportation] = useState('')
  const [hasJobToKeep, setHasJobToKeep] = useState('')
  const [jobsLastTwoYears, setJobsLastTwoYears] = useState('')
  const [jobsTerminated, setJobsTerminated] = useState('')
  const [commitments, setCommitments] = useState('')

  // Steps 6–7 — work history & references
  const [jobs, setJobs] = useState<Job[]>([emptyJob()])
  const [refs, setRefs] = useState<Reference[]>([
    { name: '', phone: '', years_known: '', relationship: '' },
    { name: '', phone: '', years_known: '', relationship: '' },
  ])

  // Step 8 — how heard + declaration
  const [howHeard, setHowHeard] = useState('')
  const [declAgreed, setDeclAgreed] = useState(false)
  const [signedName, setSignedName] = useState('')

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
  const selectedRoles = useMemo(
    () => (config ? config.positions.filter((p) => roles.includes(p.role_title)) : []),
    [config, roles],
  )
  const audiences = useMemo(() => {
    const a = new Set<string>()
    for (const r of selectedRoles) a.add(r.department === 'Kitchen' ? 'BOH' : 'FOH')
    if (a.size === 0 && otherRole.trim()) a.add('FOH')
    return [...a]
  }, [selectedRoles, otherRole])
  const uniformDocs = useMemo(
    () =>
      (config?.uniform_standards ?? []).filter(
        (u) => u.brand === location?.brand && audiences.includes(u.audience),
      ),
    [config, location, audiences],
  )
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()
  const positionText = [...roles, otherRole.trim() ? `Other: ${otherRole.trim()}` : '']
    .filter(Boolean)
    .join(', ')

  function toggleRole(r: string) {
    setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]))
  }

  function setDay(d: string, patch: Partial<DayAvail>) {
    setDays((ds) => ({ ...ds, [d]: { ...ds[d], ...patch } }))
  }

  function selectAllDays() {
    setDays((ds) => Object.fromEntries(DAYS.map((d) => [d, { ...ds[d], can: true }])))
  }

  function copyTimesToChecked() {
    const first = DAYS.map((d) => days[d]).find((v) => v.can && (v.earliest || v.latest))
    if (!first) return
    setDays((ds) =>
      Object.fromEntries(
        DAYS.map((d) => [
          d,
          ds[d].can ? { ...ds[d], earliest: first.earliest, latest: first.latest } : ds[d],
        ]),
      ),
    )
  }

  function go(next: number) {
    setStepError(null)
    setStep(next)
    topRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  function validate(): string | null {
    switch (step) {
      case 0:
        if (!locationId) return 'Please choose a restaurant.'
        if (roles.length === 0 && !otherRole.trim())
          return 'Please choose at least one position (or fill in Other).'
        return null
      case 1:
        if (!ackJd) return 'Please confirm you have read the job description(s).'
        return null
      case 2:
        if (!ackUniform) return 'Please confirm you have read the grooming & uniform standards.'
        return null
      case 3:
        if (!firstName.trim() || !lastName.trim()) return 'Please enter your first and last name.'
        if (!street.trim() || !city.trim() || !province.trim() || !postal.trim())
          return 'Please complete your address (street, city, province and postal code).'
        if (!email.trim() && !dayPhone.trim() && !eveningPhone.trim())
          return 'Please provide an email address or a phone number.'
        if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
          return 'That email address does not look right.'
        return null
      case 4:
        if (!legalRight) return 'Please answer: do you have the legal right to work in Canada?'
        if (!canProveRight) return 'Please answer: can you submit documents to prove your right to work?'
        if (!legalAgeAlcohol) return 'Please answer: are you of legal age to serve alcohol?'
        if (!canProveAge) return 'Please answer: can you submit proof of age?'
        if (!smartServe) return 'Please answer the Smart Serve question.'
        if (!essentialFunctions) return 'Please answer the essential-functions question.'
        if (!everAffiliated) return 'Please answer the affiliated-restaurants question.'
        if (everAffiliated === 'Yes' && !affiliatedWhere.trim())
          return 'Please tell us which affiliated restaurant you worked at.'
        return null
      case 5:
        if (!dateAvailable) return 'Please tell us the date you are available for employment.'
        if (!employmentType) return 'Please choose part-time or full-time.'
        if (!seasonalPermanent) return 'Please choose seasonal or permanent.'
        if (!DAYS.some((d) => days[d].can)) return 'Please mark at least one day you can work.'
        if (DAYS.some((d) => days[d].can && (!days[d].earliest || !days[d].latest)))
          return 'Please give an earliest time in and latest time out for each day you can work.'
        if (!holidaysWeekends) return 'Please answer the holidays & weekends question.'
        if (!trainingFlexible) return 'Please answer the training-flexibility question.'
        if (!transportation) return 'Please answer the transportation question.'
        if (!hasJobToKeep) return 'Please answer: do you presently have a job you intend to keep?'
        if (!jobsLastTwoYears) return 'Please answer: how many jobs have you held in the last two years?'
        if (!jobsTerminated) return 'Please answer: how many jobs have you been terminated from?'
        return null
      case 6: {
        const complete = jobs.filter((j) => j.company.trim() && j.position_duties.trim())
        if (complete.length === 0)
          return 'Please add at least one job with company and duties (use N/A where a detail does not apply). School or volunteer experience counts if this is your first job.'
        return null
      }
      case 7: {
        const complete = refs.filter((r) => r.name.trim() && r.phone.trim())
        if (complete.length < 2) return 'Please provide at least two references with a name and phone number.'
        return null
      }
      case 8:
        if (!declAgreed) return 'Please read and agree to the declaration.'
        if (!signedName.trim()) return 'Please type your full name as your signature.'
        if (signedName.trim().toLowerCase() !== fullName.toLowerCase())
          return `Please sign with your full name exactly as entered earlier (${fullName}).`
        return null
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
    const err = validate()
    if (err) {
      setStepError(err)
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    const payload = {
      applicant: { full_name: fullName, email: email.trim(), phone: dayPhone.trim() || eveningPhone.trim() },
      application: {
        location_id: locationId,
        desired_position: positionText,
        source: params.get('source') === 'indeed' ? 'indeed' : 'website',
        form: {
          positions: [...roles, ...(otherRole.trim() ? [`Other: ${otherRole.trim()}`] : [])],
          address: {
            street: street.trim(),
            apt: apt.trim(),
            city: city.trim(),
            province: province.trim(),
            postal_code: postal.trim(),
          },
          phones: {
            day: dayPhone.trim(),
            evening: eveningPhone.trim(),
            alternate: altPhone.trim(),
          },
          work_eligibility: {
            legal_right_to_work_in_canada: legalRight,
            can_submit_documents: canProveRight,
          },
          minimum_age: legalAgeAlcohol, // legal age to serve alcohol (per official form Q3)
          alcohol_service: {
            can_submit_proof_of_age: canProveAge,
            smart_serve_certified: smartServe,
            smart_serve_number: smartServeNo.trim(),
          },
          essential_functions: essentialFunctions,
          affiliated_history: {
            ever_employed: everAffiliated,
            location: affiliatedWhere.trim(),
            manager: affiliatedManager.trim(),
          },
          employment: {
            date_available: dateAvailable,
            type: employmentType,
            seasonal_or_permanent: seasonalPermanent,
            minimum_pay_per_hour: minPayHour.trim(),
            minimum_pay_per_week: minPayWeek.trim(),
          },
          availability: {
            days: Object.fromEntries(DAYS.filter((d) => days[d].can).map((d) => [d, { earliest: days[d].earliest, latest: days[d].latest }])),
            holidays_and_weekends: holidaysWeekends,
            flexible_for_training: trainingFlexible,
            adequate_transportation: transportation,
            has_job_to_keep: hasJobToKeep,
            jobs_last_two_years: jobsLastTwoYears,
            jobs_terminated_from: jobsTerminated,
            commitments: commitments.trim(),
          },
          work_history: jobs.filter((j) => j.company.trim()),
          references: refs.filter((r) => r.name.trim()),
          how_heard: howHeard.trim(),
          declaration: {
            agreed: true,
            text_version: 'V.2026.01',
            signed_name: signedName.trim(),
            signed_at: new Date().toISOString(),
          },
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
          <p className="text-lg font-semibold">Application received — thank you, {firstName.trim()}!</p>
          <p className="mt-2 text-sm text-charcoal/65">
            The team at {location?.name} will review your application for {positionText} and be in touch.
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

      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide text-charcoal/45">
          Step {step + 1} of {STEPS.length}
        </p>
        <p className="text-base font-semibold">{STEPS[step]}</p>
        <div className="mt-2 flex gap-1">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-cg-orange' : 'bg-surface-line'}`} />
          ))}
        </div>
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-charcoal/65">
            Thanks for your interest in joining the Charcoal Group family. To be considered, this
            application must be filled out completely — use N/A where a question doesn't apply.
            Resumés are not accepted in place of completing this form. You may omit information
            indicating legally protected details (ex: gender, religion, national origin, age, etc.).
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
          <div>
            <span className="mb-1 block text-sm font-medium">
              Which position(s) are you applying for? <span className="font-normal text-charcoal/50">Choose all that interest you.</span>
            </span>
            <div className="space-y-1">
              {config.positions.map((p) => (
                <label key={p.role_title} className="flex cursor-pointer items-center gap-2 rounded-md border border-surface-line bg-surface px-3 py-2 text-sm">
                  <input type="checkbox" checked={roles.includes(p.role_title)} onChange={() => toggleRole(p.role_title)} />
                  {p.role_title} <span className="text-xs text-charcoal/50">— {p.department}</span>
                </label>
              ))}
              <div className="flex items-center gap-2 rounded-md border border-surface-line bg-surface px-3 py-2 text-sm">
                <span className="shrink-0">Other:</span>
                <input
                  value={otherRole}
                  onChange={(e) => setOtherRole(e.target.value)}
                  placeholder="tell us what you're looking for"
                  className="w-full border-0 bg-transparent text-sm focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          {selectedRoles.length > 0 ? (
            <>
              <p className="text-sm text-charcoal/65">
                Please read the job description{selectedRoles.length > 1 ? 's' : ''} for the position
                {selectedRoles.length > 1 ? 's' : ''} you chose before continuing.
              </p>
              {selectedRoles.map((role) => (
                <div key={role.role_title} className="max-h-80 overflow-y-auto rounded-md border border-surface-line bg-surface p-4">
                  <p className="text-sm font-semibold">{role.role_title} — Job Description</p>
                  <p className="mb-2 text-xs text-charcoal/55">
                    Department: {role.department} · Reports to: {role.reports_to}
                  </p>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal/80">{role.body}</div>
                </div>
              ))}
            </>
          ) : (
            <p className="rounded-md border border-surface-line bg-surface px-4 py-4 text-sm text-charcoal/70">
              There is no standard job description for the position you entered — the restaurant will
              go over the role's duties with you.
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={ackJd} onChange={() => setAckJd((v) => !v)} className="mt-0.5" />
            I have read and understood the job description{selectedRoles.length > 1 ? 's' : ''} for the
            position{selectedRoles.length > 1 ? 's' : ''} I am applying for.
          </label>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          {uniformDocs.length > 0 ? (
            <>
              <p className="text-sm text-charcoal/65">
                Every Team Member follows the grooming & uniform standards. Please read before
                continuing.
              </p>
              {uniformDocs.map((u) => (
                <div key={u.title} className="max-h-80 overflow-y-auto rounded-md border border-surface-line bg-surface p-4">
                  <p className="text-sm font-semibold">{u.title}</p>
                  {u.effective && <p className="mb-2 text-xs text-charcoal/55">{u.effective}</p>}
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal/80">{u.body}</div>
                </div>
              ))}
            </>
          ) : (
            <p className="rounded-md border border-surface-line bg-surface px-4 py-4 text-sm text-charcoal/70">
              {location?.brand ?? 'This restaurant'} has grooming & uniform standards every Team
              Member follows — covering personal hygiene, hair, jewellery, and the issued uniform.
              The full document will be provided to you by the restaurant.
            </p>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="checkbox" checked={ackUniform} onChange={() => setAckUniform((v) => !v)} className="mt-0.5" />
            I have reviewed the grooming & uniform standards{uniformDocs.length === 0 ? ' summary' : ''} and
            I am willing to meet these requirements.
          </label>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">First name</span>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} autoComplete="given-name" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Last name</span>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} autoComplete="family-name" />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_90px]">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Street / PO Box</span>
              <input value={street} onChange={(e) => setStreet(e.target.value)} className={inputCls} autoComplete="address-line1" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Apt #</span>
              <input value={apt} onChange={(e) => setApt(e.target.value)} className={inputCls} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">City</span>
              <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} autoComplete="address-level2" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Province</span>
              <input value={province} onChange={(e) => setProvince(e.target.value)} className={inputCls} autoComplete="address-level1" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Postal code</span>
              <input value={postal} onChange={(e) => setPostal(e.target.value)} className={inputCls} autoComplete="postal-code" />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Day phone</span>
              <input value={dayPhone} onChange={(e) => setDayPhone(e.target.value)} className={inputCls} type="tel" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Evening phone</span>
              <input value={eveningPhone} onChange={(e) => setEveningPhone(e.target.value)} className={inputCls} type="tel" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Alternate phone <span className="font-normal text-charcoal/50">(optional)</span></span>
              <input value={altPhone} onChange={(e) => setAltPhone(e.target.value)} className={inputCls} type="tel" />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Email address</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} type="email" autoComplete="email" />
          </label>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-5">
          <YesNo label="Do you have the legal right to work in Canada?" value={legalRight} onChange={setLegalRight} />
          <YesNo label="If hired, can you submit documents to prove your legal right to work in this country?" value={canProveRight} onChange={setCanProveRight} />
          <YesNo label="Are you of legal age to serve alcohol?" value={legalAgeAlcohol} onChange={setLegalAgeAlcohol} />
          <YesNo label="If hired, can you submit proof of age?" value={canProveAge} onChange={setCanProveAge} />
          <div>
            <YesNo label="Are you Smart Serve certified?" value={smartServe} onChange={setSmartServe} />
            {smartServe === 'Yes' && (
              <input
                value={smartServeNo}
                onChange={(e) => setSmartServeNo(e.target.value)}
                placeholder="Smart Serve certificate #"
                className={`${inputCls} mt-2 max-w-72`}
              />
            )}
          </div>
          <YesNo
            label="Can you perform the essential functions required by the job(s) for which you are applying, either with or without reasonable accommodations?"
            value={essentialFunctions}
            onChange={setEssentialFunctions}
          />
          <div>
            <YesNo
              label="Are you presently, or have you ever been, employed by any of our affiliated restaurants?"
              value={everAffiliated}
              onChange={setEverAffiliated}
              hint={AFFILIATED}
            />
            {everAffiliated === 'Yes' && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input value={affiliatedWhere} onChange={(e) => setAffiliatedWhere(e.target.value)} placeholder="Which location?" className={inputCls} />
                <input value={affiliatedManager} onChange={(e) => setAffiliatedManager(e.target.value)} placeholder="Manager's name" className={inputCls} />
              </div>
            )}
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Date you are available for employment</span>
              <input type="date" value={dateAvailable} onChange={(e) => setDateAvailable(e.target.value)} className={inputCls} />
            </label>
            <div>
              <span className="mb-1 block text-sm font-medium">I want to work…</span>
              <div className="flex flex-wrap gap-3 pt-1.5">
                {['Part-time (10–24 hours/week)', 'Full-time (25+ hours/week)'].map((o) => (
                  <label key={o} className="flex cursor-pointer items-center gap-1.5 text-sm">
                    <input type="radio" checked={employmentType === o} onChange={() => setEmploymentType(o)} />
                    {o}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <YesNo
            label="Are you interested in seasonal or permanent employment?"
            value={seasonalPermanent}
            onChange={setSeasonalPermanent}
            options={['Seasonal', 'Permanent']}
          />
          <div>
            <span className="mb-1 block text-sm font-medium">
              What is the minimum amount of money you need to make?
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">$</span>
              <input value={minPayHour} onChange={(e) => setMinPayHour(e.target.value)} placeholder="per hour" className={`${inputCls} max-w-32`} />
              <span className="text-sm text-charcoal/50">or</span>
              <span className="text-sm">$</span>
              <input value={minPayWeek} onChange={(e) => setMinPayWeek(e.target.value)} placeholder="per week" className={`${inputCls} max-w-32`} />
            </div>
            <p className="mt-1 text-xs text-charcoal/50">
              Note: a statement of desired salary does not guarantee we will be able to meet your request.
            </p>
          </div>

          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Which days CAN you work?</span>
              <span className="flex gap-2">
                <button type="button" onClick={selectAllDays} className={btnSmall}>
                  Select all days
                </button>
                <button type="button" onClick={copyTimesToChecked} className={btnSmall} title="Copy the first filled-in times to every checked day">
                  Same times for all
                </button>
              </span>
            </div>
            <p className="mb-2 text-xs text-charcoal/55">
              List the earliest and latest times you can work, accounting for travel time. Being in
              uniform and ready for your start time is mandatory.
            </p>
            <div className="space-y-1.5">
              {DAYS.map((d) => (
                <div key={d} className="flex flex-wrap items-center gap-2 rounded-md border border-surface-line bg-surface px-3 py-1.5">
                  <label className="flex w-16 cursor-pointer items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={days[d].can} onChange={() => setDay(d, { can: !days[d].can })} />
                    {d}
                  </label>
                  {days[d].can ? (
                    <span className="flex flex-1 flex-wrap items-center gap-1.5 text-xs text-charcoal/60">
                      earliest in
                      <input type="time" value={days[d].earliest} onChange={(e) => setDay(d, { earliest: e.target.value })} className="rounded-md border border-surface-line bg-surface px-1.5 py-1 text-sm" />
                      latest out
                      <input type="time" value={days[d].latest} onChange={(e) => setDay(d, { latest: e.target.value })} className="rounded-md border border-surface-line bg-surface px-1.5 py-1 text-sm" />
                    </span>
                  ) : (
                    <span className="text-xs text-charcoal/35">can't work</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <YesNo
            label="We are open for lunch and dinner 364 days a year (closed on Christmas Day). Are you able to work holidays and weekends?"
            value={holidaysWeekends}
            onChange={setHolidaysWeekends}
          />
          <YesNo
            label="We may conduct training on days, or at times, you have other obligations. Is your schedule flexible so you may attend all required training?"
            value={trainingFlexible}
            onChange={setTrainingFlexible}
          />
          <YesNo
            label="Some shifts begin as early as 6 AM and occasionally end as late as 3 AM. Do you have adequate transportation to and from work for the days you are available?"
            value={transportation}
            onChange={setTransportation}
          />
          <YesNo label="Do you presently have a job you intend to keep?" value={hasJobToKeep} onChange={setHasJobToKeep} />
          <YesNo
            label="How many jobs have you held in the last two years?"
            value={jobsLastTwoYears}
            onChange={setJobsLastTwoYears}
            options={['0', '1', '2', '3', '4 or more']}
          />
          <YesNo
            label="How many jobs have you been terminated from?"
            value={jobsTerminated}
            onChange={setJobsTerminated}
            options={['0', '1', '2', '3', '4 or more']}
          />
          <label className="block">
            <span className="mb-1 block text-sm font-medium">
              What commitments do you have, or do you anticipate, that may affect your schedule?
              <span className="font-normal text-charcoal/50"> (e.g. school, sports, outside interests)</span>
            </span>
            <textarea value={commitments} onChange={(e) => setCommitments(e.target.value)} rows={2} className={inputCls} />
          </label>
        </div>
      )}

      {step === 6 && (
        <div className="space-y-3">
          <p className="text-sm text-charcoal/65">
            List your last 3 jobs, most recent first — complete each in full (use N/A where a detail
            doesn't apply). School or volunteer experience counts if this is your first job.
          </p>
          {jobs.map((j, i) => (
            <div key={i} className="rounded-md border border-surface-line bg-surface p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-charcoal/50">
                  {i === 0 ? 'Current or most recent job' : `Previous job ${i + 1}`}
                </span>
                {jobs.length > 1 && (
                  <button onClick={() => setJobs((js) => js.filter((_, k) => k !== i))} className="text-xs text-charcoal/40 hover:text-danger">
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={j.company} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, company: e.target.value } : x)))} placeholder="Company name" className={inputCls} />
                <input value={j.address} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, address: e.target.value } : x)))} placeholder="Company address" className={inputCls} />
              </div>
              <textarea
                value={j.position_duties}
                onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, position_duties: e.target.value } : x)))}
                placeholder="Position & job duties (please describe)"
                rows={2}
                className={`${inputCls} mt-2`}
              />
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input value={j.supervisor} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, supervisor: e.target.value } : x)))} placeholder="Immediate supervisor — name & title" className={inputCls} />
                <input value={j.supervisor_phone} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, supervisor_phone: e.target.value } : x)))} placeholder="Supervisor phone number" className={inputCls} type="tel" />
                <input value={j.from} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, from: e.target.value } : x)))} placeholder="From (month/year)" className={inputCls} />
                <input value={j.to} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, to: e.target.value } : x)))} placeholder="To (month/year, or 'present')" className={inputCls} />
                <input value={j.hours_per_week} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, hours_per_week: e.target.value } : x)))} placeholder="Usual hours worked per week" className={inputCls} />
                <input value={j.weekly_earnings} onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, weekly_earnings: e.target.value } : x)))} placeholder="Weekly earnings" className={inputCls} />
              </div>
              <input
                value={j.reason_for_leaving}
                onChange={(e) => setJobs((js) => js.map((x, k) => (k === i ? { ...x, reason_for_leaving: e.target.value } : x)))}
                placeholder="Reason for leaving"
                className={`${inputCls} mt-2`}
              />
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="text-charcoal/70">May we contact this person as a reference?</span>
                {['Yes', 'No'].map((o) => (
                  <label key={o} className="flex cursor-pointer items-center gap-1.5">
                    <input type="radio" checked={j.may_contact === o} onChange={() => setJobs((js) => js.map((x, k) => (k === i ? { ...x, may_contact: o } : x)))} />
                    {o}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {jobs.length < 3 && (
            <button onClick={() => setJobs((js) => [...js, emptyJob()])} className={btnGhost}>
              + Add another job
            </button>
          )}
        </div>
      )}

      {step === 7 && (
        <div className="space-y-3">
          <p className="text-sm text-charcoal/65">
            Please give us at least two personal references, other than immediate family — people who
            know your work, like a past manager, coach, or teacher.
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
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={r.name} onChange={(e) => setRefs((rs) => rs.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className={inputCls} />
                <input value={r.phone} onChange={(e) => setRefs((rs) => rs.map((x, k) => (k === i ? { ...x, phone: e.target.value } : x)))} placeholder="Phone number" className={inputCls} type="tel" />
                <input value={r.years_known} onChange={(e) => setRefs((rs) => rs.map((x, k) => (k === i ? { ...x, years_known: e.target.value } : x)))} placeholder="Number of years known" className={inputCls} />
                <input value={r.relationship} onChange={(e) => setRefs((rs) => rs.map((x, k) => (k === i ? { ...x, relationship: e.target.value } : x)))} placeholder="Relationship" className={inputCls} />
              </div>
            </div>
          ))}
          <button onClick={() => setRefs((rs) => [...rs, { name: '', phone: '', years_known: '', relationship: '' }])} className={btnGhost}>
            + Add another reference
          </button>
        </div>
      )}

      {step === 8 && (
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">How did you hear about us?</span>
            <input value={howHeard} onChange={(e) => setHowHeard(e.target.value)} className={inputCls} />
          </label>

          <div className="rounded-md border border-surface-line bg-surface p-4 text-sm">
            <ReviewRow label="Applying to" value={`${positionText} — ${location?.name ?? ''}`} />
            <ReviewRow label="Name" value={fullName} />
            <ReviewRow label="Address" value={[street, apt, city, province, postal].filter(Boolean).join(', ')} />
            <ReviewRow label="Contact" value={[email, dayPhone, eveningPhone].filter(Boolean).join(' · ')} />
            <ReviewRow label="Available from" value={`${dateAvailable} · ${employmentType} · ${seasonalPermanent}`} />
            <ReviewRow
              label="Days"
              value={DAYS.filter((d) => days[d].can).map((d) => `${d} ${days[d].earliest}–${days[d].latest}`).join(', ')}
            />
            <ReviewRow label="Work history" value={jobs.filter((j) => j.company.trim()).map((j) => j.company).join('; ')} />
            <ReviewRow label="References" value={refs.filter((r) => r.name.trim()).map((r) => r.name).join(', ')} />
            <ReviewRow label="Documents" value="Job description ✓ · Grooming & uniform standards ✓" />
          </div>

          <div className="rounded-md border border-surface-line bg-surface-muted/60 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-charcoal/50">
              Please read the following carefully
            </p>
            <p className="text-xs leading-relaxed text-charcoal/75">{DECLARATION}</p>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={declAgreed} onChange={() => setDeclAgreed((v) => !v)} className="mt-0.5" />
              I have read and agree to the declaration above.
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-sm font-medium">Signature — type your full name</span>
              <input value={signedName} onChange={(e) => setSignedName(e.target.value)} placeholder={fullName || 'Your full name'} className={`${inputCls} max-w-80`} />
            </label>
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
        <p className="mt-4 text-center text-[11px] leading-relaxed text-charcoal/40">
          The Charcoal Group is an equal opportunity employer. Upon request, we will accommodate
          applicants with disabilities during the recruitment and selection process. Your application
          is kept confidential and retained for 3 years in accordance with Employment Standards
          Legislation.
        </p>
      </div>
    </div>
  )
}

function YesNo({
  label,
  value,
  onChange,
  options = ['Yes', 'No'],
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options?: string[]
  hint?: string
}) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {hint && <p className="mb-1 text-xs text-charcoal/50">{hint}</p>}
      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input type="radio" checked={value === o} onChange={() => onChange(o)} />
            {o}
          </label>
        ))}
      </div>
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
