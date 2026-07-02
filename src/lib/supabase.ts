import { createClient } from '@supabase/supabase-js'

// Single browser client, anon key + RLS only. Service-role keys never reach
// the browser; server-side work belongs in edge functions.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env and fill in values.',
  )
}

export const supabase = createClient(url, anonKey)
