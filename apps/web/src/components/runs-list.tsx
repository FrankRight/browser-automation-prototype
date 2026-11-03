import type { Run } from "@browser-prototype/contract";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { useNow } from "../lib/use-now";
import { duration, since } from "../lib/utils";
import { Button, Mono, StatusPill } from "./ui";

const LIVE = new Set(["queued", "running", "awaiting_user_input"]);

/** Every run, newest first, kept up to date while the page is open. */
export function RunsList({ onOpen, onNew }: { onOpen: (runId: string) => void; onNew: () => void }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const now = useNow(Boolean(runs?.some((run) => LIVE.has(run.status))));

  useEffect(() => {
    let current = true;
    const load = () =>
      api
        .runs()
        .then((latest) => current && (setRuns(latest), setProblem(null)))
        .catch((error: Error) => current && setProblem(error.message));
    load();
    const timer = setInterval(load, 3000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl animate-fade-in space-y-8 px-8 py-10">
        <div className="flex items-end justify-between gap-6">
          <div className="space-y-1">
            <h1 className="font-display text-2xl font-medium">Runs</h1>
            <p className="text-muted-foreground">
              Workflows that use a website the way a person would, on a local stand-in for AGNT5.
            </p>
          </div>
          <Button onClick={onNew}>
            <Play /> New run
          </Button>
        </div>

        {problem && <p className="text-destructive">{problem}</p>}

        {runs === null && !problem && (
          <div className="space-y-2" aria-label="Loading runs">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse bg-card" />
            ))}
          </div>
        )}

        {runs?.length === 0 && (
          <div className="animate-fade-in space-y-3 bg-card px-6 py-14 text-center">
            <p className="font-medium">No runs yet</p>
            <p className="text-muted-foreground">Start one to add a secret in Studio, with you approving the write.</p>
            <Button onClick={onNew} className="mt-2">
              <Play /> New run
            </Button>
          </div>
        )}

        {runs && runs.length > 0 && (
          <table className="w-full text-left">
            <thead className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="py-2.5 pr-4 font-medium">Status</th>
                <th className="py-2.5 pr-4 font-medium">Secret</th>
                <th className="py-2.5 pr-4 font-medium">Workflow</th>
                <th className="py-2.5 pr-4 font-medium">Started</th>
                <th className="py-2.5 pr-4 text-right font-medium">Duration</th>
                <th className="py-2.5 font-medium">
                  <span className="sr-only">Run</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  onClick={() => onOpen(run.id)}
                  className="group cursor-pointer border-b border-border transition-colors duration-150 hover:bg-accent"
                >
                  <td className="py-3.5 pr-4">
                    <StatusPill status={run.status} />
                  </td>
                  <td className="py-3.5 pr-4 font-mono text-xs">{String(run.input.name ?? "")}</td>
                  <td className="py-3.5 pr-4">{run.workflow}</td>
                  <td className="py-3.5 pr-4 text-muted-foreground">{since(run.created, now)}</td>
                  <td className="py-3.5 pr-4 text-right text-muted-foreground tabular-nums">
                    {duration((LIVE.has(run.status) ? now : Date.parse(run.updated)) - Date.parse(run.created))}
                  </td>
                  <td className="py-3.5 text-right">
                    <button
                      type="button"
                      onClick={(event) => (event.stopPropagation(), onOpen(run.id))}
                      className="text-muted-foreground group-hover:text-foreground"
                    >
                      <Mono>{run.id}</Mono>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
