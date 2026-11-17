import { ArrowRight, Menu } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Logo } from "@/components/ui/logo";
import { APP_NAME, APP_TAGLINE } from "@/shared/constants";
import { routes } from "@/shared/routes";

const NAV = [
  { label: "Product", href: routes.product },
  { label: "Features", href: routes.features },
  { label: "Pricing", href: routes.pricing },
  { label: "Docs", href: routes.docs },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-5">
        <Link href="/" aria-label={`${APP_NAME} home`}><Logo /></Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
          {NAV.map((item) => <Link key={item.href} href={item.href} className="text-sm text-text-2 transition-colors hover:text-text">{item.label}</Link>)}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" className="hidden sm:inline-flex"><Link href={routes.signIn}>Sign in</Link></Button>
          <Button asChild variant="primary"><Link href={routes.signUp}>Get started</Link></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu"><Menu /></Button></DropdownMenuTrigger>
            <DropdownMenuContent className="w-48">
              {NAV.map((item) => <DropdownMenuItem key={item.href} asChild><Link href={item.href}>{item.label}</Link></DropdownMenuItem>)}
              <DropdownMenuItem asChild><Link href={routes.signIn}>Sign in</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

const FOOTER = [
  { title: "Product", links: [["Overview", routes.product], ["Features", routes.features], ["Pricing", routes.pricing]] },
  { title: "Resources", links: [["Documentation", routes.docs], ["Contact", routes.contact], ["Demo status page", routes.statusPage("northwind")]] },
  { title: "Account", links: [["Sign in", routes.signIn], ["Create account", routes.signUp]] },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted">{APP_TAGLINE}</p>
        </div>
        {FOOTER.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="font-sans text-xs font-medium tracking-wide text-muted uppercase">{column.title}</h2>
            <ul className="mt-3 flex flex-col gap-2">{column.links.map(([label, href]) => <li key={href}><Link href={href} className="text-sm text-text-2 hover:text-text">{label}</Link></li>)}</ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-5 py-5 text-xs text-muted">{APP_NAME} is an open-source project by{" "}
          <a href="https://github.com/nuhanhabib" className="text-text-2 underline-offset-4 hover:text-text hover:underline">Nuhan Habib</a>, released under the MIT License. It is a portfolio and reference implementation, not a hosted commercial service.</p>
      </div>
    </footer>
  );
}

export function Section({ eyebrow, title, description, children, className }: { eyebrow?: string; title: string; description?: string; children?: React.ReactNode; className?: string }) {
  return (
    <section className={`mx-auto max-w-6xl px-5 py-16 sm:py-20 ${className ?? ""}`}>
      <div className="max-w-2xl">
        {eyebrow && <p className="text-sm font-medium text-brand-text">{eyebrow}</p>}
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        {description && <p className="mt-3 text-md text-text-2">{description}</p>}
      </div>
      {children && <div className="mt-10">{children}</div>}
    </section>
  );
}

export function PageHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="relative overflow-hidden border-b border-border">
      <div className="grid-fade pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <p className="text-sm font-medium text-brand-text">{eyebrow}</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl sm:leading-[1.08]">{title}</h1>
        <p className="mt-4 max-w-2xl text-md text-text-2 sm:text-lg">{description}</p>
      </div>
    </div>
  );
}

export function CallToAction() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-20">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-surface px-6 py-12 text-center sm:px-12">
        <div className="grid-fade pointer-events-none absolute inset-0 opacity-50" aria-hidden />
        <div className="relative">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">See it running in two minutes</h2>
          <p className="mx-auto mt-3 max-w-xl text-md text-text-2">Clone the repository, start the stack with Docker Compose, and explore a seeded demo workspace with live checks. Or create an account on this instance.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button asChild variant="primary" size="lg"><Link href={routes.signUp}>Create an account<ArrowRight /></Link></Button>
            <Button asChild size="lg"><Link href={routes.docs}>Read the quickstart</Link></Button>
          </div>
        </div>
      </div>
    </section>
  );
}
