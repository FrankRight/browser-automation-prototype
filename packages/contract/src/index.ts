/**
 * The contract between the runner and the web app: run events, named as AGNT5 names them,
 * and the shape of a run as the runner's API returns it. `events.json` lists the same event
 * types, and the runner's tests hold every event it records to that list.
 */

export const EVENT_TYPES = [
  "run.started",
  "run.paused",
  "run.resumed",
  "run.completed",
  "run.failed",
  "workflow.step.started",
  "workflow.step.completed",
  "workflow.step.failed",
  "workflow.step.paused",
  "approval.requested",
  "progress.update",
  "browser.takeover.started",
  "browser.takeover.ended",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface RunEvent<D = Record<string, unknown>> {
  id: string;
  /** Position in the run's journal, from 1. Server-sent events use it as their ID. */
  seq: number;
  run_id: string;
  type: EventType;
  /** ISO 8601, UTC. */
  time: string;
  /** The step the event belongs to: a step name, or a pause key such as wait_for_user_1. */
  step: string | null;
  data: D;
}

export interface PauseOption {
  id: string;
  label: string;
}

/** approval.requested: what a paused run asks, as AGNT5's wait_for_user does. */
export interface ApprovalRequested {
  step_key: string;
  question: string;
  input_type: "text" | "approval" | "select" | "multiselect";
  options: PauseOption[];
  allow_custom: boolean;
  skippable: boolean;
}

/** progress.update: a step's own progress, from the runner's narration. */
export interface ProgressUpdate {
  kind: "step" | "detail" | "event";
  /** For kind "step": the sub-step's label and whether it started or ended. */
  label?: string;
  state?: "started" | "completed" | "failed";
  /** For "detail" and "event": what's happening, such as a model action. */
  message?: string;
  depth: number;
  duration_ms?: number;
  note?: string;
}

export type RunStatus = "queued" | "running" | "awaiting_user_input" | "completed" | "failed";

export interface Pause extends ApprovalRequested {
  /** True while a person should use a live browser; the run page then shows it. */
  takeover: boolean;
}

export interface Run {
  id: string;
  workflow: string;
  status: RunStatus;
  created: string;
  updated: string;
  /** Secret inputs hold their placeholder, such as "{{value}}", never the value. */
  input: Record<string, unknown>;
  output: unknown;
  error: string | null;
  pause: Pause | null;
}
