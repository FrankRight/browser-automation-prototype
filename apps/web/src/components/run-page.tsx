import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { stepLabel, type ProgressItem, type StepView } from "../lib/run-view";
import { useRun } from "../lib/use-run";
import { clockTime, cn, duration } from "../lib/utils";
import { ApprovalCard } from "./approval-card";
import { BrowserPanel } from "./browser-panel";
import { Linked, Mono, StatusPill, StepIcon } from "./ui";

/** A run: its steps on the left, the chosen step on the right, and the person's part whenever it's waiting. */
export function RunPage({ runId, onBack }: { runId: string; onBack: () => void }) {
  const { run, view, problem } = useRun(runId);
  const [chosen, setChosen] = useState<string | null>(null);

  // Follow the run: the step waiting on a person, else the latest step, unless someone picked one.
  const latest = view.waiting?.key ?? view.steps.at(-1)?.key ?? null;
  useEffect(() => {
    if (view.waiting) setChosen(view.waiting.key);
  }, [view.waiting?.key]);
  const selected = view.steps.find((s) => s.key === (chosen ?? latest)) ?? view.steps.at(-1);

  const answer = async (response: string) => {
    await api.resume(runId, response);
  };

  const status = view.steps.length ? view.status : (run?.status ?? "queued");
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-6 py-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" /> Runs
        </button>
        <h1 className="font-display text-lg font-medium">{run?.workflow ?? "Run"}</h1>
        <StatusPill status={status} />
        <Mono>{runId}</Mono>
        {run?.input && typeof run.input.name === "string" && (
          <span className="text-muted-foreground">
            for <span className="font-mono text-foreground">{run.input.name}</span>
          </span>
        )}
        <span className="ml-auto text-muted-foreground">{run && `Started ${clockTime(run.created)}`}</span>
      </header>

      {problem && <p className="border-b border-border px-6 py-3 text-destructive">{problem}</p>}
      <Outcome status={status} output={view.output} error={view.error} />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(16rem,22rem)_1fr]">
        <nav aria-label="Steps" className="overflow-y-auto border-r border-border">
          <ol>
            {view.steps.map((step) => (
              <li key={step.key}>
                <button
                  type="button"
                  onClick={() => setChosen(step.key)}
                  aria-current={selected?.key === step.key}
                  className={cn(
                    "flex w-full items-start gap-3 border-l-2 border-transparent px-4 py-3 text-left hover:bg-accent",
                    selected?.key === step.key && "border-primary bg-accent",
                  )}
                >
                  <StepIcon status={step.status} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{stepLabel(step)}</span>
                    <Mono>{step.key}</Mono>
                  </span>
                  <Mono>{duration(step.durationMs)}</Mono>
                </button>
              </li>
            ))}
            {status === "running" && view.steps.every((s) => s.status !== "running") && (
              <li className="flex items-center gap-3 px-4 py-3 text-muted-foreground">
                <StepIcon status="pending" /> Working…
              </li>
            )}
          </ol>
        </nav>

        <section className="min-w-0 overflow-y-auto p-6" aria-label="Step details">
          {selected ? (
            <StepDetails step={selected} waiting={view.waiting?.key === selected.key && !view.takeover} onAnswer={answer} />
          ) : (
            <p className="text-muted-foreground">Starting the run…</p>
          )}
        </section>
      </div>

      {view.takeover && view.waiting?.request && (
        <BrowserPanel runId={runId} request={view.waiting.request} onAnswer={answer} />
      )}
    </div>
  );
}

function Outcome({ status, output, error }: { status: string; output: unknown; error?: string }) {
  if (status === "failed") {
    return <p className="border-b border-border bg-destructive/10 px-6 py-3 text-destructive">The run failed: {error}</p>;
  }
  if (status !== "completed" || !output || typeof output !== "object") return null;
  const result = output as { name?: string; status?: string; environments?: string[] };
  const said: Record<string, string> = {
    created: "Created",
    exists: "Already there, so not created again:",
    declined: "Not approved, so nothing was created:",
    cancelled: "Cancelled at sign-in:",
  };
  return (
    <p className="border-b border-border bg-success/10 px-6 py-3">
      {said[result.status ?? ""] ?? `Finished: ${result.status}`} <span className="font-mono">{result.name}</span>
      {result.environments && ` for ${result.environments.join(", ")}`}
    </p>
  );
}

function StepDetails({
  step,
  waiting,
  onAnswer,
}: {
  step: StepView;
  waiting: boolean;
  onAnswer: (response: string) => Promise<void>;
}) {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 font-display text-base font-medium">
          <StepIcon status={step.status} /> {stepLabel(step)}
        </h2>
        <Mono>
          {step.key}
          {step.startedAt && ` · started ${clockTime(step.startedAt)}`}
          {step.durationMs !== undefined && ` · ${duration(step.durationMs)}`}
        </Mono>
      </div>

      {waiting && step.request && <ApprovalCard request={step.request} onAnswer={onAnswer} />}
      {!waiting && step.request && (
        <div className="space-y-1 bg-card p-4">
          <p className="text-muted-foreground">{step.request.question.replace(/\*\*/g, "")}</p>
          {step.answer && (
            <p>
              Answer: <span className="font-mono">{step.answer}</span>
            </p>
          )}
        </div>
      )}

      {step.progress.length > 0 && <Progress items={step.progress} running={step.status === "running"} />}

      {step.error && <pre className="overflow-x-auto bg-destructive/10 p-4 font-mono text-xs text-destructive">{step.error}</pre>}
      {step.output !== undefined && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Result</h3>
          <pre className="overflow-x-auto bg-card p-4 font-mono text-xs">{JSON.stringify(step.output, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

/** A step's progress as the runner narrated it: sub-steps with their times, and the model's actions. */
function Progress({ items, running }: { items: ProgressItem[]; running: boolean }) {
  const lastDetail = running ? items.findLast((i) => i.kind === "detail") : undefined;
  const lines = items.filter((i) => i.kind !== "detail" && !(i.kind === "step" && i.state === "started"));
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">What happened</h3>
      <ol className="space-y-1.5 border-l border-border pl-4">
        {lines.map((item) => (
          <li key={item.seq} className="flex gap-2" style={{ marginLeft: `${item.depth * 1.25}rem` }}>
            {item.kind === "step" ? (
              <>
                <StepIcon status={item.state === "failed" ? "failed" : "completed"} className="mt-0.5" />
                <span className="flex-1">
                  {item.label}
                  {item.note && <span className="text-muted-foreground"> · {item.note}</span>}
                </span>
                <Mono>{duration(item.duration_ms)}</Mono>
              </>
            ) : (
              <span className="text-muted-foreground">
                <Linked text={item.message ?? ""} />
              </span>
            )}
          </li>
        ))}
        {lastDetail && (
          <li className="flex items-center gap-2 text-info">
            <StepIcon status="running" /> {lastDetail.message}
          </li>
        )}
      </ol>
    </div>
  );
}
