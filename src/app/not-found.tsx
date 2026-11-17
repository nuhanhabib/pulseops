import { Compass } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted"><Compass className="size-6" /></div>
      <p className="mt-5 font-mono text-xs text-muted">404</p>
      <h1 className="mt-1 text-2xl font-semibold">This page could not be found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">The link may be out of date, or you may not have access to what it points to.</p>
      <div className="mt-6 flex gap-2"><Button asChild variant="primary"><Link href="/org">Go to your workspace</Link></Button><Button asChild><Link href="/">Home</Link></Button></div>
    </main>
  );
}
