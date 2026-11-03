import { beforeEach, describe, expect, it } from "vitest";

import { buildRunView, stepLabel } from "../lib/run-view";
import { afterSignIn, ev, resetSeq, untilSignIn } from "./events";

describe("buildRunView", () => {
  beforeEach(resetSeq);

  it("follows a run into its sign-in pause", () => {
    const view = buildRunView(untilSignIn());
    expect(view.status).toBe("awaiting_user_input");
    expect(view.steps.map((s) => s.key)).toEqual(["look_1", "open_login_window_1", "take_over_browser_1"]);
    expect(view.waiting?.key).toBe("take_over_browser_1");
    expect(view.takeover).toBe(true);
    const look = view.steps[0];
    expect(look.status).toBe("completed");
    expect(look.output).toEqual({ status: "needs_login" });
    expect(look.progress.map((p) => p.kind)).toEqual(["step", "event", "step"]);
    expect(stepLabel(view.steps[2])).toBe("Sign in to Studio");
  });

  it("closes the takeover once the person continues", () => {
    const view = buildRunView([...untilSignIn(), ...afterSignIn()]);
    expect(view.status).toBe("running");
    expect(view.takeover).toBe(false);
    expect(view.waiting).toBeUndefined();
    const signIn = view.steps.find((s) => s.key === "take_over_browser_1")!;
    expect(signIn.status).toBe("completed");
    expect(signIn.answer).toBe("approved");
    expect(signIn.durationMs).toBeGreaterThan(0);
  });

  it("names an approval pause and records its answer", () => {
    const view = buildRunView([
      ev("run.started"),
      ev("workflow.step.started", "wait_for_user_1", { type: "user_input" }),
      ev("approval.requested", "wait_for_user_1", { step_key: "wait_for_user_1", question: "Create it?", input_type: "approval", options: [] }),
      ev("run.paused", "wait_for_user_1"),
    ]);
    expect(view.takeover).toBe(false);
    expect(stepLabel(view.waiting!)).toBe("Your approval");
  });

  it("names the copy step, which waits for the person like any pause", () => {
    const view = buildRunView([
      ev("run.started"),
      ev("secret.handover.started", "hand_over_secret_1", { step_key: "hand_over_secret_1", field: "value" }),
      ev("workflow.step.started", "hand_over_secret_1", { type: "user_input" }),
      ev("approval.requested", "hand_over_secret_1", { step_key: "hand_over_secret_1", question: "Copy it", input_type: "approval", options: [] }),
      ev("run.paused", "hand_over_secret_1"),
    ]);
    expect(view.waiting?.kind).toBe("handover");
    expect(view.takeover).toBe(false);
    expect(stepLabel(view.waiting!)).toBe("Copy your new secret");
  });

  it("shows a failed run and its failed step", () => {
    const view = buildRunView([
      ev("run.started"),
      ev("workflow.step.started", "create"),
      ev("workflow.step.failed", "create", { error: "TimeoutError: no answer", duration_ms: 60000 }),
      ev("run.failed", null, { error: "TimeoutError: no answer" }),
    ]);
    expect(view.status).toBe("failed");
    expect(view.steps[0].status).toBe("failed");
    expect(view.error).toContain("TimeoutError");
  });
});
