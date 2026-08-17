"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Briefcase,
  Buildings,
  ChartLine,
  Gear,
  Heartbeat,
  House,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  SignOut,
  Users,
  WarningCircle,
} from "@phosphor-icons/react";
import { Brand } from "./brand";
import { AssistantPanel } from "./assistant/assistant-panel";
import type { SessionPayload } from "@/lib/security/session";

const primary = [
  { href: "/dashboard", label: "Inicio", icon: House },
  { href: "/cases", label: "Expedientes", icon: Briefcase },
  { href: "/search", label: "Buscar", icon: MagnifyingGlass },
  { href: "/courts", label: "Órganos", icon: Buildings },
  { href: "/alerts", label: "Alertas", icon: Bell },
];

const secondary = [
  { href: "/status", label: "Estado", icon: Heartbeat },
  { href: "/settings", label: "Configuración", icon: Gear },
  { href: "/admin", label: "Administración", icon: ShieldCheck },
];

export function AppShell({ children, session }: { children: React.ReactNode; session: SessionPayload }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  const initials = session.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Brand href="/dashboard" />
        <div className="nav-section">
          <p className="nav-label">Trabajo</p>
          {primary.map((item) => (
            <Link key={item.href} className="nav-item" href={item.href} data-active={active(item.href)}>
              <item.icon size={18} weight={active(item.href) ? "fill" : "regular"} aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </div>
        <div className="nav-section">
          <p className="nav-label">Sistema</p>
          {secondary.map((item) => (
            <Link key={item.href} className="nav-item" href={item.href} data-active={active(item.href)}>
              <item.icon size={18} weight={active(item.href) ? "fill" : "regular"} aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </div>
        <div className="nav-spacer" />
        <div className="org-switch">
          <span className="org-avatar">{initials}</span>
          <div><strong>{session.organizationName}</strong><small>Espacio de trabajo</small></div>
        </div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <form className="global-search" action="/search">
            <MagnifyingGlass size={17} aria-hidden="true" />
            <input name="expediente" aria-label="Búsqueda global" placeholder="Número de expediente…" />
            <kbd>⌘ K</kbd>
          </form>
          <div className="top-actions">
            <Link className="button button-primary button-small" href="/cases/new"><Plus size={14} weight="bold" /> Agregar expediente</Link>
            <button className="icon-button" type="button" aria-label="Avisos del sistema"><WarningCircle size={19} /></button>
            <Link className="icon-button" href="/alerts" aria-label="Notificaciones"><Bell size={19} /></Link>
            <div className="profile-mini">
              <span>{initials}</span>
              <div><strong style={{ display: "block", fontSize: 10 }}>{session.name}</strong><small className="muted" style={{ fontSize: 8 }}>{session.role}</small></div>
            </div>
            <form action="/api/auth/logout" method="post">
              <button className="icon-button" type="submit" aria-label="Cerrar sesión"><SignOut size={19} /></button>
            </form>
          </div>
        </header>
        {children}
      </main>
      <AssistantPanel firstName={session.name.split(" ")[0]} />
    </div>
  );
}

export function EmptyAdminIcons() {
  return <><Buildings /><Users /><ChartLine /></>;
}
