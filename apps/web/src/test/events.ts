import type { RunEvent } from "@browser-prototype/contract";

let seq = 0;

export function resetSeq(): void {
  seq = 0;
}

export function ev(type: RunEvent["type"], step: string | null = null, data: Record<string, unknown> = {}): RunEvent {
  seq += 1;
  return { id: `evt_${seq}`, seq, run_id: "run_test", type, time: new Date(Date.UTC(2026, 10, 3, 10, 0, seq)).toISOString(), step, data };
}

/** A create_secret run up to its sign-in pause, as the runner records it. */
export function untilSignIn(): RunEvent[] {
  return [
    ev("run.started", null, { workflow: "create_secret", input: { name: "API_KEY", value: "{{value}}" } }),
    ev("workflow.step.started", "look_1", { name: "look_1" }),
    ev("progress.update", "look_1", { kind: "step", state: "started", label: "Opening the Secrets page", depth: 0 }),
    ev("progress.update", "look_1", { kind: "event", message: "thought 2s → click at (795, 124)", depth: 1 }),
    ev("progress.update", "look_1", { kind: "step", state: "completed", label: "Opening the Secrets page", depth: 0, duration_ms: 7000 }),
    ev("workflow.step.completed", "look_1", { name: "look_1", output: { status: "needs_login" }, duration_ms: 9000 }),
    ev("workflow.step.started", "open_login_window_1", { name: "open_login_window_1" }),
    ev("workflow.step.completed", "open_login_window_1", { name: "open_login_window_1", output: { session_id: "s1" }, duration_ms: 6000 }),
    ev("browser.takeover.started", "take_over_browser_1", { step_key: "take_over_browser_1" }),
    ev("workflow.step.started", "take_over_browser_1", { name: "take_over_browser_1", type: "user_input" }),
    ev("approval.requested", "take_over_browser_1", {
      step_key: "take_over_browser_1",
      question: "Sign in to Studio in the browser, then press Continue.",
      input_type: "approval",
      options: [
        { id: "approve", label: "Continue" },
        { id: "reject", label: "Cancel" },
      ],
      allow_custom: false,
      skippable: false,
    }),
    ev("workflow.step.paused", "take_over_browser_1", { name: "take_over_browser_1", reason: "user_input_required" }),
    ev("run.paused", "take_over_browser_1", { step_key: "take_over_browser_1", takeover: true }),
  ];
}

export function afterSignIn(): RunEvent[] {
  return [
    ev("run.resumed", "take_over_browser_1", { step_key: "take_over_browser_1", user_response: "approved" }),
    ev("workflow.step.completed", "take_over_browser_1", { name: "take_over_browser_1", output: "approved" }),
    ev("browser.takeover.ended", "take_over_browser_1", { step_key: "take_over_browser_1" }),
    ev("workflow.step.started", "close_login_window_1", { name: "close_login_window_1" }),
  ];
}
