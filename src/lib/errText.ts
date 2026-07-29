// Render an unknown thrown value as human-readable text.
//
// Supabase/PostgREST errors are PLAIN OBJECTS, not Error instances, so
// `String(err)` yields "[object Object]" and `err instanceof Error` is false —
// the message must be read off the object directly (HANDOVER.md gotcha). Use
// this everywhere a caught error is shown to a user.
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string }
    // 23505 = unique_violation (e.g. adding the same successor to a seat twice).
    if (o.code === '23505') return 'That entry already exists.'
    return o.message || o.details || o.hint || JSON.stringify(o)
  }
  return String(e)
}
