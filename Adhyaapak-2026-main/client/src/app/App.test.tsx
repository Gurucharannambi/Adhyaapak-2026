import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { AuthProvider } from "../features/auth/AuthContext";
import { ConfigProvider } from "./ConfigContext";
import { App } from "./App";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function mockApi(routes: Record<string, () => Promise<Response>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      const handler = routes[key];
      if (!handler) throw new Error(`Unmocked request: ${key}`);
      return handler();
    }),
  );
}

const renderApp = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConfigProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ConfigProvider>
    </MemoryRouter>,
  );

const notSignedIn = () => json(401, { error: { code: "unauthenticated", message: "Please sign in to continue." }, requestId: "r1" });
const config = () => json(200, { appName: "Adhyaapak", aiEnabled: false });

afterEach(() => vi.unstubAllGlobals());

describe("App routing and auth", () => {
  it("shows anonymous visitors the landing page, with a way to log in", async () => {
    mockApi({ "GET /api/v1/config": config, "GET /api/v1/auth/me": notSignedIn });
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: /Teaching that adapts to every learner/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Log in" })[0]).toHaveAttribute("href", "/login");
  });

  it("sends anonymous visitors to the sign-in page when they open a private page", async () => {
    mockApi({ "GET /api/v1/config": config, "GET /api/v1/auth/me": notSignedIn });
    renderApp("/curriculum");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("shows server validation errors next to the right field", async () => {
    mockApi({
      "GET /api/v1/config": config,
      "GET /api/v1/auth/me": notSignedIn,
      "POST /api/v1/auth/register": () =>
        json(400, {
          error: { code: "validation_error", message: "Some fields need attention.", details: [{ path: "password", message: "Use at least 10 characters" }] },
          requestId: "r2",
        }),
    });
    renderApp("/register");
    await userEvent.type(await screen.findByLabelText("Your name"), "Asha");
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Use at least 10 characters")).toBeInTheDocument();
  });

  it("signs in and lands on the dashboard with a real call-to-action", async () => {
    mockApi({
      "GET /api/v1/config": config,
      "GET /api/v1/auth/me": notSignedIn,
      "POST /api/v1/auth/login": () => json(200, { user: { id: "u1", name: "Asha Rao", email: "asha@example.com", role: "teacher" } }),
      "GET /api/v1/dashboard": () =>
        json(200, { classes: [], today: [{ id: "create-first-class", kind: "create_first_class", text: "Create your first class to get started." }], schedule: [], tomorrow: [], attention: [], setup: { hasClass: false, hasStudents: false, hasTaught: false } }),
    });
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { level: 1, name: /, Asha Rao$/ })).toBeInTheDocument(); // "Good morning/afternoon/evening, Asha Rao"
    await waitFor(() => expect(screen.getByRole("link", { name: "Create your class" })).toBeInTheDocument());
  });

  it("shows a friendly message when the network is down", async () => {
    mockApi({
      "GET /api/v1/config": config,
      "GET /api/v1/auth/me": notSignedIn,
      "POST /api/v1/auth/login": () => Promise.reject(new TypeError("Failed to fetch")),
    });
    renderApp("/login");
    await userEvent.type(await screen.findByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Password"), "whatever-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Cannot reach the server|offline/i);
  });
});

describe("demo sign-in", () => {
  it("fills in the demo credentials when the server offers them", async () => {
    mockApi({
      "GET /api/v1/config": () => json(200, { appName: "Adhyaapak", aiEnabled: false, demoLogin: { email: "demo@example.test", password: "demo-teacher-2026" } }),
      "GET /api/v1/auth/me": notSignedIn,
    });
    renderApp("/login");
    await userEvent.click(await screen.findByRole("button", { name: "Use demo credentials" }));
    expect(screen.getByLabelText("Email")).toHaveValue("demo@example.test");
    expect(screen.getByLabelText("Password")).toHaveValue("demo-teacher-2026");
  });

  it("shows no demo button when the server does not offer it", async () => {
    mockApi({ "GET /api/v1/config": config, "GET /api/v1/auth/me": notSignedIn });
    renderApp("/login");
    await screen.findByRole("heading", { name: "Sign in" });
    expect(screen.queryByRole("button", { name: "Use demo credentials" })).not.toBeInTheDocument();
  });
});
