import { stepLabel, type StepView } from "../lib/run-view";
import { cn, duration } from "../lib/utils";
import { StepIcon } from "./ui";

/** The run's steps as a timeline. The step a person should look at is marked, and running steps keep time. */
export function StepList({
  steps,
  selected,
  now,
  working,
  onSelect,
}: {
  steps: StepView[];
  selected?: string;
  now: number;
  /** True between steps, while the run decides what to do next. */
  working: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <nav aria-label="Steps" className="overflow-y-auto border-r border-border py-5">
      <h2 className="px-6 pb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Steps</h2>
      <ol>
        {steps.map((step, i) => {
          const last = i === steps.length - 1 && !working;
          return (
            <li key={step.key} className="relative animate-rise-in">
              {!last && (
                <span aria-hidden="true" className="absolute top-[2.125rem] -bottom-2 left-[2.125rem] w-px bg-border" />
              )}
              <button
                type="button"
                onClick={() => onSelect(step.key)}
                aria-current={selected === step.key ? "step" : undefined}
                className={cn(
                  "relative flex w-full items-start gap-3 px-6 py-3 text-left transition-colors duration-150 hover:bg-accent",
                  selected === step.key && "bg-accent",
                )}
              >
                {selected === step.key && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                <span className="relative z-10 flex size-5 items-center justify-center bg-background">
                  <StepIcon status={step.status} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{stepLabel(step)}</span>
                  <span
                    className={cn(
                      "block text-xs tabular-nums",
                      step.status === "waiting" ? "text-warning" : step.status === "failed" ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {subtitle(step, now)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {working && (
          <li className="flex animate-fade-in items-center gap-3 px-6 py-3 text-muted-foreground">
            <span className="flex size-5 items-center justify-center">
              <StepIcon status="pending" />
            </span>
            Working out the next step…
          </li>
        )}
      </ol>
    </nav>
  );
}

function subtitle(step: StepView, now: number): string {
  if (step.status === "waiting") return step.kind === "takeover" ? "Waiting for you in the browser" : "Waiting for you";
  if (step.status === "failed") return "Failed";
  if (step.status === "running") return step.startedAt ? `Running · ${duration(now - Date.parse(step.startedAt))}` : "Running";
  if (step.answer) return answerText(step.answer, step.kind);
  return duration(step.durationMs) || "Done";
}

export function answerText(answer: string, kind: StepView["kind"]): string {
  if (kind === "takeover") return answer === "approved" ? "Signed in" : "Cancelled";
  return { approved: "Approved", rejected: "Not approved" }[answer] ?? `Answered: ${answer.replace(/_/g, " ")}`;
}
