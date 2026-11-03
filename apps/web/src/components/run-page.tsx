import type { RunStatus } from "@browser-prototype/contract";
import { ArrowRight, Check, CircleSlash, Loader2, Play, X } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { api } from "../lib/api";
import { activeStep, stepLabel, visibleSteps } from "../lib/run-view";
import { useNow } from "../lib/use-now";
import { useRun } from "../lib/use-run";
import { cn, duration } from "../lib/utils";
import { BrowserDrawer } from "./browser-drawer";
import { StepDetails } from "./step-details";
import { StepList } from "./step-list";
import { Button, Mono, StatusPill, Working } from "./ui";

/**
 * A run as it happens: its steps on the left, the step that matters now on the right, and the
 * person's part (a browser to sign in, an approval) the moment the run waits on them.
 */
export function RunPage({ runId, onNewRun }: { runId: string; onNewRun: () => void }) {
  const { run, events, view, problem } = useRun(runId);
  const steps = visibleSteps(view.steps);
  const active = activeStep(steps);

  // The page follows the run unless the person picks a step; a new pause always comes to the front.
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    if (view.waiting) setPinned(null);
  }, [view.waiting?.key]);
  const selected = steps.find((s) => s.key === pinned) ?? active;

  const status: RunStatus = events.length ? view.status : (run?.status ?? "queued");
  const live = status === "running" || status === "awaiting_user_input" || status === "queued";
  const now = useNow(live);
  const started = run ? Date.parse(run.created) : undefined;
  const ended = !live && events.length ? Date.parse(events[events.length - 1].time) : undefined;
  const elapsed = started !== undefined ? (ended ?? now) - started : undefined;
  const name = typeof run?.input.name === "string" ? run.input.name : undefined;

  const answer = async (response: string) => {
    await api.resume(runId, response);
  };

  return (
    <div
      className="flex min-h-0 flex-1 animate-fade-in flex-col"
      style={{ "--drawer-width": "min(60vw, 1080px)" } as CSSProperties}
    >
      <div className="relative shrink-0 border-b border-border px-8 py-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display text-xl font-medium">{title(run?.workflow)}</h1>
          {name && <span className="font-mono text-base">{name}</span>}
          <StatusPill status={status} />
          <span className="ml-auto flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
            {elapsed !== undefined && <span>{duration(elapsed)}</span>}
            <Mono>{runId}</Mono>
          </span>
        </div>
        {status === "running" && <Working />}
      </div>

      {problem && <p className="shrink-0 border-b border-border bg-destructive/10 px-8 py-3 text-destructive">{problem}</p>}
      {!live && events.length > 0 && (
        <Outcome status={status} output={view.output} error={view.error} elapsed={elapsed} onNewRun={onNewRun} />
      )}

      <div className="flex min-h-0 flex-1">
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(15rem,20rem)_1fr]">
          <StepList
            steps={steps}
            selected={selected?.key}
            now={now}
            working={status === "running" && !steps.some((s) => s.status === "running")}
            onSelect={(key) => setPinned(key === active?.key ? null : key)}
          />
          <section aria-label="Step details" className="relative min-w-0 overflow-y-auto">
            {pinned && live && active && pinned !== active.key && (
              <button
                type="button"
                onClick={() => setPinned(null)}
                className="sticky top-0 z-10 flex w-full animate-fade-in items-center justify-center gap-2 border-b border-border bg-background/95 py-2 text-xs text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
              >
                You're looking at an earlier step. <span className="font-medium text-foreground">Follow the run</span>
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </button>
            )}
            {selected ? (
              <StepDetails
                key={selected.key}
                runId={runId}
                step={selected}
                waiting={view.waiting?.key === selected.key && !view.takeover}
                now={now}
                onAnswer={answer}
              />
            ) : (
              <p className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Starting the run…
              </p>
            )}
          </section>
        </div>

        <BrowserDrawer
          open={view.takeover}
          runId={runId}
          title={view.waiting ? stepLabel(view.waiting) : undefined}
          request={view.waiting?.request}
          onAnswer={answer}
        />
      </div>
    </div>
  );
}

function title(workflow: string | undefined): string {
  if (!workflow) return "Run";
  const words = workflow.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Outcome({
  status,
  output,
  error,
  elapsed,
  onNewRun,
}: {
  status: RunStatus;
  output: unknown;
  error?: string;
  elapsed?: number;
  onNewRun: () => void;
}) {
  const result = (output ?? {}) as { name?: string; status?: string; environments?: string[] };
  const name = <span className="font-mono">{result.name}</span>;
  let tone = "bg-card";
  let icon: ReactNode = <CircleSlash className="size-4 text-muted-foreground" />;
  let text: ReactNode = `Finished: ${String(result.status ?? "done").replace(/_/g, " ")}.`;
  if (status === "failed") {
    tone = "bg-destructive/10 text-destructive";
    icon = <X className="size-4" />;
    text = `The run failed. ${error ?? ""}`;
  } else if (result.status === "created") {
    tone = "bg-success/10";
    icon = <Check className="size-4 text-success" />;
    text = (
      <>
        Created {name} for {result.environments?.join(", ")}.
      </>
    );
  } else if (result.status === "exists") {
    text = <>{name} was already in Studio, so nothing new was created.</>;
  } else if (result.status === "declined") {
    text = "Not approved, so nothing was created.";
  } else if (result.status === "cancelled") {
    text = "Cancelled at sign-in, so nothing was created.";
  }
  return (
    <div className={cn("flex shrink-0 animate-rise-in items-center gap-3 border-b border-border px-8 py-3", tone)}>
      {icon}
      <p className="flex-1">
        {text}
        {elapsed !== undefined && <span className="text-muted-foreground"> Took {duration(elapsed)}.</span>}
      </p>
      <Button variant="secondary" onClick={onNewRun}>
        <Play /> New run
      </Button>
    </div>
  );
}
