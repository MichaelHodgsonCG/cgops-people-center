import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { LogOut } from 'lucide-react'
import { signOut } from '../features/auth/useSession'
import { can, toPermissionUser, type Resource } from '../permissions'
import type { UserProfile } from '../types'
import monogram from '../assets/cg-monogram.svg'
import wordmark from '../assets/cg-wordmark.svg'

export type View = 'directory' | 'imports'

const NAV: { view: View; label: string; resource: Resource }[] = [
  { view: 'directory', label: 'Directory', resource: 'directory' },
  { view: 'imports', label: 'Imports', resource: 'imports' },
]

interface AppShellProps {
  session: Session
  profile: UserProfile | null
  view: View
  onNavigate: (view: View) => void
  children: ReactNode
}

export function AppShell({ session, profile, view, onNavigate, children }: AppShellProps) {
  const user = profile ? toPermissionUser(profile) : null
  const displayName =
    profile?.display_name ?? profile?.email ?? session.user.email ?? 'Signed in'
  const visibleNav = NAV.filter((n) => can(user, 'view', n.resource))

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-charcoal/10 bg-white px-4 sm:px-6">
        <div className="flex items-center justify-between py-3">
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
                  {profile.role.replace(/_/g, ' ')}
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
        </div>
        {visibleNav.length > 0 && (
          <nav className="-mb-px flex gap-1">
            {visibleNav.map((n) => (
              <button
                key={n.view}
                onClick={() => onNavigate(n.view)}
                className={`border-b-2 px-3 py-2 text-sm ${
                  view === n.view
                    ? 'border-charcoal font-medium'
                    : 'border-transparent text-charcoal/60 hover:text-charcoal'
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
