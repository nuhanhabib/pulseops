"use client";

import { FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useRef, useState } from "react";

import { SheetContent } from "@/components/ui/dialog";
import { useOrg } from "@/features/org/org-context";
import { cn } from "@/lib/cn";

import { BreadcrumbProvider } from "./breadcrumbs";
import { CommandPalette } from "./command-palette";
import { navItems } from "./nav";
import { SidebarContent } from "./sidebar";
import { Topbar } from "./topbar";

const COLLAPSE_KEY = "pulseops-sidebar-collapsed";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The authenticated frame: collapsible sidebar on desktop, a drawer on small
 * screens, the top bar, the command palette, and global keyboard shortcuts
 * (⌘K or "/" to search, "g" then a letter to navigate).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const org = useOrg();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const pendingG = useRef<number>(0);

  useEffect(() => {
    try {
      // Restoring a stored preference after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {}
  }, []);

  useEffect(() => {
    const items = navItems(org.paths).main;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "/") {
        event.preventDefault();
        setPalette(true);
      } else if (event.key.toLowerCase() === "g") {
        pendingG.current = Date.now();
      } else if (Date.now() - pendingG.current < 1200) {
        const match = items.find((item) => item.shortcut?.toLowerCase() === event.key.toLowerCase());
        pendingG.current = 0;
        if (match) router.push(match.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [org.paths, router]);

  const toggle = () =>
    setCollapsed((value) => {
      try { localStorage.setItem(COLLAPSE_KEY, value ? "0" : "1"); } catch {}
      return !value;
    });

  return (
    <BreadcrumbProvider>
      <div className="flex min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:bg-brand focus:px-3 focus:py-2 focus:text-brand-fg">Skip to content</a>
        <aside className={cn("sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-surface transition-[width] duration-200 ease-out lg:block", collapsed ? "w-14" : "w-60")}>
          <SidebarContent collapsed={collapsed} onToggle={toggle} />
        </aside>
        <DialogPrimitive.Root open={drawer} onOpenChange={setDrawer}>
          <SheetContent side="left" aria-describedby={undefined}>
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <SidebarContent onNavigate={() => setDrawer(false)} />
          </SheetContent>
        </DialogPrimitive.Root>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onOpenSearch={() => setPalette(true)} onOpenNav={() => setDrawer(true)} />
          {org.organization.isDemo && (
            <div className="flex items-center gap-2 border-b border-border bg-brand-soft px-4 py-1.5 text-xs text-text-2 sm:px-6">
              <FlaskConical className="size-3.5 shrink-0 text-brand-text" aria-hidden />
              <span><span className="font-medium text-text">Demo workspace.</span> History before the seed is generated sample data; checks since then are real results from the bundled target simulator.</span>
            </div>
          )}
          <main id="main" className="flex-1">{children}</main>
        </div>
        <CommandPalette open={palette} onOpenChange={setPalette} />
      </div>
    </BreadcrumbProvider>
  );
}

/** What the static shell shows while the session is being resolved. */
export function AppShellSkeleton() {
  return (
    <div className="flex min-h-dvh" aria-busy="true" aria-label="Loading workspace">
      <aside className="hidden h-dvh w-60 shrink-0 flex-col gap-3 border-r border-border bg-surface p-3 lg:flex">
        <div className="skeleton h-10" />
        {[0, 1, 2, 3, 4].map((row) => <div key={row} className="skeleton h-8" />)}
      </aside>
      <div className="flex-1">
        <div className="h-13 border-b border-border" />
        <div className="mx-auto max-w-[1400px] space-y-4 p-6">
          <div className="skeleton h-7 w-48" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((tile) => <div key={tile} className="skeleton h-24" />)}</div>
          <div className="skeleton h-72" />
        </div>
      </div>
    </div>
  );
}
