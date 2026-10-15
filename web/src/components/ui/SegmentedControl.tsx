"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** Small count shown after the label (e.g. unread / items). */
  badge?: number;
  icon?: ReactNode;
}

/**
 * Tabs that look like a pill switch. Uses the ARIA tabs pattern so screen readers announce
 * "tab, 2 of 4, selected" and the arrow keys move between segments.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  idPrefix,
  className,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** Lets each tab point at its panel: panels should use id={`${idPrefix}-panel-${value}`}. */
  idPrefix: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + segments.length) % segments.length;
    onChange(segments[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={cx("flex gap-1 rounded-md border border-accent/15 bg-bg/50 p-1", className)}>
      {segments.map((s, i) => {
        const active = s.value === value;
        return (
          <button
            key={s.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`${idPrefix}-tab-${s.value}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${s.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(s.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              "flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-sm px-2 text-sm font-semibold transition-colors duration-150",
              active ? "bg-accent/15 text-fg shadow-[inset_0_0_0_1px] shadow-accent/30" : "text-fg-subtle hover:text-fg-muted",
            )}
          >
            {s.icon}
            {s.label}
            {!!s.badge && <span className="rounded-full bg-accent/20 px-1.5 text-xs text-accent">{s.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
