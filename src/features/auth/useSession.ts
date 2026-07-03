import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { consumeCgopsSsoHandoff } from './cgopsSso'
import type { UserProfile } from '../../types'

// Session + app profile in one hook. The app's role detection reads
// people_center_user_profiles.role through this hook and nothing else — no
// cached role state. A missing row or a fetch error is SURFACED
// (profileError / profile === null shows in the user menu), never swallowed.
//
// TODO(cgops-authority): people_center_user_profiles is a TEMPORARY
// compatibility layer after the CGOPS lift-and-shift — CGOPS profiles are
// the identity/role authority. This is the app's ONLY profile query; Phase B
// of docs/RUNBOOK_CGOPS_LIFT_AND_SHIFT.md repoints it at the CGOPS profile
// table (with a role mapping) and then drops the People Center tables.
export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // Consume a CGOPS SSO handoff fragment (if present) BEFORE reading the
    // session, so first render after a CGOPS launch is already signed in.
    consumeCgopsSsoHandoff()
      .then(() => supabase.auth.getSession())
      .then(({ data }) => {
        if (cancelled) return
        setSession(data.session)
        setLoading(false)
      })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setProfileError(null)
      return
    }
    let cancelled = false
    supabase
      .from('people_center_user_profiles')
      .select('*')
      .eq('auth_user_id', session.user.id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (cancelled) return
        if (error) {
          setProfile(null)
          setProfileError(error.message)
          return
        }
        if (data) {
          setProfile(data as UserProfile)
          setProfileError(null)
          return
        }
        // Phase A bridge: no compat row — ask the database's single admin
        // authority (people_center_is_admin() also recognizes CGOPS platform
        // admins; see migration 20260703090000) and synthesize a profile so
        // the UI and RLS cannot disagree about who is an admin.
        const { data: isAdmin, error: rpcError } = await supabase.rpc(
          'people_center_is_admin',
        )
        if (cancelled) return
        if (rpcError) {
          setProfile(null)
          setProfileError(rpcError.message)
          return
        }
        setProfile(bridgeProfile(session, isAdmin === true))
        setProfileError(null)
      })
    return () => {
      cancelled = true
    }
  }, [session])

  return { session, profile, profileError, loading }
}

// A CGOPS-authenticated user with no compat row: role comes from the
// database's people_center_is_admin() (CGOPS platform admins → admin);
// everyone else is a viewer until Phase B maps the full CGOPS role
// vocabulary. person_id stays null — import attribution falls back to email.
function bridgeProfile(session: Session, isAdmin: boolean): UserProfile {
  return {
    id: `cgops-bridge:${session.user.id}`,
    auth_user_id: session.user.id,
    email: session.user.email ?? '',
    display_name: session.user.email ?? null,
    role: isAdmin ? 'admin' : 'viewer',
    person_id: null,
    created_at: session.user.created_at ?? '',
    updated_at: session.user.created_at ?? '',
    updated_by: null,
    updated_by_name: null,
  }
}

export async function signOut() {
  await supabase.auth.signOut()
}
