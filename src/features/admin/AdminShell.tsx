// Admin Center — People Center's configure-side, its own section exactly
// like Hiring (spec 3f10f057, approved via Ember review afbc1537, authority:
// Michael's ruling a26b9315 / standard 77ca34f4). Gathers users & access,
// coverage, hiring setup (reviewers + template EDITING — the Hiring section
// keeps read-only references to the same rows), the activity log and data
// sources. Section opens for admin + executive; pages carry their own
// gates, and every control that grants reach stays admin-only (Ember's
// guard) — the section gate is never the control gate.

import { lazy, Suspense, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowLeft,
  BookOpenText,
  Briefcase,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  Database,
  Gauge,
  HelpCircle,
  Map,
  ScrollText,
  Shirt,
  UserCheck,
  UserCog,
  type LucideIcon,
} from 'lucide-react'
import { can, toPermissionUser, type Resource } from '../../permissions'
import type { UserProfile } from '../../types'
import { UserMenu } from '../../components/AppShell'
import { FeedbackWidget } from '../../components/FeedbackWidget'
import { HelpPanel } from '../help/HelpPanel'
import monogram from '../../assets/CG Logo Small.png'
import { UsersView } from './UsersView'
import { CoverageView } from '../coverage/CoverageView'
import { ActivityLogView } from '../activity/ActivityLogView'
import { ReviewersView } from '../hiring/HiringView'
import { JobDescriptionsView } from '../hiring/JobDescriptionsView'
import { UniformsView } from '../hiring/UniformsView'
import { InterviewsView } from '../hiring/InterviewsView'
import { MgmtProcessView } from '../hiring/MgmtProcessView'
import { VelocityView } from '../hiring/VelocityView'

// Lazy for the same reason as before the relocation: the sync pipeline (and
// its xlsx parser) only loads when an admin opens Data Sources.
const DataSourcesView = lazy(() =>
  import('../data-sources/DataSourcesView').then((m) => ({ default: m.DataSourcesView })),
)

type AdminPage =
  | 'users'
  | 'coverage'
  | 'reviewers'
  | 'job_descriptions'
  | 'uniforms'
  | 'interviews'
  | 'mgmt_process'
  | 'velocity'
  | 'activity'
  | 'data_sources'

// Each page declares the resource that gates it — the same vocabulary the
// pages themselves check, so the nav never shows a door the page would slam.
const NAV: { page: AdminPage; label: string; icon: LucideIcon; resource: Resource }[] = [
  { page: 'users', label: 'Users & Access', icon: UserCog, resource: 'admin_area' },
  { page: 'coverage', label: 'Coverage', icon: Map, resource: 'user_scopes' },
  { page: 'reviewers', label: 'Hiring Reviewers', icon: UserCheck, resource: 'hiring' },
  { page: 'job_descriptions', label: 'Job Descriptions', icon: BookOpenText, resource: 'hiring' },
  { page: 'uniforms', label: 'Uniforms', icon: Shirt, resource: 'hiring' },
  { page: 'interviews', label: 'Interviews', icon: ClipboardCheck, resource: 'hiring' },
  { page: 'mgmt_process', label: 'Mgmt Hiring', icon: Briefcase, resource: 'hiring' },
  // Admin-only for now (Michael, 2026-09-03) — when he opens Pipeline Speed
  // to Execs/ROLs, this resource and the view's own gate both widen.
  { page: 'velocity', label: 'Pipeline Speed', icon: Gauge, resource: 'admin_area' },
  { page: 'activity', label: 'Activity Log', icon: ScrollText, resource: 'admin_area' },
  { page: 'data_sources', label: 'Data Sources', icon: Database, resource: 'data_sources' },
]

// Shared with the other shells so the rail keeps the width the user chose.
const NAV_PREF_KEY = 'pc.nav.expanded'

interface AdminShellProps {
  session: Session
  profile: UserProfile | null
  profileError: string | null
  onReturn: () => void
}

