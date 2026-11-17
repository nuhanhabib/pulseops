"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { RelativeTime } from "@/components/ui/relative-time";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { orgKey, useOrg } from "@/features/org/org-context";
import { useOrgQuery } from "@/features/shared";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { pluralize } from "@/shared/format";
import { routes } from "@/shared/routes";
import { slugify } from "@/shared/schemas/organization";
import type { StatusPageDto } from "@/shared/types";

export function StatusPagesPage() {
  const org = useOrg();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pages = useOrgQuery<StatusPageDto[]>(["status-pages", "list"], "/status-pages");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const canWrite = org.can("statuspage:write");
  const effectiveSlug = slugTouched ? slug : slugify(name);

  const create = useMutation({
    mutationFn: () => api.post<StatusPageDto>(`${org.api}/status-pages`, { name, slug: effectiveSlug, monitors: [] }),
    onSuccess: (page) => {
      void queryClient.invalidateQueries({ queryKey: orgKey(org.organization.slug, "status-pages") });
      toast.success("Status page created", { description: "Choose what to show, then publish." });
      router.push(org.paths.statusPageEditor(page.id));
    },
  });
  const fields = create.error instanceof ApiError ? create.error.fields : {};

  return (
    <PageContainer>
      <PageHeader title="Status pages" description="Public pages that show customers the health of the services you choose. Nothing is public until you publish it."
        actions={canWrite && <Button variant="primary" onClick={() => setOpen(true)}><Plus />New status page</Button>} />
      {pages.isPending ? <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((card) => <Skeleton key={card} className="h-36 rounded-xl" />)}</div>
        : pages.isError ? <Card><ErrorState onRetry={() => pages.refetch()} /></Card>
        : pages.data.length === 0 ? <Card><EmptyState icon={Globe} title="No status pages yet" description="Create one, pick the monitors to show under public names, and share the link." action={canWrite ? <Button variant="primary" onClick={() => setOpen(true)}><Plus />New status page</Button> : undefined} /></Card>
        : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pages.data.map((page) => (
              <Card key={page.id} className="flex flex-col p-5 transition-colors hover:border-border-strong">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: page.accentColor }} />
                    <Link href={org.paths.statusPageEditor(page.id)} className="truncate text-base font-semibold hover:underline">{page.name}</Link>
                  </div>
                  <Badge tone={page.published ? "ok" : "neutral"}>{page.published ? "Published" : "Draft"}</Badge>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted">{routes.statusPage(page.slug)}</p>
                <p className="mt-3 line-clamp-2 min-h-10 text-sm text-text-2">{page.description ?? "No description."}</p>
                <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted">
                  <span>{pluralize(page.monitors.length, "component")} · updated <RelativeTime date={page.updatedAt} /></span>
                  <span className="flex gap-1">
                    {page.published && <Button asChild size="sm" variant="ghost"><a href={routes.statusPage(page.slug)} target="_blank" rel="noreferrer">View<ExternalLink /></a></Button>}
                    <Button asChild size="sm"><Link href={org.paths.statusPageEditor(page.id)}>{canWrite ? "Edit" : "Open"}</Link></Button>
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
            <DialogHeader><DialogTitle>New status page</DialogTitle><DialogDescription>It starts as a private draft.</DialogDescription></DialogHeader>
            <DialogBody className="flex flex-col gap-4">
              <Field label="Name" error={fields.name?.[0]}><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Status" autoFocus /></Field>
              <Field label="Public address" hint={`Visitors will open ${routes.statusPage(effectiveSlug || "your-page")}`} error={fields.slug?.[0]}>
                <Input value={effectiveSlug} onChange={(event) => { setSlugTouched(true); setSlug(event.target.value.toLowerCase()); }} className="font-mono" spellCheck={false} />
              </Field>
              {create.error && Object.keys(fields).length === 0 && <p role="alert" className="text-sm text-danger-fg">{errorMessage(create.error)}</p>}
            </DialogBody>
            <DialogFooter><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" loading={create.isPending} disabled={name.trim().length < 2}>Create draft</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
