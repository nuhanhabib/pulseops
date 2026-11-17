import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/shared/format";

import { Button } from "./button";

/** Scrolls horizontally inside its own box, so a wide table never breaks the page layout. */
export function TableContainer({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("w-full overflow-x-auto", className)} {...props} />;
}
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}
export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return <th scope="col" className={cn("h-9 border-b border-border px-3 text-left text-xs font-medium whitespace-nowrap text-muted first:pl-5 last:pr-5", className)} {...props} />;
}
export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("h-12 border-b border-border px-3 align-middle first:pl-5 last:pr-5", className)} {...props} />;
}
export function Tr({ className, interactive, ...props }: React.ComponentProps<"tr"> & { interactive?: boolean }) {
  return <tr className={cn("group/row last:[&>td]:border-b-0", interactive && "transition-colors hover:bg-surface-2", className)} {...props} />;
}

export function Pagination({ page, totalPages, total, pageSize, onPageChange, noun }: { page: number; totalPages: number; total: number; pageSize: number; onPageChange: (page: number) => void; noun: string }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-border px-5 py-2.5">
      <p className="text-xs text-muted tabular">{formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)} {noun}</p>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft /></Button>
        <span className="px-1 text-xs text-text-2 tabular">Page {page} of {totalPages}</span>
        <Button size="icon-sm" variant="ghost" aria-label="Next page" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight /></Button>
      </div>
    </nav>
  );
}
