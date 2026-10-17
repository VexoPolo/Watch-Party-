import { Children, type CSSProperties, type ReactNode } from "react";
import { cx } from "./cx";

/**
 * Endless scrolling strip, done in pure CSS (no animation library).
 *
 * How it works: the children are rendered twice, one copy after the other, and the whole
 * track slides by exactly 50% of its length. At that point the second copy sits where the
 * first one started, so the loop restarts without a visible jump.
 * Each item carries its own gap as padding so "50%" is exact.
 *
 * Users with "reduce motion" switched on get a still strip (see the global rule in globals.css).
 */
export function InfiniteSlider({
  children,
  direction = "horizontal",
  reverse = false,
  duration = 40,
  gap = 16,
  className,
}: {
  children: ReactNode;
  direction?: "horizontal" | "vertical";
  reverse?: boolean;
  /** Seconds for one full loop. Higher = slower. */
  duration?: number;
  /** Space between items in px. */
  gap?: number;
  className?: string;
}) {
  const vertical = direction === "vertical";
  const items = Children.toArray(children);
  const style = {
    animationDuration: `${duration}s`,
    animationDirection: reverse ? "reverse" : "normal",
  } as CSSProperties;
  const pad = vertical ? { paddingBottom: gap } : { paddingRight: gap };

  return (
    <div className={cx("overflow-hidden", className)}>
      <div className={cx("flex w-max", vertical ? "slide-y flex-col" : "slide-x flex-row")} style={style}>
        {[0, 1].map((copy) =>
          items.map((item, i) => (
            // The second copy is only there to make the loop seamless, so screen readers skip it.
            <div key={`${copy}-${i}`} style={pad} aria-hidden={copy === 1 || undefined}>
              {item}
            </div>
          )),
        )}
      </div>
    </div>
  );
}
