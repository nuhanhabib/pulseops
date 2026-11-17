"use client";

import { AlertDialog } from "radix-ui";
import { useState } from "react";

import { Button } from "./button";
import { Input } from "./input";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  /** Destructive actions get a red button and default focus on Cancel. */
  destructive?: boolean;
  /** When set, the user must type this text before the action unlocks. */
  confirmText?: string;
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, confirmText, loading, onConfirm }: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const locked = Boolean(confirmText) && typed !== confirmText;
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => { if (!next) setTyped(""); onOpenChange(next); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-overlay p-5 shadow-lg data-[state=open]:animate-pop-in">
          <AlertDialog.Title className="text-md font-semibold text-text">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild><div className="mt-2 text-sm text-text-2">{description}</div></AlertDialog.Description>
          {confirmText && (
            <label className="mt-4 block text-sm text-text-2">
              Type <span className="font-mono font-medium text-text">{confirmText}</span> to confirm
              <Input className="mt-1.5" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
            </label>
          )}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild><Button disabled={loading}>Cancel</Button></AlertDialog.Cancel>
            <Button variant={destructive ? "danger" : "primary"} loading={loading} disabled={locked} onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
