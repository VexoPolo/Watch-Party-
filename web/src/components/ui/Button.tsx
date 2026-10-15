import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Icon shown before the label. */
  icon?: ReactNode;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  // Dark text on lavender — never white (contrast).
  primary: "bg-accent text-on-accent shadow-glow hover:bg-accent-hover active:bg-accent-pressed",
  secondary: "border border-accent/22 bg-field text-fg hover:border-accent/45",
  ghost: "text-fg-muted hover:bg-accent/10 hover:text-fg",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/15",
};

// Every size keeps a ≥44px touch target, except "sm", which is only for dense desktop rows.
const sizes: Record<Size, string> = {
  sm: "min-h-9 gap-1.5 rounded-sm px-3 text-sm",
  md: "min-h-11 gap-2 rounded-sm px-4 text-[15px]",
  lg: "min-h-13 gap-2 rounded-md px-5 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex select-none items-center justify-center font-semibold transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-45",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

/** Square icon-only button. `label` is required: it becomes the aria-label and tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "icon" | "children"> & { label: string; children: ReactNode }>(
  function IconButton({ label, variant = "ghost", size = "md", className, children, ...rest }, ref) {
    const box = size === "sm" ? "h-9 w-9" : size === "lg" ? "h-13 w-13" : "h-11 w-11";
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={cx(
          "inline-grid shrink-0 place-items-center rounded-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45",
          variants[variant],
          box,
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx("h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}
