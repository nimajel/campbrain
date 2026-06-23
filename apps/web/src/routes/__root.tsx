import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { NavBar } from "@/components/nav-bar";

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMap = pathname === "/";
  return (
    <div className="min-h-screen">
      <NavBar />
      <main className={isMap ? "" : "p-4"}>
        <Outlet />
      </main>
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
