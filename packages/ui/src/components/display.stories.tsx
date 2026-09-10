import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge";
import { Button } from "./button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";
import { Input } from "./input";
import { Label } from "./label";
import { Separator } from "./separator";

function DisplayBoard() {
  return (
    <div className="min-h-svh bg-background px-8 py-10 text-foreground">
      <div className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs tracking-wide text-mute uppercase">
          Components / display
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge>Lyra</Badge>
          <Badge variant="secondary">Newspaper</Badge>
          <Badge variant="outline">Live</Badge>
        </div>
      </div>

      <h1 className="mt-6 font-sans text-4xl font-bold tracking-tight">
        Newsreader on the page
      </h1>
      <p className="mt-3 max-w-xl text-lg">
        Body copy uses <span className="italic">sans</span>, mapped to
        Newsreader. Headings, badges, and paper sit on the same tokens.
      </p>
      <p className="mt-3 max-w-xl text-mute">
        Muted text uses the mute token — captions, placeholders, helper copy.
      </p>

      <Separator className="my-10" />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-sans text-2xl font-bold tracking-tight">
              AAPL
            </CardTitle>
            <CardDescription>Closing auction</CardDescription>
            <CardAction>
              <Badge variant="outline">+1.4%</Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="font-sans text-base">
              The newspaper wash sits on background, with paper for elevated
              surfaces and rule for hairline dividers.
            </p>
            <p className="mt-3 font-mono text-sm">AAPL 229.12 +1.4%</p>
          </CardContent>
          <CardFooter>
            <form
              className="flex w-full items-end gap-2"
              onSubmit={(event) => event.preventDefault()}
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="story-display-lookup">Look up</Label>
                <Input id="story-display-lookup" placeholder="NVDA" />
              </div>
              <Button type="submit">Go</Button>
            </form>
          </CardFooter>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>After hours</CardTitle>
            <CardDescription>Quiet tape until the open.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-mute">
              Separator below is the same rule token as the page hairline.
            </p>
            <Separator className="my-3" />
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Regular</Badge>
              <Badge variant="ghost">Delayed</Badge>
              <Badge variant="destructive">Halt</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Display",
  component: DisplayBoard,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DisplayBoard>;

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
