import { Activity, BarChart3, Globe, LayoutDashboard, type LucideIcon, ScrollText, Settings, Siren } from "lucide-react";

import type { Permission } from "@/shared/permissions";
import type { OrgRoutes } from "@/shared/routes";

export interface NavItem { label: string; href: string; icon: LucideIcon; permission?: Permission; shortcut?: string }

export function navItems(paths: OrgRoutes): { main: NavItem[]; secondary: NavItem[] } {
  return {
    main: [
      { label: "Dashboard", href: paths.dashboard, icon: LayoutDashboard, shortcut: "D" },
      { label: "Monitors", href: paths.monitors, icon: Activity, shortcut: "M" },
      { label: "Incidents", href: paths.incidents, icon: Siren, shortcut: "I" },
      { label: "Analytics", href: paths.analytics, icon: BarChart3, shortcut: "A" },
      { label: "Status pages", href: paths.statusPages, icon: Globe, shortcut: "S" },
    ],
    secondary: [
      { label: "Audit log", href: paths.auditLog, icon: ScrollText, permission: "audit:read" },
      { label: "Settings", href: paths.settings, icon: Settings },
    ],
  };
}
