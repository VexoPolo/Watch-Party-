import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cx } from "./cx";

type BannerTone = "info" | "success" | "warning" | "danger";

const tones: Record<BannerTone, { box: string; icon: ReactNode }> = {
  info: { box: "border-accent/30 bg-accent/10 text-fg", icon: <Info aria-hidden size={18} strokeWidth={1.75} className="text-accent" /> },
  success: { box: "border-success/35 bg-success/10 text-fg", icon: <CircleCheck aria-hidden size={18} strokeWidth={1.75} className="text-success" /> },
  warning: { box: "border-warning/35 bg-warning/10 text-fg", icon: <TriangleAlert aria-hidden size={18} strokeWidth={1.75} className="text-warning" /> },
  danger: { box: "border-danger/40 bg-danger/10 text-fg", icon: <CircleAlert aria-hidden size={18} strokeWidth={1.75} className="text-danger" /> },
};

/** Inline message strip: tone color + icon + text, optional action on the right. */
export function Banner({
  tone = "info",
  title,
  children,
  action,
  icon,
  className,
}: {
  tone?: BannerTone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-3 rounded-md border px-4 py-3", t.box, className)}>
      <span className="mt-0.5 shrink-0">{icon ?? t.icon}</span>
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-fg-muted">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Stack of short-lived messages at the bottom of the screen. Announced politely to screen readers. */
export function ToastStack({ toasts }: { toasts: { id: number; text: string }[] }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex max-w-md items-center gap-2 rounded-md border border-accent/25 bg-surface px-4 py-3 text-sm text-fg shadow-card"
        >
          <Info aria-hidden size={16} strokeWidth={1.75} className="shrink-0 text-accent" />
          {t.text}
        </div>
      ))}
    </div>
  );
}