export function AdminShell({ session, profile, profileError, onReturn }: AdminShellProps) {
  const user = profile ? toPermissionUser(profile) : null
  const visibleNav = NAV.filter((n) => can(user, 'view', n.resource))
  const [page, setPage] = useState<AdminPage>(() => visibleNav[0]?.page ?? 'coverage')
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(NAV_PREF_KEY) === '1',
  )
  const [helpOpen, setHelpOpen] = useState(false)

  function toggleNav() {
    setExpanded((prev) => {
      localStorage.setItem(NAV_PREF_KEY, prev ? '0' : '1')
      return !prev
    })
  }

  const activeLabel = NAV.find((n) => n.page === page)?.label ?? 'Admin'

  return (
    <div className="flex min-h-screen bg-surface text-charcoal">
      <aside
        className={`flex shrink-0 flex-col border-r border-surface-line bg-surface-muted transition-all ${
          expanded ? 'w-52' : 'w-14'
        }`}
      >
        <div className="flex h-14 items-center justify-center border-b border-surface-line">
          <img src={monogram} alt="CG" className="h-6 w-auto" />
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Admin Center">
          {visibleNav.map((n) => {
            const Icon = n.icon
            const active = page === n.page
            return (
              <button
                key={n.page}
                onClick={() => setPage(n.page)}
                title={expanded ? undefined : n.label}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm ${
                  active
                    ? 'bg-cg-orange-soft font-medium text-cg-orange'
                    : 'text-charcoal/70 hover:bg-surface hover:text-charcoal'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {expanded && <span className="truncate">{n.label}</span>}
              </button>
            )
          })}
        </nav>
        <div className="border-t border-surface-line p-2">
          <button
            onClick={onReturn}
            title={expanded ? undefined : 'Return to People Center'}
            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-charcoal/70 hover:bg-surface hover:text-charcoal"
          >
            <ArrowLeft className="h-5 w-5 shrink-0" />
            {expanded && <span className="truncate">Return to People Center</span>}
          </button>
        </div>
        <button
          onClick={toggleNav}
          aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
          className="m-2 flex items-center justify-center rounded-md p-2 text-charcoal/50 hover:bg-surface hover:text-charcoal"
        >
          {expanded ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-surface-line bg-surface px-4 sm:px-6">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-wide">Admin Center</span>
            <span className="hidden text-xs uppercase tracking-widest text-charcoal/40 sm:inline">
              People Center — Charcoal Group
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setHelpOpen(true)}
              title="Help"
              aria-label="Help"
              className="rounded-md border border-surface-line p-1.5 text-charcoal/60 hover:bg-surface-muted hover:text-cg-orange"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
            <UserMenu session={session} profile={profile} profileError={profileError} />
          </div>
        </header>
        <main className="flex-1 bg-surface">
          {page === 'users' ? (
            <UsersView session={session} profile={profile} />
          ) : page === 'coverage' ? (
            <CoverageView session={session} profile={profile} />
          ) : page === 'reviewers' ? (
            <ReviewersView session={session} profile={profile} />
          ) : page === 'job_descriptions' ? (
            <JobDescriptionsView session={session} profile={profile} />
          ) : page === 'uniforms' ? (
            <UniformsView session={session} profile={profile} />
          ) : page === 'interviews' ? (
            <InterviewsView session={session} profile={profile} />
          ) : page === 'mgmt_process' ? (
            <MgmtProcessView session={session} profile={profile} />
          ) : page === 'velocity' ? (
            <VelocityView session={session} profile={profile} />
          ) : page === 'activity' ? (
            <ActivityLogView session={session} profile={profile} />
          ) : (
            <Suspense fallback={<p className="p-6 text-sm text-charcoal/50">Loading…</p>}>
              <DataSourcesView profile={profile} session={session} />
            </Suspense>
          )}
        </main>
      </div>

      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}

      <FeedbackWidget screen={`Admin — ${activeLabel}`} />
    </div>
  )
}
