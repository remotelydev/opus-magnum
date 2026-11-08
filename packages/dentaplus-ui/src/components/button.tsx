import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx.ts";

const VARIANTS = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border border-input bg-surface hover:bg-muted",
  ghost: "hover:bg-muted",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  link: "text-primary underline-offset-4 hover:underline",
} as const;

const SIZES = {
  sm: "h-7 gap-1 px-2.5 text-xs",
  md: "h-9 gap-1.5 px-3.5 text-sm",
  icon: "size-7 [&_svg]:size-4",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}

export function Button({ variant = "primary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
