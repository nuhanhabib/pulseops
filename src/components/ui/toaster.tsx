"use client";

import { Toaster as Sonner } from "sonner";

import { useTheme } from "@/components/providers/theme-provider";

export function Toaster() {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast: "!bg-overlay !border-border !text-text !shadow-lg !rounded-lg !font-sans !text-sm",
          description: "!text-muted",
          actionButton: "!bg-brand !text-brand-fg",
          closeButton: "!bg-overlay !border-border !text-muted",
        },
      }}
    />
  );
}
