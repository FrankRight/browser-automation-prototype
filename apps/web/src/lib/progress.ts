import type { ProgressItem } from "./run-view";

export interface Action {
  type: string;
  label: string;
}

/** One model turn: how long it thought, then what it did. */
export interface Turn {
  seq: number;
  thoughtMs?: number;
  actions: Action[];
}

/** A part of a step, such as "Opening the Secrets page", with the model's turns inside it. */
export interface Part {
  seq: number;
  startedAt: string;
  label: string;
  state: "running" | "completed" | "failed";
  durationMs?: number;
  note?: string;
  turns: Turn[];
  notes: string[];
  /** What the part is doing right now, while it runs. */
  doing?: string;
}

export interface StepProgress {
  parts: Part[];
  /** The step's browser session on Steel's dashboard, if it opened one. */
  link?: string;
  /** Things worth saying that belong to no part, such as "Studio already lists it". */
  notices: { seq: number; message: string }[];
}

const OLD_TURN = /^thought (\d+(?:m \d+)?s) → (.+)$/; // runs recorded before actions came as data

/** Groups a step's progress into its parts, with the model's turns under the part they happened in. */
export function groupProgress(items: ProgressItem[]): StepProgress {
  const result: StepProgress = { parts: [], notices: [] };
  const open: Part[] = [];
  for (const item of items) {
    const parent = item.depth > 0 ? open[item.depth - 1] : undefined;
    if (item.kind === "step" && item.state === "started") {
      const part: Part = { seq: item.seq, startedAt: item.time, label: item.label ?? "", state: "running", turns: [], notes: [] };
      if (parent) parent.notes.push(part.label);
      else result.parts.push(part);
      open[item.depth] = part;
    } else if (item.kind === "step") {
      const part = open[item.depth];
      if (part) Object.assign(part, { state: item.state, durationMs: item.duration_ms, note: item.note || undefined, doing: undefined });
    } else if (item.kind === "detail") {
      if (parent?.state === "running") parent.doing = item.message;
    } else {
      const message = item.message ?? "";
      const link = item.link ?? message.match(/^Watch it on Steel: (https:\/\/\S+)$/)?.[1];
      if (link) {
        result.link = link;
        continue;
      }
      const old = message.match(OLD_TURN);
      const turn: Turn | undefined = item.actions
        ? { seq: item.seq, thoughtMs: item.thought_ms, actions: item.actions }
        : old
          ? { seq: item.seq, actions: old[2].split(", ").map((label) => ({ type: "", label })) }
          : undefined;
      if (turn && parent) parent.turns.push(turn);
      else if (parent) parent.notes.push(message);
      else result.notices.push({ seq: item.seq, message });
    }
  }
  return result;
}

/** An action in plain words, with the secret's placeholder named for what it stands for. */
export function actionText(action: Action): string {
  const label = action.label.replace(/"\{\{value\}\}"/g, "the secret's value");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
