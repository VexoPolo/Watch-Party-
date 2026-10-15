/** Join class names, skipping falsy values: cx("a", cond && "b") → "a b" or "a". */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
