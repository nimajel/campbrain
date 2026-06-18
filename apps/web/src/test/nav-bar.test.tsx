import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NavBar } from "@/components/nav-bar";

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: null }),
  signIn: { social: vi.fn() },
  signOut: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

describe("NavBar", () => {
  it("shows Sign in when logged out", () => {
    render(<NavBar />);
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();
  });
});
