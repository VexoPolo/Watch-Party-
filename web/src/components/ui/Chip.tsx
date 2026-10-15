import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleDashed, LoaderCircle, TriangleAlert } from "lucide-react";
import { cx } from "./cx";

/** Toggleable filter chip (e.g. genre). `selected` sets aria-pressed for screen readers. */
export function Chip({ selected, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      aria-pressed={selected}
      className={cx(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors duration-150",
        selected ? "border-accent bg-accent text-on-accent" : "border-accent/22 text-fg-muted hover:border-accent/45 hover:text-fg",
        className,
      )}
      {...rest}
    />
  );
}

export type Tone = "success" | "warning" | "danger" | "neutral" | "busy";

const toneClass: Record<Tone, string> = {
  success: "border-success/35 bg-success/10 text-success",
  warning: "border-warning/35 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
  neutral: "border-accent/22 bg-field/80 text-fg-muted",
  busy: "border-accent/35 bg-accent/10 text-accent",
};

const toneIcon: Record<Tone, ReactNode> = {
  success: <CircleCheck aria-hidden size={14} strokeWidth={2} />,
  warning: <TriangleAlert aria-hidden size={14} strokeWidth={2} />,
  danger: <CircleAlert aria-hidden size={14} strokeWidth={2} />,
  neutral: <CircleDashed aria-hidden size={14} strokeWidth={2} />,
  busy: <LoaderCircle aria-hidden size={14} strokeWidth={2} className="animate-spin" />,
};

/** Status is never color alone: tone color + icon + text. */
export function StatusChip({ tone, icon, children, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone: Tone; icon?: ReactNode }) {
  return (
    <span
      role="status"
      className={cx("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold", toneClass[tone], className)}
      {...rest}
    >
      {icon ?? toneIcon[tone]}
      {children}
    </span>
  );
}
