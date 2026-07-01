import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import type { UserProfile } from '../../types'

// Session + app profile in one hook. The profile row is created by the
// handle_new_user() trigger on signup; a missing row is tolerated (the shell
// falls back to the auth email) rather than fatal.
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      return
    }
    let cancelled = false
    supabase
      .from('user_profiles')
      .select('*')
      .eq('auth_user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfile((data as UserProfile | null) ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  return { session, profile, loading }
}

export async function signOut() {
  await supabase.auth.signOut()
}
