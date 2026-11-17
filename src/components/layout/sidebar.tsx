"use client";

import { Check, ChevronsUpDown, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LogoMark } from "@/components/ui/logo";
import { Tooltip } from "@/components/ui/tooltip";
import { useOrg } from "@/features/org/org-context";
import { type ConnectionState, useConnectionState } from "@/features/realtime/realtime-provider";
import { cn } from "@/lib/cn";
import { ROLE_LABELS } from "@/shared/permissions";
import { routes } from "@/shared/routes";

import { type NavItem, navItems } from "./nav";

function OrgSwitcher({ collapsed }: { collapsed: boolean }) {
  const org = useOrg();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn("flex h-10 w-full items-center gap-2.5 rounded-lg px-1.5 text-left transition-colors hover:bg-surface-2", collapsed && "justify-center px-0")} aria-label={`Organization: ${org.organization.name}. Switch organization`}>
          <LogoMark className="size-7 shrink-0" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm leading-4 font-semibold text-text">{org.organization.name}</span>
                <span className="block text-2xs leading-4 text-muted">{ROLE_LABELS[org.role]}</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {org.memberships.map((membership) => (
          <DropdownMenuItem key={membership.organization.id} asChild>
            <Link href={routes.org(membership.organization.slug).dashboard}>
              <span className="min-w-0 flex-1 truncate">{membership.organization.name}</span>
              {membership.organization.isDemo && <Badge tone="outline">Demo</Badge>}
              {membership.organization.id === org.organization.id && <Check className="text-brand-text!" />}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href={routes.newOrganization}><Plus />New organization</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium transition-colors",
        active ? "bg-surface-3 text-text" : "text-text-2 hover:bg-surface-2 hover:text-text",
        collapsed && "justify-center px-0",
      )}
    >
      <item.icon className={cn("size-4 shrink-0", active ? "text-brand-text" : "text-muted group-hover:text-text-2")} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
  return collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link;
}

const CONNECTION: Record<ConnectionState, { label: string; dot: string }> = {
  live: { label: "Live updates on", dot: "bg-ok" },
  connecting: { label: "Connecting…", dot: "bg-neutral" },
  reconnecting: { label: "Reconnecting…", dot: "bg-warn" },
};

export function SidebarContent({ collapsed = false, onToggle, onNavigate }: { collapsed?: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const org = useOrg();
  const connection = CONNECTION[useConnectionState()];
  const items = navItems(org.paths);
  const visible = (list: NavItem[]) => list.filter((item) => !item.permission || org.can(item.permission));
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <OrgSwitcher collapsed={collapsed} />
      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5">
        {visible(items.main).map((item) => <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} />)}
        <div className="my-2 h-px bg-border" />
        {visible(items.secondary).map((item) => <NavLink key={item.href} item={item} collapsed={collapsed} onNavigate={onNavigate} />)}
      </nav>
      <div className={cn("flex items-center justify-between gap-2", collapsed && "flex-col")}>
        <Tooltip content={connection.label} side="right">
          <span className="flex items-center gap-2 px-2 text-xs text-muted" role="status">
            <span className={cn("size-1.5 rounded-full", connection.dot)} />
            {!collapsed && connection.label}
          </span>
        </Tooltip>
        {onToggle && (
          <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"} side="right">
            <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
