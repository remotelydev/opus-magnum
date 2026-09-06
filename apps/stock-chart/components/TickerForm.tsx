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
      className="flex w-full items-center gap-3 border-b border-rule pb-2"
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
        className="min-w-0 flex-1 bg-transparent font-sans text-3xl font-bold tracking-tight text-stone-800 outline-none placeholder:text-stone-400"
        placeholder="AAPL"
      />
      <button
        type="submit"
        className="shrink-0 text-stone-700 hover:text-stone-900"
        aria-label="Search ticker"
      >
        <MagnifyingGlassIcon className="size-6 stroke-[1.5]" aria-hidden="true" />
      </button>
    </form>
  );
}
