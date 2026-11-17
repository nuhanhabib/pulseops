"use client";

import { Check } from "lucide-react";
import { DropdownMenu as Menu, Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/cn";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

const panel = "z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-overlay p-1 shadow-lg data-[state=open]:animate-pop-in";
const item = "relative flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm text-text outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-3 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted";

export function DropdownMenuContent({ className, sideOffset = 6, align = "end", ...props }: React.ComponentProps<typeof Menu.Content>) {
  return <Menu.Portal><Menu.Content sideOffset={sideOffset} align={align} collisionPadding={8} className={cn(panel, className)} {...props} /></Menu.Portal>;
}
export function DropdownMenuItem({ className, destructive, ...props }: React.ComponentProps<typeof Menu.Item> & { destructive?: boolean }) {
  return <Menu.Item className={cn(item, destructive && "text-danger-fg data-highlighted:bg-danger-soft [&_svg]:text-danger-fg", className)} {...props} />;
}
export function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(item, "pr-8", className)} {...props}>
      {children}
      <Menu.ItemIndicator className="absolute right-2"><Check className="size-3.5! text-brand-text!" /></Menu.ItemIndicator>
    </Menu.CheckboxItem>
  );
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn("px-2 py-1.5 text-2xs font-medium tracking-wide text-muted uppercase", className)} {...props} />;
}
export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;
export function PopoverContent({ className, sideOffset = 6, align = "end", ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content sideOffset={sideOffset} align={align} collisionPadding={8} className={cn("z-50 rounded-lg border border-border bg-overlay shadow-lg outline-none data-[state=open]:animate-pop-in", className)} {...props} />
    </PopoverPrimitive.Portal>
  );
}
