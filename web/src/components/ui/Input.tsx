import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cx } from "./cx";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Small text on the right of the label (e.g. "Visible to room"). */
  hint?: string;
  /** Shown under the field in the error color, with an icon; also sets aria-invalid. */
  error?: string | null;
  /** Icon or button inside the field, on the right. */
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, trailing, className, id, ...rest }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  return (
    <div className="flex flex-col gap-2">
      {(label || hint) && (
        <div className="flex items-baseline justify-between gap-2 px-0.5">
          {label && (
            <label htmlFor={inputId} className="text-sm font-semibold text-fg-muted">
              {label}
            </label>
          )}
          {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
        </div>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cx(
            "min-h-13 w-full rounded-md border bg-field px-4 text-base text-fg outline-none transition-[border-color,box-shadow] duration-150",
            "placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/35",
            error ? "border-danger/70" : "border-accent/22",
            trailing ? "pr-12" : undefined,
            className,
          )}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-2 flex items-center text-accent">{trailing}</div>}
      </div>
      {error && (
        <p id={errorId} role="alert" className="flex items-center gap-1.5 px-0.5 text-sm text-danger">
          <CircleAlert aria-hidden size={16} strokeWidth={1.75} />
          {error}
        </p>
      )}
    </div>
  );
});

/** Plain field for compact rows (chat box, search) — same tokens, no label block. */
export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Field({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        "min-h-11 w-full min-w-0 rounded-sm border border-accent/22 bg-field px-3 text-[15px] text-fg outline-none transition-[border-color,box-shadow] duration-150",
        "placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/35",
        className,
      )}
      {...rest}
    />
  );
});
