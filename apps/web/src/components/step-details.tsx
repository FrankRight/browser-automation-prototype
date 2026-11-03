import { ArrowUpRight, ChevronRight, Info } from "lucide-react";

import { actionText, groupProgress, type Part } from "../lib/progress";
import { stepLabel, type StepView } from "../lib/run-view";
import { clockTime, cn, duration } from "../lib/utils";
import { ApprovalCard } from "./approval-card";
import { answerText } from "./step-list";
import { ActionIcon, Question, StepIcon } from "./ui";

/** One step: what it's doing or did, the model's turns inside it, and the person's part when it waits on them. */
export function StepDetails({
  step,
  waiting,
  now,
  onAnswer,
}: {
  step: StepView;
  /** True while this step waits for an answer on this page (not in the browser window). */
  waiting: boolean;
  now: number;
  onAnswer: (response: string) => Promise<void>;
}) {
  const progress = groupProgress(step.progress);
  const took = step.status === "running" && step.startedAt ? now - Date.parse(step.startedAt) : step.durationMs;
  return (
    <div className="mx-auto max-w-3xl animate-fade-in space-y-6 px-8 py-7">
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2.5 font-display text-lg font-medium">
            <StepIcon status={step.status} /> {stepLabel(step)}
          </h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            <span className="font-mono">{step.key}</span>
            {step.startedAt && ` · started ${clockTime(step.startedAt)}`}
            {took !== undefined && ` · ${duration(took)}`}
          </p>
        </div>
        {progress.link && (
          <a
            href={progress.link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Watch on Steel <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        )}
      </header>

      {waiting && step.request && <ApprovalCard request={step.request} onAnswer={onAnswer} />}
      {step.kind === "takeover" && step.status === "waiting" && (
        <p className="flex items-center gap-2 bg-card px-4 py-3 text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden="true" /> The browser is open on the right. The run carries on when you
          press Continue there.
        </p>
      )}
      {step.answer && step.request && (
        <div className="space-y-1 border-l-2 border-border pl-4">
          <Question text={step.request.question} />
          <p className="text-muted-foreground">{answerText(step.answer, step.kind)}</p>
        </div>
      )}

      {progress.parts.length > 0 && (
        <ol className="space-y-4">
          {progress.parts.map((part) => (
            <PartRow key={part.seq} part={part} now={now} />
          ))}
        </ol>
      )}

      {progress.notices.map((notice) => (
        <p key={notice.seq} className="flex animate-rise-in items-center gap-2 text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden="true" /> {notice.message}
        </p>
      ))}

      {step.error && (
        <pre className="overflow-x-auto bg-destructive/10 p-4 font-mono text-xs whitespace-pre-wrap text-destructive">
          {step.error}
        </pre>
      )}

      {step.output !== undefined && (
        <details className="group border-t border-border pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase select-none hover:text-foreground">
            <ChevronRight className="size-3.5 transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
            Output
          </summary>
          <pre className="mt-3 overflow-x-auto bg-card p-4 font-mono text-xs">{JSON.stringify(step.output, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

function PartRow({ part, now }: { part: Part; now: number }) {
  const took = part.state === "running" ? now - Date.parse(part.startedAt) : part.durationMs;
  return (
    <li className="animate-rise-in">
      <div className="flex items-center gap-3">
        <StepIcon status={part.state} />
        <span className={cn("flex-1", part.state === "running" ? "font-medium" : "text-foreground")}>
          {part.label}
          {part.note && <span className="text-muted-foreground"> · {part.note}</span>}
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{duration(took)}</span>
      </div>
      {part.doing && (
        <p className="mt-1 ml-7 animate-fade-in text-xs text-info" aria-live="polite">
          {part.doing.charAt(0).toUpperCase() + part.doing.slice(1)}…
        </p>
      )}
      {part.turns.length > 0 && (
        <ol className="mt-2.5 ml-[0.4375rem] space-y-2 border-l border-border pl-5">
          {part.turns.map((turn, i) => (
            <li key={turn.seq} className="flex animate-rise-in flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="w-28 shrink-0 text-xs text-muted-foreground tabular-nums">
                Turn {i + 1}
                {turn.thoughtMs !== undefined && ` · ${duration(turn.thoughtMs)}`}
              </span>
              {turn.actions.map((action, j) => (
                <span key={j} className="inline-flex items-center gap-1.5 bg-card px-2 py-1 text-xs">
                  <ActionIcon type={action.type} /> {actionText(action)}
                </span>
              ))}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
