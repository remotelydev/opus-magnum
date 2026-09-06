"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

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
      className="flex w-full items-center gap-2 border-b border-zinc-100 pb-1"
    >
      <label htmlFor="ticker" className="sr-only">
        Ticker
      </label>
      <input
        id="ticker"
        name="ticker"
        value={value}
        onChange={(event) => setValue(event.target.value.toUpperCase())}
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-bold tracking-tight text-zinc-100 outline-none placeholder:text-zinc-600"
        placeholder="AAPL"
      />
      <button
        type="submit"
        className="shrink-0 text-zinc-100 hover:text-zinc-300"
        aria-label="Search ticker"
      >
        <MagnifyingGlassIcon className="size-6" aria-hidden="true" />
      </button>
    </form>
  );
}
