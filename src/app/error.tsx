"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main role="alert" className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-danger-soft text-danger-fg"><AlertTriangle className="size-6" /></div>
      <h1 className="mt-5 text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">The page hit an unexpected error. Your data is safe. Try again, and if it keeps happening, reload the page.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-faint">Reference: {error.digest}</p>}
      <div className="mt-6 flex gap-2"><Button variant="primary" onClick={reset}>Try again</Button><Button onClick={() => window.location.reload()}>Reload</Button></div>
    </main>
  );
}
