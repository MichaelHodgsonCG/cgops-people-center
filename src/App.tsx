import { useState } from 'react'
import { useSession } from './features/auth/useSession'
import { RedirectToCgops } from './features/auth/RedirectToCgops'
import { AppShell, type View } from './components/AppShell'
import { SessionTimeoutManager } from './components/SessionTimeoutManager'
import { HiringShell } from './features/hiring/HiringShell'
import { AdminShell } from './features/admin/AdminShell'
import { DirectoryView } from './features/directory/DirectoryView'
import { VisitView } from './features/visit/VisitView'
import { OrgChartView } from './features/org/OrgChartView'
import { UpcomingView } from './features/upcoming/UpcomingView'
import { GapView } from './features/gaps/GapView'
import { MyTasksView } from './features/tasks/MyTasksView'
import { BenchView } from './features/bench/BenchView'
import { can, toPermissionUser } from './permissions'

// Deep link from CGOPS My Day (Menu Center's pattern): /?view=my-tasks opens
// My Tasks. The QUERY carries it — the hash is reserved for the SSO handoff.
// Consumed once, then stripped so refreshes stay on normal navigation.
function initialView(): View {
  const params = new URLSearchParams(window.location.search)
  if (params.get('view') !== 'my-tasks') return 'directory'
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
  return 'my_tasks'
}

// Top-level view state lives here (house convention — no router library;
// revisit at Phase 2 per ARCHITECTURE_REVIEW.md §2.3 when the cheat sheet
// wants shareable deep links).
export default function App() {
  const { session, profile, profileError, loading } = useSession()
  const [view, setView] = useState<View>(initialView)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-charcoal/50">Loading…</p>
      </div>
    )
  }

  // Phase A: no standalone login — unauthenticated visits (and sign-outs)
  // go to CGOPS, which relaunches with the SSO handoff fragment.
  if (!session) return <RedirectToCgops />

  const user = profile ? toPermissionUser(profile) : null
  const guarded =
    (view === 'bench' && !can(user, 'view', 'bench')) ||
    (view === 'gaps' && !can(user, 'view', 'gap_analysis')) ||
    (view === 'hiring' && !can(user, 'view', 'hiring')) ||
    (view === 'admin' && !can(user, 'view', 'admin_center'))
  const effectiveView: View = guarded ? 'directory' : view

  // Hiring and the Admin Center are their own sections: each swaps the whole
  // shell (own left menu with a "Return to People Center" exit) rather than
  // rendering inside AppShell.
  if (effectiveView === 'hiring') {
    return (
      <>
        <SessionTimeoutManager />
        <HiringShell
          session={session}
          profile={profile}
          profileError={profileError}
          onReturn={() => setView('directory')}
        />
      </>
    )
  }
  if (effectiveView === 'admin') {
    return (
      <>
        <SessionTimeoutManager />
        <AdminShell
          session={session}
          profile={profile}
          profileError={profileError}
          onReturn={() => setView('directory')}
        />
      </>
    )
  }

  return (
    <>
      {/* Platform inactivity timeout (CGOPS authority — Platform Security.md):
          mounted once for the signed-in app; on timeout it signs out and the
          no-session branch above returns the user to the CGOPS login. */}
      <SessionTimeoutManager />
    <AppShell
      session={session}
      profile={profile}
      profileError={profileError}
      view={effectiveView}
      onNavigate={setView}
    >
      {effectiveView === 'visit' ? (
        <VisitView session={session} profile={profile} />
      ) : effectiveView === 'org_chart' ? (
        <OrgChartView session={session} profile={profile} />
      ) : effectiveView === 'upcoming' ? (
        <UpcomingView session={session} profile={profile} />
      ) : effectiveView === 'gaps' ? (
        <GapView session={session} profile={profile} />
      ) : effectiveView === 'my_tasks' ? (
        <MyTasksView session={session} profile={profile} />
      ) : effectiveView === 'bench' ? (
        <BenchView session={session} profile={profile} />
      ) : (
        <DirectoryView session={session} profile={profile} isAdmin={user?.role === 'admin'} />
      )}
    </AppShell>
    </>
  )
}
