import type { Meta, StoryObj } from "@storybook/react-vite";

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

const charts = [
  { token: "chart-1", className: "bg-chart-1" },
  { token: "chart-2", className: "bg-chart-2" },
  { token: "chart-3", className: "bg-chart-3" },
  { token: "chart-4", className: "bg-chart-4" },
  { token: "chart-5", className: "bg-chart-5" },
] as const;

function Swatch({
  token,
  className,
}: {
  token: string;
  className: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`h-20 w-full border border-rule ${className}`}
        aria-hidden
      />
      <p className="font-mono text-xs text-mute">{token}</p>
    </div>
  );
}

function ColorBoard() {
  return (
    <div className="min-h-svh bg-background px-8 py-10 text-foreground">
      <p className="font-mono text-xs tracking-wide text-mute uppercase">
        Foundations / color
      </p>
      <h1 className="mt-2 font-sans text-3xl font-bold tracking-tight">
        Tokens
      </h1>
      <p className="mt-2 max-w-xl text-mute">
        Edit <span className="font-mono text-foreground">packages/ui/src/styles/globals.css</span>{" "}
        and these swatches should update.
      </p>

      <h2 className="mt-10 font-sans text-lg font-bold">Surfaces</h2>
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

      <h2 className="mt-10 font-sans text-lg font-bold">Chart</h2>
      <div className="mt-4 grid grid-cols-5 gap-4">
        {charts.map((item) => (
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

const meta = {
  title: "Foundations/Colors",
  component: ColorBoard,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ColorBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Light: Story = {};

export const Dark: Story = {
  decorators: [
    (Story) => (
      <div className="dark">
        <Story />
      </div>
    ),
  ],
};
