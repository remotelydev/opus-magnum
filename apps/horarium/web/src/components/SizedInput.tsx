import { Input } from "@opus-magnum/dentaplus-ui/components/field";
import type { InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className">;

// The shared Input is full width; these keep time and date fields at their natural size in a row.
// A phone shows a time as "08:00" with its own picker, so a narrower field leaves room for the rest of the row.
export function TimeInput(props: Props) {
  return (
    <span className="w-28 shrink-0 sm:w-32">
      <Input type="time" className="h-8" {...props} />
    </span>
  );
}

export function DateInput(props: Props) {
  return (
    <span className="block w-36 shrink-0 sm:w-40">
      <Input type="date" className="h-8" {...props} />
    </span>
  );
}
