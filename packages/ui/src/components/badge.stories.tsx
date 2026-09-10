import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge";

const variants = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;

function BadgeBoard() {
  return (
    <div className="min-h-svh bg-background px-8 py-10 text-foreground">
      <p className="font-mono text-xs tracking-wide text-mute uppercase">
        Components / badge
      </p>
      <h1 className="mt-2 font-sans text-3xl font-bold tracking-tight">
        Badge
      </h1>
      <p className="mt-2 max-w-xl text-mute">
        Lyra anatomy, newspaper tokens. Status chips sit on paper or beside
        headings.
      </p>

      <h2 className="mt-10 font-sans text-lg font-bold">Variant</h2>
      <div className="mt-4 space-y-6">
        {variants.map((variant) => (
          <div key={variant}>
            <p className="font-mono text-xs text-mute">
              Badge / variant={variant}
            </p>
            <div className="mt-2">
              <Badge variant={variant}>Live</Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Badge",
  component: BadgeBoard,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BadgeBoard>;

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
