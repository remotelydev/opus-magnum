import type { Meta, StoryObj } from "@storybook/react-vite";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Button } from "./button";

const variants = [
  "default",
  "outline",
  "secondary",
  "ghost",
  "destructive",
  "link",
] as const;

const sizes = ["xs", "sm", "default", "lg"] as const;

function ButtonBoard() {
  return (
    <div className="min-h-svh bg-background px-8 py-10 text-foreground">
      <p className="font-mono text-xs tracking-wide text-mute uppercase">
        Components / button
      </p>
      <h1 className="mt-2 font-sans text-3xl font-bold tracking-tight">
        Button
      </h1>
      <p className="mt-2 max-w-xl text-mute">
        Lyra anatomy, newspaper tokens. Change color in{" "}
        <span className="font-mono text-foreground">globals.css</span>; change
        shape in{" "}
        <span className="font-mono text-foreground">button.tsx</span>.
      </p>

      <h2 className="mt-10 font-sans text-lg font-bold">Variant</h2>
      <div className="mt-4 space-y-6">
        {variants.map((variant) => (
          <div key={variant}>
            <p className="font-mono text-xs text-mute">
              Button / variant={variant}
            </p>
            <div className="mt-2">
              <Button variant={variant}>Subscribe</Button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-10 font-sans text-lg font-bold">Size</h2>
      <div className="mt-4 space-y-6">
        {sizes.map((size) => (
          <div key={size}>
            <p className="font-mono text-xs text-mute">
              Button / size={size}
            </p>
            <div className="mt-2">
              <Button size={size}>Subscribe</Button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-10 font-sans text-lg font-bold">Icon</h2>
      <p className="font-mono text-xs text-mute">Button / size=icon</p>
      <div className="mt-2">
        <Button size="icon" aria-label="Search">
          <MagnifyingGlassIcon />
        </Button>
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Button",
  component: ButtonBoard,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ButtonBoard>;

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
