import type { RunStatus } from "@browser-prototype/contract";
import {
  Camera,
  Check,
  CircleDashed,
  Clock,
  Hand,
  Keyboard,
  Loader2,
  MessageSquareText,
  MousePointerClick,
  Move,
  MoveVertical,
  PauseCircle,
  Sparkles,
  X,
} from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { StepStatus } from "../lib/run-view";
import { cn } from "../lib/utils";

const BUTTON = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-card text-foreground hover:bg-accent",
  ghost: "text-foreground hover:bg-accent",
  destructive: "bg-transparent text-destructive ring-1 ring-inset ring-destructive/40 hover:bg-destructive/10",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 px-4 text-sm font-medium whitespace-nowrap transition-[background-color,color,opacity] duration-150",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        BUTTON[variant],
        className,
      )}
      {...props}
    />
  );
}

const RUN_STATUS: Record<RunStatus, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "bg-muted text-muted-foreground" },
  running: { label: "Running", tone: "bg-info/15 text-info" },
  awaiting_user_input: { label: "Waiting for you", tone: "bg-warning/15 text-warning" },
  completed: { label: "Completed", tone: "bg-success/15 text-success" },
  failed: { label: "Failed", tone: "bg-destructive/15 text-destructive" },
};

export function StatusPill({ status }: { status: RunStatus }) {
  const { label, tone } = RUN_STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium transition-colors duration-300", tone)}>
      <span
        className={cn("size-1.5 rounded-full bg-current", status === "running" && "animate-pulse")}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

export function StepIcon({ status, className }: { status: StepStatus | "pending"; className?: string }) {
  const icons: Record<StepStatus | "pending", ReactNode> = {
    running: <Loader2 className="animate-spin text-info" aria-label="Running" />,
    completed: <Check className="text-success" aria-label="Done" />,
    failed: <X className="text-destructive" aria-label="Failed" />,
    waiting: <PauseCircle className="text-warning" aria-label="Waiting for you" />,
    pending: <CircleDashed className="text-muted-foreground" aria-label="Not started" />,
  };
  return <span className={cn("inline-flex [&_svg]:size-4", className)}>{icons[status]}</span>;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs text-muted-foreground", className)}>{children}</span>;
}

/** The **bold** markdown in pause questions, and nothing else. */
export function Question({ text }: { text: string }) {
  return (
    <p className="text-base leading-relaxed">
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </p>
  );
}

/** Text with its links made clickable, such as the Steel dashboard link in a step's progress. */
export function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https:\/\/\S+)/g).map((part, i) =>
        part.startsWith("https://") ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

const ACTION_ICONS: Record<string, typeof MousePointerClick> = {
  click: MousePointerClick,
  double_click: MousePointerClick,
  type: Keyboard,
  keypress: Keyboard,
  scroll: MoveVertical,
  move: Move,
  drag: Hand,
  wait: Clock,
  screenshot: Camera,
  answer: MessageSquareText,
};

export function ActionIcon({ type }: { type: string }) {
  const Icon = ACTION_ICONS[type] ?? Sparkles;
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** A thin bar that moves while something runs, under a header. */
export function Working() {
  return (
    <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden" role="presentation">
      <div className="h-full w-1/3 animate-progress bg-info/70" />
    </div>
  );
}
