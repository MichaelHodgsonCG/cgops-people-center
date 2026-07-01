import { useSession } from './features/auth/useSession'
import { LoginScreen } from './features/auth/LoginScreen'
import { AppShell } from './components/AppShell'

// Top-level view state lives here (house convention — no router library;
// revisit at Phase 2 per ARCHITECTURE_REVIEW.md §2.3 when the cheat sheet
// wants shareable deep links).
export default function App() {
  const { session, profile, loading } = useSession()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-charcoal/50">Loading…</p>
      </div>
    )
  }

  if (!session) return <LoginScreen />

  return <AppShell session={session} profile={profile} />
}
