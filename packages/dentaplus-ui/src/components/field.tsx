import type { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes } from "react";
import { cx } from "../lib/cx.ts";

const control =
  "h-9 w-full rounded-md border border-input bg-surface px-3 text-sm placeholder:text-muted-foreground disabled:opacity-50 aria-invalid:border-destructive";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(control, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(control, "pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cx("block text-xs font-medium text-muted-foreground", className)} {...props} />;
}
