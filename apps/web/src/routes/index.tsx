import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <div data-testid="home">Map coming in Phase 1</div>,
});
