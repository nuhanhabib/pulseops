"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PageContainer, PageHeader } from "@/components/ui/page";
import { useOrg } from "@/features/org/org-context";
import { cn } from "@/lib/cn";

export function SettingsShell({ children }: { children: React.ReactNode }) {
  const org = useOrg();
  const pathname = usePathname();
  const tabs = [
    { label: "General", href: org.paths.settings },
    { label: "Members", href: org.paths.settingsMembers },
    { label: "Notifications", href: org.paths.settingsNotifications },
    { label: "AI assistant", href: org.paths.settingsAi },
    { label: "Profile", href: org.paths.settingsProfile },
  ];
  return (
    <PageContainer className="max-w-5xl">
      <PageHeader title="Settings" description={`Manage ${org.organization.name} and your own account.`} />
      <nav aria-label="Settings sections" className="mb-6 flex gap-5 overflow-x-auto border-b border-border">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return <Link key={tab.href} href={tab.href} aria-current={active ? "page" : undefined} className={cn("-mb-px flex h-9 shrink-0 items-center border-b-2 text-sm font-medium transition-colors", active ? "border-brand text-text" : "border-transparent text-muted hover:text-text")}>{tab.label}</Link>;
        })}
      </nav>
      {children}
    </PageContainer>
  );
}
