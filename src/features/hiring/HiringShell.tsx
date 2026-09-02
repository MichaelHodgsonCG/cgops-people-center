// Hiring is its own section of the app (Michael's direction, 2026-09-02):
// entering it replaces the People Center shell with a hiring-specific one —
// its own left menu, with "Return to People Center" pinned at the bottom.
// Same rail/header language as AppShell so the switch reads as changing
// sections, not changing products, and the expand/collapse preference is
// shared with the main rail. New hiring pages (Phase 2: interviews,
// reference checks, decisions) slot in as NAV entries here.

import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowLeft,
  BookOpenText,
  ChevronsLeft,
  ChevronsRight,
  HelpCircle,
  Inbox,
  UserCog,
  type LucideIcon,
} from 'lucide-react'
import { can, toPermissionUser } from '../../permissions'
import type { UserProfile } from '../../types'
import { UserMenu } from '../../components/AppShell'
import { FeedbackWidget } from '../../components/FeedbackWidget'
import { HelpPanel } from '../help/HelpPanel'
import monogram from '../../assets/CG Logo Small.png'
import { ApplicationsView, ReviewersView } from './HiringView'
import { JobDescriptionsView } from './JobDescriptionsView'

type HiringPage = 'applications' | 'job_descriptions' | 'reviewers'

const NAV: { page: HiringPage; label: string; icon: LucideIcon; configureOnly?: boolean }[] = [
  { page: 'applications', label: 'Applications', icon: Inbox },
  { page: 'job_descriptions', label: 'Job Descriptions', icon: BookOpenText },
  { page: 'reviewers', label: 'Reviewers', icon: UserCog, configureOnly: true },
]

// Shared with AppShell so the rail stays the width the user chose.
const NAV_PREF_KEY = 'pc.nav.expanded'

interface HiringShellProps {
  session: Session
  profile: UserProfile | null
  profileError: string | null
  onReturn: () => void
}

export function HiringShell({ session, profile, profileError, onReturn }: HiringShellProps) {
  const user = profile ? toPermissionUser(profile) : null
  const visibleNav = NAV.filter((n) => !n.configureOnly || can(user, 'update', 'hiring'))
  const [page, setPage] = useState<HiringPage>('applications')
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

  const activeLabel = NAV.find((n) => n.page === page)?.label ?? 'Applications'

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
        <nav className="flex flex-1 flex-col gap-1 p-2" aria-label="Hiring">
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
        {/* The way back out of the section, pinned at the bottom of the menu */}
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
            <span className="text-sm font-semibold tracking-wide">Hiring</span>
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
          {page === 'reviewers' ? (
            <ReviewersView session={session} profile={profile} />
          ) : page === 'job_descriptions' ? (
            <JobDescriptionsView session={session} profile={profile} />
          ) : (
            <ApplicationsView session={session} profile={profile} />
          )}
        </main>
      </div>

      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}

      <FeedbackWidget screen={`Hiring — ${activeLabel}`} />
    </div>
  )
}
