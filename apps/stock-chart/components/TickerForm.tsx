"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Button } from "@opus-magnum/ui/components/button";
import { Input } from "@opus-magnum/ui/components/input";
import { Label } from "@opus-magnum/ui/components/label";

type TickerFormProps = {
  initialTicker: string;
};

export function TickerForm({ initialTicker }: TickerFormProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialTicker);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = value.trim().toUpperCase();
    if (!next) return;
    router.push(`/${next}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full items-center gap-3"
    >
      <Label htmlFor="ticker" className="sr-only">
        Ticker
      </Label>
      <Input
        id="ticker"
        name="ticker"
        value={value}
        onValueChange={(next) => setValue(next.toUpperCase())}
        spellCheck={false}
        autoComplete="off"
        placeholder="AAPL"
        className="h-auto min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-3xl font-bold tracking-tight shadow-none placeholder:text-mute focus-visible:ring-0 md:text-3xl"
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="size-auto text-foreground hover:bg-transparent hover:text-foreground"
        aria-label="Search ticker"
      >
        <MagnifyingGlassIcon className="size-6 stroke-[1.5]" aria-hidden="true" />
      </Button>
    </form>
  );
}
