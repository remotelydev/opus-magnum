import { Input } from "@opus-magnum/dentaplus-ui/components/field";
import type { InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className">;

// The shared Input is full width; these keep time and date fields at their natural size in a row.
export function TimeInput(props: Props) {
  return (
    <span className="w-32 shrink-0">
      <Input type="time" className="h-8" {...props} />
    </span>
  );
}

export function DateInput(props: Props) {
  return (
    <span className="block w-40 shrink-0">
      <Input type="date" className="h-8" {...props} />
    </span>
  );
}
