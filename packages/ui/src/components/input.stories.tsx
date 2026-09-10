import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";

function FieldBoard() {
  return (
    <div className="min-h-svh bg-background px-8 py-10 text-foreground">
      <p className="font-mono text-xs tracking-wide text-mute uppercase">
        Components / field
      </p>
      <h1 className="mt-2 font-sans text-3xl font-bold tracking-tight">
        Input and Label
      </h1>
      <p className="mt-2 max-w-xl text-mute">
        Lyra fields on newspaper tokens. Pair Label with Input; compose with
        Button for a form cluster.
      </p>

      <div className="mt-10 max-w-sm space-y-8">
        <div>
          <p className="font-mono text-xs text-mute">Label</p>
          <div className="mt-2">
            <Label htmlFor="story-ticker">Ticker</Label>
          </div>
        </div>

        <div>
          <p className="font-mono text-xs text-mute">Input</p>
          <div className="mt-2">
            <Input id="story-bare" placeholder="AAPL" />
          </div>
        </div>

        <div>
          <p className="font-mono text-xs text-mute">Label + Input</p>
          <div className="mt-2 space-y-2">
            <Label htmlFor="story-symbol">Symbol</Label>
            <Input id="story-symbol" placeholder="MSFT" />
          </div>
        </div>

        <div>
          <p className="font-mono text-xs text-mute">
            Label + Input + Button
          </p>
          <form
            className="mt-2 flex items-end gap-2"
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="story-lookup">Look up</Label>
              <Input id="story-lookup" placeholder="NVDA" />
            </div>
            <Button type="submit">Go</Button>
          </form>
        </div>

        <div>
          <p className="font-mono text-xs text-mute">Input / disabled</p>
          <div className="mt-2">
            <Input disabled placeholder="Disabled" />
          </div>
        </div>

        <div>
          <p className="font-mono text-xs text-mute">Input / aria-invalid</p>
          <div className="mt-2">
            <Input aria-invalid placeholder="Invalid" defaultValue="???" />
          </div>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Field",
  component: FieldBoard,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FieldBoard>;

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
