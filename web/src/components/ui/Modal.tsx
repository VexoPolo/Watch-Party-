"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import { cx } from "./cx";

/**
 * Centered dialog over a dimmed backdrop. Escape or a backdrop click closes it;
 * focus moves into the dialog on open and returns to where it was on close.
 */
export function Modal({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("button, [href], input, select, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx("relative w-full max-w-md rounded-lg border border-accent/20 bg-surface p-6 shadow-card", className)}
      >
        <IconButton label="Close" size="sm" onClick={onClose} className="absolute right-3 top-3">
          <X size={18} strokeWidth={1.75} />
        </IconButton>
        {children}
      </div>
    </div>
  );
}
