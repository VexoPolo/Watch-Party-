import type { CSSProperties } from "react";
import { Crown } from "lucide-react";
import { cx } from "./cx";

/**
 * Initial on a colored disc. Member colors come from the server (each viewer gets one),
 * so `color` is data, not a design token.
 */
export function Avatar({
  name,
  color,
  size = 32,
  dim,
  host,
  className,
}: {
  name: string;
  color: string;
  size?: number;
  dim?: boolean;
  host?: boolean;
  className?: string;
}) {
  const style: CSSProperties = { width: size, height: size, background: color, fontSize: Math.max(12, Math.round(size * 0.4)) };
  return (
    <span className={cx("relative inline-flex shrink-0", className)} title={name}>
      <span
        aria-hidden
        style={style}
        className={cx("grid place-items-center rounded-full font-display font-bold text-on-accent ring-2 ring-bg", dim && "opacity-40 grayscale")}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      {host && (
        <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-warning text-on-accent ring-2 ring-bg" title="Host">
          <Crown aria-hidden size={10} strokeWidth={2.5} />
        </span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

/** Overlapping avatars with a "+N" overflow bubble. */
export function AvatarStack({ people, max = 4, size = 32 }: { people: { id: string; name: string; color: string }[]; max?: number; size?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="flex items-center -space-x-2">
      {shown.map((p) => (
        <Avatar key={p.id} name={p.name} color={p.color} size={size} />
      ))}
      {extra > 0 && (
        <span
          style={{ width: size, height: size }}
          className="grid place-items-center rounded-full bg-field text-xs font-semibold text-fg-muted ring-2 ring-bg"
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
