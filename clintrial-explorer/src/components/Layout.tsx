import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  FlaskConical,
  Pill,
  Dna,
  MapPin,
  Bookmark,
  RefreshCw,
  Menu,
  Home,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBookmarks } from '@/hooks/useBookmarks'
import { GlobalFilterBar } from '@/components/GlobalFilterBar'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/trials', icon: FlaskConical, label: 'Trials' },
  { to: '/molecules', icon: Pill, label: 'Molecules' },
  { to: '/therapeutic-areas', icon: Dna, label: 'Therapeutic Areas' },
  { to: '/sites', icon: MapPin, label: 'Sites' },
  { to: '/bookmarks', icon: Bookmark, label: 'Bookmarks' },
  { to: '/sync', icon: RefreshCw, label: 'Sync' },
] as const

const breadcrumbLabels: Record<string, string> = {
  trials: 'Trials',
  molecules: 'Molecules',
  'therapeutic-areas': 'Therapeutic Areas',
  sites: 'Sites',
  bookmarks: 'Bookmarks',
  sync: 'Sync Status',
}

/** App shell with sidebar navigation, top bar with breadcrumbs, and global filter bar */
export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { count } = useBookmarks()
  const location = useLocation()

  const segments = location.pathname.split('/').filter(Boolean)

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
          {navItems.map(({ to, icon: Icon, label }) => (
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
        </main>
      </div>
    </div>
  )
}
