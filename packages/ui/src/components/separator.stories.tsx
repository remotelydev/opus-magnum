import type { Meta, StoryObj } from "@storybook/react-vite";
import { Separator } from "./separator";

function SeparatorBoard() {
  return (
    <div className="min-h-svh bg-background px-8 py-10 text-foreground">
      <p className="font-mono text-xs tracking-wide text-mute uppercase">
        Components / separator
      </p>
      <h1 className="mt-2 font-sans text-3xl font-bold tracking-tight">
        Separator
      </h1>
      <p className="mt-2 max-w-xl text-mute">
        Hairline rule on the border token. Use it between blocks the way a
        newspaper uses a rule.
      </p>

      <div className="mt-10 max-w-md space-y-8">
        <div>
          <p className="font-mono text-xs text-mute">
            Separator / orientation=horizontal
          </p>
          <div className="mt-2">
            <p>Above the rule</p>
            <Separator className="my-4" />
            <p>Below the rule</p>
          </div>
        </div>

        <div>
          <p className="font-mono text-xs text-mute">
            Separator / orientation=vertical
          </p>
          <div className="mt-2 flex h-16 items-center gap-4">
            <span>Bid</span>
            <Separator orientation="vertical" />
            <span>Ask</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Separator",
  component: SeparatorBoard,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SeparatorBoard>;

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
