'use client';

/**
 * Application chrome: brand header, collapsible desktop sidebar, mobile bottom
 * navigation, global search and the language switch.
 */

import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import {
  LayoutDashboard, Briefcase, CheckCircle2, Bell, Package, CalendarDays,
  Users, Inbox, ScrollText, Search, Menu, Languages, Moon, Sun, LogOut,
} from 'lucide-react';
import { LOGO_LOCAL } from '@/lib/brand';
import { t, dir, type Lang } from '@/lib/i18n';
import { useReminderAlerts } from '@/lib/reminder-alerts';

/* ----------------------------------------------------------------- User */

export type ShellUser = { name?: string | null; email?: string | null; role?: string };
const UserContext = React.createContext<ShellUser | undefined>(undefined);
/** The signed-in caller's name/email/role, as resolved server-side in layout.tsx. */
export const useUser = () => React.useContext(UserContext);

/* ------------------------------------------------------------- Language */

type LangCtx = { lang: Lang; setLang: (l: Lang) => void };
const LangContext = React.createContext<LangCtx>({ lang: 'en', setLang: () => {} });
export const useLang = () => React.useContext(LangContext);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>('en');

  React.useEffect(() => {
    const saved = window.localStorage.getItem('trt-lang') as Lang | null;
    if (saved === 'fa' || saved === 'en') setLangState(saved);
  }, []);

  const setLang = React.useCallback((l: Lang) => {
    setLangState(l);
    window.localStorage.setItem('trt-lang', l);
    document.documentElement.lang = l;
    document.documentElement.dir = dir(l);
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir(lang);
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>
  );
}

/* ----------------------------------------------------------------- Logo */

/**
 * The supplied lockup — laurel, TOTAL, "Plomberie & Construction", the tagline
 * and "Hamed Tabrizi" — reproduced whole. It is white and gold artwork, so it
 * sits on an ink plate to read at full contrast in both themes, and nothing is
 * cropped or substituted at any size.
 */
