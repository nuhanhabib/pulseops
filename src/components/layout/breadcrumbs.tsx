"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, use, useEffect, useMemo, useState } from "react";

import { useOrg } from "@/features/org/org-context";

const LABELS: Record<string, string> = {
  dashboard: "Dashboard", monitors: "Monitors", incidents: "Incidents", analytics: "Analytics", "status-pages": "Status pages",
  "audit-log": "Audit log", settings: "Settings", members: "Members", notifications: "Notifications", ai: "AI assistant",
  profile: "Profile", new: "New", edit: "Edit",
};

const TitleContext = createContext<{ title: string | null; setTitle: (title: string | null) => void } | null>(null);

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const value = useMemo(() => ({ title, setTitle }), [title]);
  return <TitleContext value={value}>{children}</TitleContext>;
}

/** Detail pages call this so the trail shows the record's name instead of its id. */
export function useBreadcrumbTitle(title: string | null | undefined) {
  const context = use(TitleContext);
  const setTitle = context?.setTitle;
  useEffect(() => {
    setTitle?.(title ?? null);
    return () => setTitle?.(null);
  }, [title, setTitle]);
}

export function Breadcrumbs() {
  const org = useOrg();
  const pathname = usePathname();
  const title = use(TitleContext)?.title;
  const segments = pathname.replace(org.paths.root, "").split("/").filter(Boolean);
  const crumbs = segments.map((segment, index) => ({
    href: `${org.paths.root}/${segments.slice(0, index + 1).join("/")}`,
    label: LABELS[segment] ?? (title && /^[0-9a-f-]{36}$/.test(segment) ? title : /^[0-9a-f-]{36}$/.test(segment) ? "Details" : segment),
  }));
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1 text-sm">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="hidden size-3.5 shrink-0 text-faint sm:block" aria-hidden />}
              {last ? <span aria-current="page" className="truncate font-medium text-text">{crumb.label}</span>
                : <Link href={crumb.href} className="hidden truncate text-muted transition-colors hover:text-text sm:inline">{crumb.label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
