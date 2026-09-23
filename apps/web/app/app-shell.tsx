"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOutAction } from "./actions";
import ThemeToggle from "./theme-toggle";

// Sidebar app shell ported from lohela's frontend (App.tsx): brand + grouped icon nav on the left,
// slim status header on top, bottom tab bar on phones. Sign-in renders standalone, as in lohela.

type NavItem = { href: string; label: string; icon: IconName; hint: string };
type IconName = "home" | "sparkles" | "chart" | "shield" | "login";

const WORKSPACE: NavItem[] = [
  { href: "/", label: "Overview", icon: "home", hint: "How HighOdds works" },
  { href: "/dashboard", label: "Dashboard", icon: "sparkles", hint: "Today's published research" },
  { href: "/results", label: "Results", icon: "chart", hint: "Verified paper history" }
];
const ADMIN: NavItem = { href: "/admin", label: "Admin", icon: "shield", hint: "System administration" };
const SIGN_IN: NavItem = { href: "/signin", label: "Sign in", icon: "login", hint: "Subscriber and admin access" };

function NavIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="M4 11 12 4l8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-5h4v5" /></>,
    sparkles: <><path d="m12 3-1.2 4.1L7 8.3l3.8 1.2L12 13l1.2-3.5L17 8.3l-3.8-1.2L12 3Z" /><path d="m5 14-.7 2.3L2 17l2.3.7L5 20l.7-2.3L8 17l-2.3-.7L5 14Z" /></>,
    chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-3Z" /><path d="m9 12 2 2 4-4" /></>,
    login: <><path d="M14 4h5v16h-5" /><path d="M10 16l4-4-4-4" /><path d="M14 12H4" /></>
  };
  return <svg className="nav-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">H</span>;
}

export default function AppShell({ email, isAdmin, children }: Readonly<{ email: string | null; isAdmin: boolean; children: ReactNode }>) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  if (pathname === "/signin" || pathname.startsWith("/signin/")) {
    return <div className="auth-standalone"><div className="auth-theme"><ThemeToggle /></div>{children}</div>;
  }

  const workspace = WORKSPACE.filter((item) => item.href !== "/dashboard" || email);
  const allItems = [...workspace, ...(isAdmin ? [ADMIN] : [])];
  const current = allItems.find((item) => isActive(pathname, item.href));
  const mobileItems = email ? allItems : [...allItems, SIGN_IN];

  const navLink = (item: NavItem) => {
    const active = isActive(pathname, item.href);
    return (
      <a key={item.href} href={item.href} className={`nav-tab${active ? " active" : ""}`} aria-current={active ? "page" : undefined} title={item.hint}>
        <span className="nav-icon"><NavIcon name={item.icon} /></span>{item.label}
      </a>
    );
  };

  return (
    <div className="app">
      <aside className="app-sidebar">
        <a className="brand" href="/" aria-label="HighOdds home">
          <BrandMark />
          <span className="brand-copy">
            <span className="brand-name">HighOdds</span>
            <span className="brand-tagline">Evidence-led paper analysis</span>
          </span>
        </a>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          <span className="sidebar-label">Workspace</span>
          {workspace.map(navLink)}
          {isAdmin && <>
            <span className="sidebar-label sidebar-label-admin">System</span>
            {navLink(ADMIN)}
          </>}
        </nav>
        <div className="sidebar-account">
          {email ? (
            <div className="auth-session">
              <span className="auth-status" title={email}>{isAdmin ? "Admin" : "Subscriber"} · {email}</span>
              <form action={signOutAction}><button type="submit" className="theme-btn auth-signout">Sign out</button></form>
            </div>
          ) : (
            <a className="theme-btn auth-signin" href="/signin">Sign in</a>
          )}
        </div>
      </aside>

      <header className="app-header">
        <a className="brand brand-compact" href="/" aria-label="HighOdds home"><BrandMark /></a>
        <div className="main-header-status">
          <span className="research-status"><span className="status-dot" /> Paper research</span>
          <ThemeToggle />
        </div>
        {current && <div className="global-page-context"><strong>{current.label}</strong><span>{current.hint}</span></div>}
        <button type="button" className="global-refresh" onClick={() => router.refresh()} title="Refresh current page" aria-label="Refresh current page">↻ <span>Refresh</span></button>
        {email && <form action={signOutAction} className="header-signout"><button type="submit" className="theme-btn">Sign out</button></form>}
      </header>

      <main className="main" id="main-content" tabIndex={-1}>
        {children}
        <footer className="app-footer">18+ · Paper analysis only · No guaranteed outcomes</footer>
      </main>

      <nav className="bottom-nav" aria-label="Primary navigation" style={{ gridTemplateColumns: `repeat(${mobileItems.length}, 1fr)` }}>
        {mobileItems.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <a key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              <span aria-hidden="true"><NavIcon name={item.icon} /></span>
              {item.label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
