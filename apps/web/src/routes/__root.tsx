import { createRootRoute, Outlet } from "@tanstack/react-router";
import { NavBar } from "@/components/nav-bar";

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen">
      <NavBar />
      <main className="p-4"><Outlet /></main>
    </div>
  ),
});
