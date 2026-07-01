import type { Session } from '@supabase/supabase-js'
import { LogOut, Users } from 'lucide-react'
import { signOut } from '../features/auth/useSession'
import { can, toPermissionUser } from '../permissions'
import type { UserProfile } from '../types'
import monogram from '../assets/cg-monogram.svg'
import wordmark from '../assets/cg-wordmark.svg'

interface AppShellProps {
  session: Session
  profile: UserProfile | null
}

export function AppShell({ session, profile }: AppShellProps) {
  const user = profile ? toPermissionUser(profile) : null
  const displayName =
    profile?.display_name ?? profile?.email ?? session.user.email ?? 'Signed in'

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-charcoal/10 bg-white px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <img src={monogram} alt="CG" className="h-9 w-9" />
          <div className="flex flex-col">
            <img src={wordmark} alt="Charcoal Group" className="hidden h-4 sm:block" />
            <span className="text-sm font-medium tracking-wide text-charcoal/80">
              People Center
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-medium">{displayName}</p>
            {profile && (
              <p className="text-xs uppercase tracking-wide text-charcoal/50">
                {profile.role.replace('_', ' ')}
              </p>
            )}
          </div>
          <button
            onClick={() => void signOut()}
            className="flex items-center gap-1.5 rounded-md border border-charcoal/20 px-2.5 py-1.5 text-sm hover:bg-charcoal/5"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="max-w-md text-center">
          <Users className="mx-auto mb-4 h-10 w-10 text-charcoal/30" />
          <h2 className="mb-2 text-lg font-medium">Directory arrives in Phase 1</h2>
          <p className="text-sm text-charcoal/60">
            The leadership relationship and development platform for Charcoal
            Group. The skeleton is in place — identity, permissions, audit, and
            events. The people come next.
          </p>
          {user && can(user, 'view', 'admin_area') && (
            <p className="mt-4 text-xs uppercase tracking-wide text-charcoal/40">
              Administrator
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