export function Logo({ size = 34, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        className="flex items-center justify-center rounded-lg bg-[#0B0F14] px-2"
        style={{ height: size + 10 }}
      >
        <Image
          src={LOGO_LOCAL}
          alt="TotalRÊNOTECH — Plomberie & Construction — Hamed Tabrizi"
          width={Math.round(size * 1.54)}
          height={size}
          priority
          unoptimized
          style={{ height: size, width: 'auto', objectFit: 'contain' }}
        />
      </span>
      {withWordmark && (
        <span className="hidden flex-col leading-none sm:flex">
          <span className="text-[13px] font-bold tracking-tight text-[var(--text)]">
            TotalRÊNOTECH
          </span>
          <span className="text-[10px] font-medium text-gold">Operations Control</span>
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------ Nav model */

type NavItem = { href: string; icon: React.ElementType; key: keyof ReturnType<typeof t> };

const NAV: NavItem[] = [
  { href: '/', icon: LayoutDashboard, key: 'dashboard' },
  { href: '/jobs', icon: Briefcase, key: 'jobs' },
  { href: '/completed', icon: CheckCircle2, key: 'completed' },
  { href: '/reminders', icon: Bell, key: 'reminders' },
  { href: '/materials', icon: Package, key: 'materials' },
  { href: '/logs', icon: CalendarDays, key: 'dailyLogs' },
  { href: '/team', icon: Users, key: 'team' },
  { href: '/inbox', icon: Inbox, key: 'inbox' },
  { href: '/audit', icon: ScrollText, key: 'audit' },
];

/** Five most-used destinations get the mobile bar. */
const MOBILE_NAV = [NAV[0], NAV[1], NAV[3], NAV[4], NAV[7]];

/** Due-soon / mentioned-you count on the Reminders nav icon — the in-app "day before" alert. */
function NavBadge({ count }: { count: number }) {
  return (
    <span
      className="absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-bold leading-none text-white"
      aria-label={`${count} open alerts`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

/* ---------------------------------------------------------------- Shell */

export function AppShell({
  children, user,
}: { children: React.ReactNode; user?: { name?: string | null; email?: string | null; role?: string } }) {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, setLang } = useLang();
  const d = t(lang);

  const [collapsed, setCollapsed] = React.useState(false);
  const [dark, setDark] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const alerts = useReminderAlerts(Boolean(user?.email));

  React.useEffect(() => {
    const saved = window.localStorage.getItem('trt-collapsed') === '1';
    setCollapsed(saved);
    const theme = window.localStorage.getItem('trt-theme');
    if (theme === 'dark') { setDark(true); document.documentElement.classList.add('dark'); }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      window.localStorage.setItem('trt-collapsed', c ? '0' : '1');
      return !c;
    });
  };

  const toggleDark = () => {
    setDark((v) => {
      const next = !v;
      document.documentElement.classList.toggle('dark', next);
      window.localStorage.setItem('trt-theme', next ? 'dark' : 'light');
      return next;
    });
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/jobs?q=${encodeURIComponent(query)}`);
  };

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <UserContext.Provider value={user}>
    <div className="flex min-h-screen bg-[var(--canvas)]">
      {/* Desktop sidebar */}
      <aside
        className={clsx(
          'no-print sticky top-0 hidden h-screen shrink-0 flex-col border-e border-[var(--line)] bg-[var(--surface)] transition-all md:flex',
          collapsed ? 'w-[68px]' : 'w-60',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-[var(--line)] px-3">
          {collapsed ? <Logo size={26} withWordmark={false} /> : <Logo size={30} />}
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map(({ href, icon: Icon, key }) => (
            <Link
              key={href}
              href={href}
              title={d[key] as string}
              className={clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                isActive(href)
                  ? 'bg-brand text-white'
                  : 'text-[var(--text-muted)] hover:bg-brand-wash hover:text-brand',
              )}
            >
              <span className="relative shrink-0">
                <Icon size={18} />
                {href === '/reminders' && alerts.total > 0 && <NavBadge count={alerts.total} />}
              </span>
              {!collapsed && <span className="truncate">{d[key] as string}</span>}
            </Link>
          ))}
        </nav>

        <div className="border-t border-[var(--line)] p-2">
          <button
            onClick={toggleCollapsed}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-brand-wash hover:text-brand"
          >
            <Menu size={18} className="shrink-0" />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky top bar */}
        <header className="no-print sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-[var(--line)] bg-[var(--surface)]/95 px-3 backdrop-blur md:px-4">
          <div className="md:hidden"><Logo size={26} withWordmark={false} /></div>

          <form onSubmit={submitSearch} className="relative min-w-0 flex-1 max-w-xl">
            <Search
              size={15}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={d.search}
              aria-label={d.search}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--canvas)] py-2 pe-3 ps-9 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-brand focus:outline-none"
            />
          </form>

          <button
            onClick={() => setLang(lang === 'en' ? 'fa' : 'en')}
            title={d.language}
            className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[var(--text-muted)] hover:bg-brand-wash hover:text-brand"
          >
            <Languages size={16} />
            <span className="hidden sm:inline">{lang === 'en' ? 'فا' : 'EN'}</span>
          </button>

          <button
            onClick={toggleDark}
            title="Theme"
            className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-brand-wash hover:text-brand"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {user?.email && (
            <div className="hidden items-center gap-2 border-s border-[var(--line)] ps-3 lg:flex">
              <div className="text-end leading-tight">
                <p className="text-xs font-semibold text-[var(--text)]">
                  {user.name ?? user.email}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-gold">{user.role}</p>
              </div>
              <a
                href="/api/auth/signout"
                title={d.signOut}
                className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-brand-wash hover:text-brand"
              >
                <LogOut size={16} />
              </a>
            </div>
          )}
        </header>

        <main className="min-w-0 flex-1 px-3 pb-24 pt-4 md:px-5 md:pb-8">{children}</main>

        {/* Mobile bottom navigation */}
        <nav className="no-print fixed bottom-0 z-40 flex w-full items-stretch border-t border-[var(--line)] bg-[var(--surface)] md:hidden">
          {MOBILE_NAV.map(({ href, icon: Icon, key }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition',
                isActive(href) ? 'text-brand' : 'text-[var(--text-muted)]',
              )}
            >
              <span className="relative">
                <Icon size={19} />
                {href === '/reminders' && alerts.total > 0 && <NavBadge count={alerts.total} />}
              </span>
              <span className="truncate px-1">{d[key] as string}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
    </UserContext.Provider>
  );
}
