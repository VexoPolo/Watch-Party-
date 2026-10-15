import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/**
 * Frosted surface: 70% surface color + background blur + 1px lavender border at 20%.
 * Use `solid` where blur would sit on top of the video (blur over video is expensive).
 */
export function Card({ className, solid, ...rest }: HTMLAttributes<HTMLDivElement> & { solid?: boolean }) {
  return (
    <div
      className={cx(
        "rounded-lg border border-accent/20 shadow-card",
        solid ? "bg-surface" : "bg-surface/70 backdrop-blur-xl",
        className,
      )}
      {...rest}
    />
  );
}

/** Small uppercase section label used inside cards. */
export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx("text-xs font-semibold uppercase tracking-[0.12em] text-fg-subtle", className)} {...rest} />;
}
