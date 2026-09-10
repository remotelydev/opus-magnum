import type { Meta, StoryObj } from "@storybook/react-vite";

function TypeBoard() {
  return (
    <div className="min-h-svh bg-background px-8 py-10 text-foreground">
      <p className="font-mono text-xs tracking-wide text-mute uppercase">
        Foundations / type
      </p>
      <h1 className="mt-2 font-sans text-4xl font-bold tracking-tight">
        Newsreader on the page
      </h1>
      <p className="mt-3 max-w-xl text-lg">
        Body copy uses <span className="italic">sans</span>, which this system
        maps to Newsreader. Change <span className="font-mono text-sm">--font-sans</span>{" "}
        in <span className="font-mono text-sm">globals.css</span> to restyle every
        heading and paragraph.
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
    </div>
  );
}

const meta = {
  title: "Foundations/Typography",
  component: TypeBoard,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TypeBoard>;

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
