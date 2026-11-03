import type { Run, RunEvent } from "@browser-prototype/contract";
import { useEffect, useMemo, useState } from "react";

import { api } from "./api";
import { buildRunView } from "./run-view";

/** A run, kept live: its summary from the API, and its events from the run's stream. */
export function useRun(runId: string) {
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let open = true;
    setEvents([]);
    const refresh = () =>
      api
        .run(runId)
        .then((latest) => open && setRun(latest))
        .catch((error: Error) => open && setProblem(error.message));
    refresh();
    // The browser reconnects by itself after a drop, resuming from the last event it saw.
    const source = new EventSource(`/v1/runs/${runId}/stream`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      setEvents((seen) => (seen.some((e) => e.seq === event.seq) ? seen : [...seen, event]));
      if (event.type.startsWith("run.")) refresh();
      if (event.type === "run.completed" || event.type === "run.failed") source.close();
    };
    return () => {
      open = false;
      source.close();
    };
  }, [runId]);

  const view = useMemo(() => buildRunView(events), [events]);
  return { run, events, view, problem };
}
