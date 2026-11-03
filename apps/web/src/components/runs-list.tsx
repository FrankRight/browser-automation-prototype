import type { Run } from "@browser-prototype/contract";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { since } from "../lib/utils";
import { StartRun } from "./start-run";
import { Mono, StatusPill } from "./ui";

/** Every run, newest first, refreshed every few seconds. */
export function RunsList({ onOpen }: { onOpen: (runId: string) => void }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let open = true;
    const load = () =>
      api
        .runs()
        .then((latest) => open && (setRuns(latest), setProblem(null)))
        .catch((error: Error) => open && setProblem(error.message));
    load();
    const timer = setInterval(load, 3000);
    return () => {
      open = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-medium">Runs</h1>
          <p className="text-muted-foreground">
            Workflows that use a browser the way a person would, run on a local stand-in for AGNT5.
          </p>
        </div>
        <StartRun onStarted={onOpen} />
      </div>

      {problem && <p className="text-destructive">{problem}</p>}
      {runs && runs.length === 0 && (
        <p className="bg-card px-6 py-10 text-center text-muted-foreground">No runs yet. Run create_secret to start one.</p>
      )}
      {runs && runs.length > 0 && (
        <table className="w-full text-left">
          <thead className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Workflow</th>
              <th className="py-2 pr-4 font-medium">Secret</th>
              <th className="py-2 pr-4 font-medium">Run</th>
              <th className="py-2 font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                onClick={() => onOpen(run.id)}
                className="cursor-pointer border-b border-border hover:bg-accent"
              >
                <td className="py-3 pr-4">
                  <StatusPill status={run.status} />
                </td>
                <td className="py-3 pr-4 font-medium">{run.workflow}</td>
                <td className="py-3 pr-4 font-mono text-xs">{String(run.input.name ?? "")}</td>
                <td className="py-3 pr-4">
                  <button type="button" className="hover:underline" onClick={() => onOpen(run.id)}>
                    <Mono>{run.id}</Mono>
                  </button>
                </td>
                <td className="py-3 text-muted-foreground">{since(run.created)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
