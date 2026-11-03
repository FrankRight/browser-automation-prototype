import type { RunEvent } from "@browser-prototype/contract";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunPage } from "../components/run-page";
import { afterSignIn, ev, resetSeq, untilSignIn } from "./events";

const LINK = "https://live.example.test/player/abc";

class FakeEventSource {
  static latest: FakeEventSource;
  onmessage: ((message: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.latest = this;
  }
  close() {
    this.closed = true;
  }
  send(events: RunEvent[]) {
    act(() => events.forEach((event) => this.onmessage?.({ data: JSON.stringify(event) })));
  }
}

const calls: { url: string; body?: string }[] = [];

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  resetSeq();
  calls.length = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url === "/v1/runs/run_test/browser") return reply({ url: LINK });
      if (url.startsWith("/v1/workflows/resume/")) return reply({ id: "run_test", status: "running" });
      return reply({ id: "run_test", workflow: "create_secret", status: "running", created: new Date().toISOString(), input: { name: "API_KEY" } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the browser panel on the run page", () => {
  it("opens on the takeover, sends approved on Continue, and closes when the takeover ends", async () => {
    render(<RunPage runId="run_test" onNewRun={() => {}} />);
    expect(FakeEventSource.latest.url).toBe("/v1/runs/run_test/stream");
    expect(screen.queryByRole("complementary", { name: "Live browser" })).toBeNull();

    FakeEventSource.latest.send(untilSignIn());
    const panel = await screen.findByRole("complementary", { name: "Live browser" });
    const frame = await screen.findByTitle("Live browser for this run");
    expect(frame.getAttribute("src")).toBe(LINK);
    expect(panel.textContent).toContain("Sign in to Studio in the browser");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/v1/workflows/resume/run_test")).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url === "/v1/workflows/resume/run_test")!.body!)).toEqual({ user_response: "approved" });

    FakeEventSource.latest.send(afterSignIn());
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Live browser" })).toBeNull());

    // The link lived only in the panel's memory.
    expect(JSON.stringify({ ...localStorage })).not.toContain(LINK);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(LINK);
    expect(window.location.href).not.toContain("live.example.test");
  });

  it("sends rejected on Cancel", async () => {
    render(<RunPage runId="run_test" onNewRun={() => {}} />);
    FakeEventSource.latest.send(untilSignIn());
    await screen.findByRole("complementary", { name: "Live browser" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(calls.some((c) => c.url.startsWith("/v1/workflows/resume/"))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url.startsWith("/v1/workflows/resume/"))!.body!)).toEqual({ user_response: "rejected" });
  });
});

describe("following the run", () => {
  it("leaves out the instant profile step, and moves on from the approval once it's answered", async () => {
    render(<RunPage runId="run_test" onNewRun={() => {}} />);
    FakeEventSource.latest.send([
      ev("run.started", null, { workflow: "create_secret", input: { name: "API_KEY" } }),
      ev("workflow.step.started", "profile", { name: "profile" }),
      ev("workflow.step.completed", "profile", { name: "profile", output: "p1", duration_ms: 2 }),
      ev("workflow.step.started", "wait_for_user_1", { name: "wait_for_user_1", type: "user_input" }),
      ev("approval.requested", "wait_for_user_1", {
        step_key: "wait_for_user_1",
        question: "Create the secret **API_KEY** in Studio, for All Environments?",
        input_type: "approval",
        options: [
          { id: "approve", label: "Create secret" },
          { id: "reject", label: "Don't create" },
        ],
      }),
      ev("run.paused", "wait_for_user_1", { step_key: "wait_for_user_1", takeover: false }),
    ]);
    expect(screen.queryByText("Load the saved browser profile")).toBeNull();
    expect(await screen.findByRole("button", { name: /Create secret/ })).toBeTruthy();

    FakeEventSource.latest.send([
      ev("run.resumed", "wait_for_user_1", { step_key: "wait_for_user_1", user_response: "approved" }),
      ev("workflow.step.completed", "wait_for_user_1", { name: "wait_for_user_1", output: "approved" }),
      ev("workflow.step.started", "create", { name: "create" }),
    ]);
    const details = screen.getByRole("region", { name: "Step details" });
    await waitFor(() => expect(details.textContent).toContain("Add the secret in Studio"));
    expect(screen.queryByRole("button", { name: /Create secret/ })).toBeNull();
  });
});
