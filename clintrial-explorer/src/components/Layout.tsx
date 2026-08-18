import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  FlaskConical,
  Pill,
  Dna,
  AlertTriangle,
  MapPin,
  Bookmark,
  Upload,
  Building2,
  Settings,
  Menu,
  Home,
  ChevronRight,
  LogOut,
} from 'lucide-react'
import { WipFooter } from '@wip/react'
import { cn } from '@/lib/utils'
import { useBookmarks } from '@/hooks/useBookmarks'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { GlobalFilterBar } from '@/components/GlobalFilterBar'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', adminOnly: false },
  { to: '/trials', icon: FlaskConical, label: 'Trials', adminOnly: false },
  { to: '/molecules', icon: Pill, label: 'Molecules', adminOnly: false },
  { to: '/therapeutic-areas', icon: Dna, label: 'Therapeutic Areas', adminOnly: false },
  { to: '/adverse-events', icon: AlertTriangle, label: 'Adverse Events', adminOnly: false },
  { to: '/sites', icon: MapPin, label: 'Sites', adminOnly: false },
  { to: '/bookmarks', icon: Bookmark, label: 'Bookmarks', adminOnly: false },
  { to: '/roche-studies', icon: Building2, label: 'TA Portal', adminOnly: false },
  { to: '/settings', icon: Settings, label: 'Settings', adminOnly: false },
  { to: '/import', icon: Upload, label: 'Import', adminOnly: true },
] as const

const breadcrumbLabels: Record<string, string> = {
  trials: 'Trials',
  molecules: 'Molecules',
  'therapeutic-areas': 'Therapeutic Areas',
  'adverse-events': 'Adverse Events',
  sites: 'Sites',
  bookmarks: 'Bookmarks',
  settings: 'Settings',
  rules: 'Classification Rules',
  'roche-studies': 'TA Portal',
  import: 'Import',
  sync: 'Import',
}

/** App shell with sidebar navigation, top bar with breadcrumbs, and global filter bar */
export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { count } = useBookmarks()
  const { data: currentUser } = useCurrentUser()
  const role = currentUser?.role ?? 'admin' // default to admin in dev (no auth)
  const isAdmin = role === 'admin'
  const location = useLocation()

  const segments = location.pathname.split('/').filter(Boolean)

  if (currentUser && role === 'none') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="max-w-md rounded-lg border bg-surface p-8 text-center shadow-sm">
          <h1 className="mb-2 text-xl font-semibold text-text">Access Denied</h1>
          <p className="mb-4 text-sm text-text-muted">
            You need to be a member of <strong>ct-user</strong> or <strong>ct-admin</strong> to access Clinical Trials Explorer.
          </p>
          {currentUser.user && (
            <p className="text-xs text-text-muted">
              Logged in as: {currentUser.user}<br />
              Groups: {currentUser.groups.join(', ') || 'none'}
            </p>
          )}
          <a
            href={`/auth/logout?return_to=${import.meta.env.BASE_URL || '/'}`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign in with a different account
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-56 flex-col bg-primary text-white transition-transform lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
          <FlaskConical className="h-5 w-5" />
          <span className="font-semibold text-sm">Clinical Trials</span>
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {navItems.filter((item) => !item.adminOnly || isAdmin).map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
              {label === 'Bookmarks' && count > 0 && (
                <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold leading-none">
                  {count}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        {currentUser?.user && (
          <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[11px] text-white/50">
            <span>
              {currentUser.user}
              <span className="ml-1 text-accent">({role})</span>
            </span>
            <a
              href={`/auth/logout?return_to=${import.meta.env.BASE_URL || '/'}`}
              className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
              title="Log out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center gap-3 border-b border-gray-200 bg-surface px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-text-muted hover:bg-gray-100 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <Link to="/" className="text-text-muted hover:text-primary">
            <Home className="h-4 w-4" />
          </Link>

          {segments.length > 0 && (
            <nav className="flex items-center gap-1 text-sm">
              {segments.map((seg, i) => (
                <span key={seg} className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3 text-text-muted" />
                  {i < segments.length - 1 ? (
                    <Link
                      to={`/${segments.slice(0, i + 1).join('/')}`}
                      className="text-text-muted hover:text-primary"
                    >
                      {breadcrumbLabels[seg] || seg}
                    </Link>
                  ) : (
                    <span className="font-medium text-text">
                      {breadcrumbLabels[seg] || decodeURIComponent(seg)}
                    </span>
                  )}
                </span>
              ))}
            </nav>
          )}
        </header>

        {/* Global filter bar + Page content */}
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <div className="mx-auto max-w-content space-y-4">
            <GlobalFilterBar />
            <Outlet />
          </div>
          <WipFooter
            appName="Clinical Trials Explorer"
            buildStamp={import.meta.env.VITE_BUILD_STAMP}
            buildSha={import.meta.env.VITE_BUILD_SHA}
          />
        </main>
      </div>
    </div>
  )
}
