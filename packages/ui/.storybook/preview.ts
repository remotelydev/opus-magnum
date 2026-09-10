import type { Preview } from "@storybook/react-vite";
import "./preview.css";
import "../src/styles/globals.css";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    backgrounds: { disable: true },
    options: {
      storySort: {
        order: ["Foundations", ["Colors", "Typography"], "Components"],
      },
    },
  },
};

export default preview;
