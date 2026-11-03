import type { ApprovalRequested, ProgressUpdate, RunEvent, RunStatus } from "@browser-prototype/contract";

export type StepStatus = "running" | "completed" | "failed" | "waiting";

export interface ProgressItem extends ProgressUpdate {
  seq: number;
  time: string;
}

export interface StepView {
  key: string;
  kind: "step" | "pause" | "takeover" | "handover";
  status: StepStatus;
  startedAt?: string;
  durationMs?: number;
  output?: unknown;
  error?: string;
  /** A pause's answer, such as "approved". */
  answer?: string;
  request?: ApprovalRequested;
  progress: ProgressItem[];
}

export interface RunView {
  status: RunStatus;
  steps: StepView[];
  /** The step waiting on a person, if any. */
  waiting?: StepView;
  /** True while the waiting step wants the person in the live browser. */
  takeover: boolean;
  output?: unknown;
  error?: string;
}

const LABELS: [RegExp, string][] = [
  [/^profile$/, "Load the saved browser profile"],
  [/^look_\d+$/, "Look for the secret in Studio"],
  [/^open_login_window_\d+$/, "Open a browser to sign in"],
  [/^take_over_browser_\d+$/, "Sign in to Studio"],
  [/^hand_over_secret_\d+$/, "Copy your new secret"],
  [/^close_login_window_\d+$/, "Close the browser and save the login"],
  [/^create$/, "Add the secret in Studio"],
  [/^read_back$/, "Check that Studio lists the secret"],
];

/** A step's name for people. Pauses are named for what they ask. */
export function stepLabel(step: StepView): string {
  if (step.kind === "pause") return step.request?.input_type === "approval" ? "Your approval" : "A question for you";
  const known = LABELS.find(([pattern]) => pattern.test(step.key));
  if (known) return known[1];
  const words = step.key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Steps worth showing: an instant step with nothing to say, such as loading the profile, is left out. */
export function visibleSteps(steps: StepView[]): StepView[] {
  return steps.filter(
    (s) => !(s.kind === "step" && s.status === "completed" && s.progress.length === 0 && (s.durationMs ?? 0) < 1000),
  );
}

/** The step a person should be looking at: the one waiting on them, else the one running, else the last. */
export function activeStep(steps: StepView[]): StepView | undefined {
  return steps.findLast((s) => s.status === "waiting") ?? steps.findLast((s) => s.status === "running") ?? steps.at(-1);
}

/** Folds a run's events, in order, into its steps and status: the same events Studio reads. */
export function buildRunView(events: RunEvent[]): RunView {
  const steps = new Map<string, StepView>();
  const openTakeovers = new Set<string>();
  const view: RunView = { status: "queued", steps: [], takeover: false };

  const step = (key: string): StepView => {
    let found = steps.get(key);
    if (!found) {
      found = { key, kind: "step", status: "running", progress: [] };
      steps.set(key, found);
    }
    return found;
  };

  for (const event of events) {
    const data = event.data as Record<string, unknown>;
    const key = event.step ?? "";
    switch (event.type) {
      case "run.started":
      case "run.resumed":
        view.status = "running";
        break;
      case "run.paused":
        view.status = "awaiting_user_input";
        break;
      case "run.completed":
        view.status = "completed";
        view.output = data.output;
        break;
      case "run.failed":
        view.status = "failed";
        view.error = String(data.error ?? "");
        break;
      case "browser.takeover.started":
        step(key).kind = "takeover";
        openTakeovers.add(key);
        break;
      case "browser.takeover.ended":
        openTakeovers.delete(key);
        break;
      case "secret.handover.started":
        step(key).kind = "handover";
        break;
      case "workflow.step.started": {
        const s = step(key);
        if (data.type === "user_input" && s.kind === "step") s.kind = "pause";
        s.status = "running";
        s.startedAt = event.time;
        s.error = undefined;
        break;
      }
      case "approval.requested": {
        const s = step(key);
        s.request = data as unknown as ApprovalRequested;
        s.status = "waiting";
        break;
      }
      case "workflow.step.paused":
        step(key).status = "waiting";
        break;
      case "workflow.step.completed": {
        const s = step(key);
        s.status = "completed";
        s.durationMs = typeof data.duration_ms === "number" ? data.duration_ms : elapsed(s.startedAt, event.time);
        if (s.kind === "step") s.output = data.output;
        else s.answer = String(data.output);
        break;
      }
      case "workflow.step.failed": {
        const s = step(key);
        s.status = "failed";
        s.error = String(data.error ?? "");
        s.durationMs = typeof data.duration_ms === "number" ? data.duration_ms : undefined;
        break;
      }
      case "progress.update":
        if (key) step(key).progress.push({ ...(data as unknown as ProgressUpdate), seq: event.seq, time: event.time });
        break;
    }
  }

  view.steps = [...steps.values()];
  view.waiting = view.status === "awaiting_user_input" ? view.steps.findLast((s) => s.status === "waiting") : undefined;
  view.takeover = Boolean(view.waiting && view.waiting.kind === "takeover" && openTakeovers.has(view.waiting.key));
  return view;
}

function elapsed(from: string | undefined, to: string): number | undefined {
  return from ? Date.parse(to) - Date.parse(from) : undefined;
}
