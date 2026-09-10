import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

function CardBoard() {
  return (
    <div className="min-h-svh bg-background px-8 py-10 text-foreground">
      <p className="font-mono text-xs tracking-wide text-mute uppercase">
        Components / card
      </p>
      <h1 className="mt-2 font-sans text-3xl font-bold tracking-tight">
        Card
      </h1>
      <p className="mt-2 max-w-xl text-mute">
        Paper surface with a hairline ring. Size changes the inner spacing
        token, not the radius — Lyra stays sharp.
      </p>

      <div className="mt-10 max-w-md space-y-8">
        <div>
          <p className="font-mono text-xs text-mute">Card / size=default</p>
          <div className="mt-2">
            <Card>
              <CardHeader>
                <CardTitle>Closing auction</CardTitle>
                <CardDescription>
                  Elevated on paper, ringed with foreground/10.
                </CardDescription>
              </CardHeader>
              <CardContent>
                The newspaper wash sits on background, with paper for
                elevated surfaces.
              </CardContent>
            </Card>
          </div>
        </div>

        <div>
          <p className="font-mono text-xs text-mute">Card / size=sm</p>
          <div className="mt-2">
            <Card size="sm">
              <CardHeader>
                <CardTitle>After hours</CardTitle>
                <CardDescription>Quiet tape until the open.</CardDescription>
              </CardHeader>
              <CardContent>Delayed prints only.</CardContent>
            </Card>
          </div>
        </div>

        <div>
          <p className="font-mono text-xs text-mute">
            Card / header + action + footer
          </p>
          <div className="mt-2">
            <Card>
              <CardHeader>
                <CardTitle>AAPL</CardTitle>
                <CardDescription>Closing print</CardDescription>
                <CardAction>
                  <Badge variant="outline">+1.4%</Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-sm">AAPL 229.12 +1.4%</p>
              </CardContent>
              <CardFooter>
                <span className="text-mute">Regular session</span>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Components/Card",
  component: CardBoard,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CardBoard>;

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
