import { Button } from "@opus-magnum/ui/components/button";
import { Input } from "@opus-magnum/ui/components/input";
import { Label } from "@opus-magnum/ui/components/label";

const surfaces = [
  { token: "background", className: "bg-background" },
  { token: "background-glow", className: "bg-background-glow" },
  { token: "paper / card", className: "bg-paper" },
  { token: "muted / secondary / accent", className: "bg-muted" },
  { token: "primary", className: "bg-primary" },
  { token: "destructive", className: "bg-destructive" },
] as const;

const inks = [
  { token: "foreground", className: "bg-foreground" },
  { token: "mute", className: "bg-mute" },
  { token: "rule / border", className: "bg-rule" },
  { token: "ring", className: "bg-ring" },
] as const;

function Swatch({ token, className }: { token: string; className: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={`h-20 w-full border border-rule ${className}`} aria-hidden />
      <p className="font-mono text-xs text-mute">{token}</p>
    </div>
  );
}

function Specimen() {
  return (
    <div className="bg-background px-8 py-10 text-foreground">
      <p className="font-mono text-xs tracking-wide text-mute uppercase">
        opus-magnum / tokens
      </p>
      <h1 className="mt-2 font-sans text-4xl font-bold tracking-tight">
        Newsreader on the page
      </h1>
      <p className="mt-3 max-w-xl text-lg">
        Body copy uses <span className="italic">sans</span>, mapped to
        Newsreader. Edit{" "}
        <span className="font-mono text-sm">packages/ui/src/styles/globals.css</span>{" "}
        and this page should follow.
      </p>
      <p className="mt-3 max-w-xl text-mute">
        Muted text uses the mute token — captions, placeholders, helper copy.
      </p>

      <div className="mt-10 max-w-xl space-y-6 border-t border-rule pt-8">
        <div>
          <p className="font-mono text-xs text-mute">h1 / text-4xl / bold</p>
          <p className="font-sans text-4xl font-bold tracking-tight">
            Ticker tape
          </p>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">h2 / text-2xl / bold</p>
          <p className="font-sans text-2xl font-bold tracking-tight">
            Closing auction
          </p>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">h3 / text-lg / bold</p>
          <p className="font-sans text-lg font-bold">After hours</p>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">body / text-base</p>
          <p className="font-sans text-base">
            The newspaper wash sits on background, with paper for elevated
            surfaces and rule for hairline dividers.
          </p>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">mono / text-sm</p>
          <p className="font-mono text-sm">AAPL 229.12 +1.4%</p>
        </div>
      </div>

      <h2 className="mt-12 font-sans text-lg font-bold">Button</h2>
      <div className="mt-4 space-y-6">
        <div>
          <p className="font-mono text-xs text-mute">
            Button / variant=default
          </p>
          <div className="mt-2">
            <Button>Subscribe</Button>
          </div>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">
            Button / variant=outline
          </p>
          <div className="mt-2">
            <Button variant="outline">Subscribe</Button>
          </div>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">
            Button / variant=secondary
          </p>
          <div className="mt-2">
            <Button variant="secondary">Subscribe</Button>
          </div>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">
            Button / variant=ghost
          </p>
          <div className="mt-2">
            <Button variant="ghost">Subscribe</Button>
          </div>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">
            Button / variant=destructive
          </p>
          <div className="mt-2">
            <Button variant="destructive">Subscribe</Button>
          </div>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">Button / variant=link</p>
          <div className="mt-2">
            <Button variant="link">Subscribe</Button>
          </div>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">Button / size=xs</p>
          <div className="mt-2">
            <Button size="xs">Subscribe</Button>
          </div>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">Button / size=lg</p>
          <div className="mt-2">
            <Button size="lg">Subscribe</Button>
          </div>
        </div>
      </div>

      <h2 className="mt-12 font-sans text-lg font-bold">Field</h2>
      <div className="mt-4 max-w-sm space-y-6">
        <div>
          <p className="font-mono text-xs text-mute">Label</p>
          <div className="mt-2">
            <Label htmlFor="specimen-label">Ticker</Label>
          </div>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">Input</p>
          <div className="mt-2">
            <Input id="specimen-bare" placeholder="AAPL" />
          </div>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">Label + Input</p>
          <div className="mt-2 space-y-2">
            <Label htmlFor="specimen-symbol">Symbol</Label>
            <Input id="specimen-symbol" placeholder="MSFT" />
          </div>
        </div>
        <div>
          <p className="font-mono text-xs text-mute">
            Label + Input + Button
          </p>
          <form className="mt-2 flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="specimen-lookup">Look up</Label>
              <Input id="specimen-lookup" placeholder="NVDA" />
            </div>
            <Button type="button">Go</Button>
          </form>
        </div>
      </div>

      <h2 className="mt-12 font-sans text-lg font-bold">Surfaces</h2>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {surfaces.map((item) => (
          <Swatch key={item.token} {...item} />
        ))}
      </div>

      <h2 className="mt-10 font-sans text-lg font-bold">Ink and rules</h2>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {inks.map((item) => (
          <Swatch key={item.token} {...item} />
        ))}
      </div>

      <h2 className="mt-10 font-sans text-lg font-bold">Radius</h2>
      <p className="mt-1 font-mono text-xs text-mute">--radius (Lyra is 0)</p>
      <div className="mt-4 flex gap-4">
        <div className="size-16 bg-primary" />
        <div className="size-16 rounded-lg bg-primary" />
        <div className="size-16 rounded-xl bg-primary" />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <main>
      <Specimen />
      <div className="dark">
        <Specimen />
      </div>
    </main>
  );
}
