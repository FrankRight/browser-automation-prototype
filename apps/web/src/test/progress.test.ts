import { describe, expect, it } from "vitest";

import { actionText, groupProgress } from "../lib/progress";
import type { ProgressItem } from "../lib/run-view";

let seq = 0;
const item = (fields: Partial<ProgressItem>): ProgressItem =>
  ({ seq: ++seq, time: new Date(Date.UTC(2026, 10, 3, 10, 0, seq)).toISOString(), depth: 0, kind: "event", ...fields }) as ProgressItem;

describe("groupProgress", () => {
  it("puts the model's turns under the part they happened in, and pulls out the Steel link", () => {
    const progress = groupProgress([
      item({ kind: "step", state: "started", label: "Starting a browser on Steel" }),
      item({ kind: "step", state: "completed", label: "Starting a browser on Steel", duration_ms: 900 }),
      item({ kind: "event", message: "Watch it on Steel: https://app.steel.dev/sessions/s1", link: "https://app.steel.dev/sessions/s1" }),
      item({ kind: "step", state: "started", label: 'Model looking for "API_KEY"' }),
      item({ kind: "detail", depth: 1, message: "thinking, turn 1" }),
      item({
        kind: "event",
        depth: 1,
        message: 'thought 2s → click at (795, 124), type "API_KEY"',
        thought_ms: 2100,
        actions: [
          { type: "click", label: "click at (795, 124)" },
          { type: "type", label: 'type "API_KEY"' },
        ],
      }),
    ]);
    expect(progress.link).toBe("https://app.steel.dev/sessions/s1");
    expect(progress.parts.map((p) => [p.label, p.state])).toEqual([
      ["Starting a browser on Steel", "completed"],
      ['Model looking for "API_KEY"', "running"],
    ]);
    const looking = progress.parts[1];
    expect(looking.doing).toBe("thinking, turn 1");
    expect(looking.turns).toHaveLength(1);
    expect(looking.turns[0].thoughtMs).toBe(2100);
    expect(looking.turns[0].actions.map((a) => a.type)).toEqual(["click", "type"]);
  });

  it("still reads runs recorded before actions came as data", () => {
    const progress = groupProgress([
      item({ kind: "event", message: "Watch it on Steel: https://app.steel.dev/sessions/old" }),
      item({ kind: "step", state: "started", label: "Model adding the secret" }),
      item({ kind: "event", depth: 1, message: 'thought 3s → type "{{value}}", wait 1s' }),
      item({ kind: "step", state: "completed", label: "Model adding the secret", duration_ms: 9000, note: "3 turns" }),
    ]);
    expect(progress.link).toBe("https://app.steel.dev/sessions/old");
    const adding = progress.parts[0];
    expect(adding.note).toBe("3 turns");
    expect(adding.turns[0].actions.map(actionText)).toEqual(["Type the secret's value", "Wait 1s"]);
  });

  it("keeps a part-less message as a notice", () => {
    const progress = groupProgress([item({ kind: "event", message: "Studio already lists API_KEY, so it isn't added again" })]);
    expect(progress.notices.map((n) => n.message)).toEqual(["Studio already lists API_KEY, so it isn't added again"]);
  });
});
