import { lazy, Suspense, useState } from 'react'
import { useSession } from './features/auth/useSession'
import { LoginScreen } from './features/auth/LoginScreen'
import { AppShell, type View } from './components/AppShell'
import { DirectoryView } from './features/directory/DirectoryView'
import { can, toPermissionUser } from './permissions'

// Lazy: the sync pipeline (and its xlsx parser) only loads for admins who
// open the Imports tab.
const ImportView = lazy(() =>
  import('./features/imports/ImportView').then((m) => ({ default: m.ImportView })),
)

// Top-level view state lives here (house convention — no router library;
// revisit at Phase 2 per ARCHITECTURE_REVIEW.md §2.3 when the cheat sheet
// wants shareable deep links).
export default function App() {
  const { session, profile, loading } = useSession()
  const [view, setView] = useState<View>('directory')

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-charcoal/50">Loading…</p>
      </div>
    )
  }

  if (!session) return <LoginScreen />

  const user = profile ? toPermissionUser(profile) : null
  const effectiveView: View =
    view === 'imports' && !can(user, 'view', 'imports') ? 'directory' : view

  return (
    <AppShell session={session} profile={profile} view={effectiveView} onNavigate={setView}>
      {effectiveView === 'imports' ? (
        <Suspense fallback={<p className="p-6 text-sm text-charcoal/50">Loading…</p>}>
          <ImportView profile={profile} />
        </Suspense>
      ) : (
        <DirectoryView />
      )}
    </AppShell>
  )
}
