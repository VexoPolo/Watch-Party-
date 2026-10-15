"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";

/**
 * A button that toggles a floating panel. Closes on outside click and on Escape
 * (returning focus to the trigger). `trigger` receives the props it must spread onto its button.
 */
export function Popover({
  trigger,
  children,
  side = "top",
  align = "end",
  label,
  className,
  solid,
}: {
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-controls": string; "aria-haspopup": "dialog" }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  side?: "top" | "bottom";
  align?: "start" | "end" | "center";
  label: string;
  className?: string;
  /** Opaque background (use over video, where backdrop blur is expensive). */
  solid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      wrap.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-controls": id, "aria-haspopup": "dialog" })}
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={label}
          className={cx(
            "absolute z-40 min-w-56 rounded-md border border-accent/20 p-2 shadow-card",
            solid ? "bg-surface" : "bg-surface/90 backdrop-blur-xl",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
            align === "end" ? "right-0" : align === "start" ? "left-0" : "left-1/2 -translate-x-1/2",
            className,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
