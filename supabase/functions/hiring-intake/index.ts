// Public hiring intake — Team Member flow (work order a1164da2).
//
// SECURITY SHAPE: this function is the ONLY public path into the hiring
// tables. The database has ZERO anon policies; this function holds the
// service role and is layered:
//   1. HIRING_INTAKE_ENABLED must be 'true' — default OFF returns 503.
//      Michael's outward-facing sign-off flips it (public surfaces are his
//      call alone). verify_jwt is disabled because applicants are strangers;
//      this gate + Turnstile + rate limiting are the auth story instead.
//   2. Cloudflare Turnstile verification when TURNSTILE_SECRET is set.
//   3. Per-IP rate limit (20/hour) via people_center_intake_hits.
//   4. Server-side completeness — the standard: complete IN FULL, no
//      exceptions, never 'See Resume'.
// Tokenised return links are single-use and expiring; only sha256 hashes are
// stored, and failure cases (missing/tampered, reused, expired) return
// distinct generic errors with no data.
//
// Deployed via Supabase MCP (deploy_edge_function); this file is the
// version-controlled copy. Keep them in sync.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const REQUIRED_FORM_FIELDS = [
  'work_eligibility',
  'minimum_age',
  'availability',
  'work_history',
  'references',
  'declaration', // the signed declaration from the official form (V.2026.01)
]
// VERIFIED against the official CG Application for Employment (V.2026.01):
// "my application will remain on file for 3 years in accordance with
// Employment Standards Legislation" — stated in the signed declaration.
const RETENTION_YEARS = 3
const RATE_LIMIT_PER_HOUR = 20

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}

// Which uniform-standard brand covers each location concept. Beertown and
// Sociable share one standard set; new concepts get an entry here.
const CONCEPT_BRAND: Record<string, string> = {
  'Beertown': 'Beertown & Sociable',
  'Sociable Kitchen Tavern': 'Beertown & Sociable',
  'Sole': 'Solé',
  'The Bauer Kitchen': 'The Bauer Kitchen',
  'Wildcraft': 'Wildcraft',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Read-only config for the guided application form (and its preview):
  // restaurant list, TM roles with their job descriptions, and the uniform
  // standards applicants must acknowledge — exactly what any applicant would
  // be shown, approved for public read (Michael, 2026-09-03). The
  // HIRING_INTAKE_ENABLED gate below still hard-blocks every WRITE.
  if (req.method === 'GET') {
    const [locs, jds, uniforms] = await Promise.all([
      supabase
        .from('people_center_locations')
        .select('id, name, status, concept:people_center_concepts ( name )')
        .in('status', ['open', 'opening'])
        .not('concept_id', 'is', null)
        .order('name'),
      supabase
        .from('people_center_job_descriptions')
        .select('role_title, department, reports_to, body')
        .eq('active', true)
        .order('role_title'),
      supabase
        .from('people_center_uniform_standards')
        .select('brand, audience, title, body, effective')
        .eq('active', true)
        .in('audience', ['FOH', 'BOH', ''])
        .order('brand'),
    ])
    if (locs.error || jds.error || uniforms.error) {
      return json(500, { error: 'Could not load the application form — please try again.' })
    }
    type LocRow = { id: string; name: string; status: string; concept: { name: string } | null }
    return json(200, {
      enabled: Deno.env.get('HIRING_INTAKE_ENABLED') === 'true',
      turnstile_site_key: Deno.env.get('TURNSTILE_SITE_KEY') ?? null,
      locations: ((locs.data as unknown as LocRow[]) ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        opening: l.status === 'opening',
        brand: CONCEPT_BRAND[l.concept?.name ?? ''] ?? l.concept?.name ?? '',
      })),
      positions: jds.data ?? [],
      uniform_standards: uniforms.data ?? [],
    })
  }

  if (Deno.env.get('HIRING_INTAKE_ENABLED') !== 'true') {
    return json(503, { error: 'Applications are not open through this channel yet.' })
  }
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  // Rate limit per IP.
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const { count } = await supabase
    .from('people_center_intake_hits')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('at', hourAgo)
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return json(429, { error: 'Too many requests — please try again later.' })
  }
  await supabase.from('people_center_intake_hits').insert({ ip })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  // ---- Tokenised return link: resume / complete a part-filled form --------
  if (body.action === 'resume') {
    const raw = typeof body.token === 'string' ? body.token : ''
    if (raw.length < 20) return json(404, { error: 'This link is not valid.' })
    const hash = await sha256Hex(raw)
    const { data: tok } = await supabase
      .from('people_center_application_tokens')
      .select('id, application_id, expires_at, used_at')
      .eq('token_hash', hash)
      .maybeSingle()
    if (!tok) return json(404, { error: 'This link is not valid.' })
    if (tok.used_at) return json(410, { error: 'This link has already been used.' })
    if (Date.parse(tok.expires_at) < Date.now()) {
      return json(410, { error: 'This link has expired — please contact the restaurant.' })
    }

    if (body.form === undefined) {
      // Prefill fetch: return ONLY what the applicant themselves provided.
      const { data: app } = await supabase
        .from('people_center_applications')
        .select('desired_position, location_name, form, status')
        .eq('id', tok.application_id)
        .maybeSingle()
      if (!app) return json(404, { error: 'This link is not valid.' })
      return json(200, {
        application: {
          desired_position: app.desired_position,
          location_name: app.location_name,
          form: app.form,
        },
      })
    }

    // Completing the form through the link.
    const form = body.form as Record<string, unknown>
    const missing = REQUIRED_FORM_FIELDS.filter((f) => !nonEmpty(form?.[f]))
    if (missing.length > 0) {
      return json(422, { error: 'The application must be completed in full.', missing })
    }
    const acks = (body.acks ?? {}) as Record<string, unknown>
    if (acks.job_description !== true || acks.uniform_grooming !== true) {
      return json(422, {
        error:
          'Please confirm you have read the Job Description and the Uniform & Grooming Standards.',
      })
    }
    await supabase
      .from('people_center_applications')
      .update({
        form,
        complete: true,
        status: 'submitted',
        updated_at: new Date().toISOString(),
        updated_by_name: 'applicant (tokenised link)',
      })
      .eq('id', tok.application_id)
    await supabase
      .from('people_center_application_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tok.id)
    for (const doc of ['job_description', 'uniform_grooming']) {
      await supabase
        .from('people_center_application_acks')
        .upsert(
          { application_id: tok.application_id, doc },
          { onConflict: 'application_id,doc', ignoreDuplicates: true },
        )
    }
    await supabase.from('people_center_application_events').insert({
      application_id: tok.application_id,
      event: 'application.completed_via_link',
      actor_name: 'applicant',
    })
    return json(200, { ok: true })
  }

  // ---- Fresh submission ----------------------------------------------------
  const secret = Deno.env.get('TURNSTILE_SECRET')
  if (secret) {
    const t = typeof body.turnstile_token === 'string' ? body.turnstile_token : ''
    const vr = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(t)}&remoteip=${encodeURIComponent(ip)}`,
    }).then((r) => r.json()).catch(() => ({ success: false }))
    if (!vr.success) return json(403, { error: 'Verification failed — please retry.' })
  }

  const applicant = (body.applicant ?? {}) as Record<string, unknown>
  const application = (body.application ?? {}) as Record<string, unknown>
  const fullName = typeof applicant.full_name === 'string' ? applicant.full_name.trim() : ''
  const email = typeof applicant.email === 'string' ? applicant.email.trim().toLowerCase() : ''
  const phone = typeof applicant.phone === 'string' ? applicant.phone.trim() : ''
  if (!fullName) return json(422, { error: 'Full name is required.' })
  if (!email && !phone) return json(422, { error: 'An email address or phone number is required.' })
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(422, { error: 'That email address does not look valid.' })
  }

  const locationId = typeof application.location_id === 'string' ? application.location_id : ''
  const desiredPosition =
    typeof application.desired_position === 'string' ? application.desired_position.trim() : ''
  const source = typeof application.source === 'string' ? application.source : 'website'
  if (!desiredPosition) return json(422, { error: 'Desired position is required.' })
  if (!['indeed', 'website', 'in_person', 'other'].includes(source)) {
    return json(422, { error: 'Unknown application source.' })
  }
  const { data: loc } = await supabase
    .from('people_center_locations')
    .select('id, name')
    .eq('id', locationId)
    .maybeSingle()
  if (!loc) return json(422, { error: 'Please choose a valid restaurant.' })

  const form = (application.form ?? {}) as Record<string, unknown>
  const missing = REQUIRED_FORM_FIELDS.filter((f) => !nonEmpty(form[f]))
  if (missing.length > 0) {
    return json(422, { error: 'The application must be completed in full.', missing })
  }
  const acks = (body.acks ?? {}) as Record<string, unknown>
  if (acks.job_description !== true || acks.uniform_grooming !== true) {
    return json(422, {
      error:
        'Please confirm you have read the Job Description and the Uniform & Grooming Standards.',
    })
  }

  // Dedupe the human by email; the application row is always new.
  let applicantId: string | null = null
  if (email) {
    const { data: existing } = await supabase
      .from('people_center_applicants')
      .select('id')
      .ilike('email', email)
      .maybeSingle()
    if (existing) applicantId = existing.id
  }
  if (!applicantId) {
    const { data: created, error: aerr } = await supabase
      .from('people_center_applicants')
      .insert({ full_name: fullName, email: email || null, phone: phone || null })
      .select('id')
      .single()
    if (aerr) return json(500, { error: 'Could not save the application — please retry.' })
    applicantId = created.id
  }

  const now = new Date()
  const purge = new Date(now)
  purge.setFullYear(purge.getFullYear() + RETENTION_YEARS)
  const { data: app, error: appErr } = await supabase
    .from('people_center_applications')
    .insert({
      applicant_id: applicantId,
      location_id: loc.id,
      location_name: loc.name,
      desired_position: desiredPosition,
      source,
      status: 'submitted',
      complete: true,
      form,
      submitted_at: now.toISOString(),
      retention_purge_after: purge.toISOString().slice(0, 10),
      updated_by_name: 'public intake',
    })
    .select('id')
    .single()
  if (appErr) return json(500, { error: 'Could not save the application — please retry.' })

  await supabase.from('people_center_application_acks').insert([
    { application_id: app.id, doc: 'job_description' },
    { application_id: app.id, doc: 'uniform_grooming' },
  ])
  await supabase.from('people_center_application_events').insert({
    application_id: app.id,
    event: 'application.submitted',
    actor_name: 'applicant',
    detail: `source=${source}`,
  })

  return json(201, { ok: true })
})
