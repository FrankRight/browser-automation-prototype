import type { ApprovalRequested, PauseOption } from "@browser-prototype/contract";
import { Check, Loader2, PauseCircle, X } from "lucide-react";
import { useState } from "react";

import { Button, Question } from "./ui";

const POSITIVE = /^(approve|continue|created|yes)$/;

/** What a run asks a person, and the buttons that answer it. Approve sends "approved", as Studio's card does. */
export function ApprovalCard({
  request,
  onAnswer,
}: {
  request: ApprovalRequested;
  onAnswer: (response: string) => Promise<void>;
}) {
  const [sending, setSending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const answer = async (response: string) => {
    setSending(response);
    setProblem(null);
    try {
      await onAnswer(response);
    } catch (error) {
      setProblem((error as Error).message);
      setSending(null);
    }
  };

  const response = (option: PauseOption) =>
    request.input_type === "approval" ? (option.id === "approve" ? "approved" : "rejected") : option.id;
  const ordered = [...request.options].sort((a, b) => Number(POSITIVE.test(a.id)) - Number(POSITIVE.test(b.id)));

  return (
    <section className="animate-rise-in border border-warning/40 shadow-sm" aria-label="Awaiting your answer">
      <div className="flex items-center gap-2 bg-warning/15 px-4 py-2 text-sm font-medium text-warning">
        <PauseCircle className="size-4" aria-hidden="true" />
        {request.input_type === "approval" ? "Awaiting your approval" : "Waiting for your answer"}
      </div>
      <div className="space-y-4 p-4">
        <Question text={request.question} />
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {sending && <span className="mr-auto animate-fade-in text-xs text-muted-foreground">Sending your answer…</span>}
          {ordered.map((option) => {
            const value = response(option);
            const positive = POSITIVE.test(option.id);
            return (
              <Button
                key={option.id}
                variant={positive ? "primary" : "destructive"}
                disabled={sending !== null}
                onClick={() => answer(value)}
              >
                {sending === value ? <Loader2 className="animate-spin" /> : positive ? <Check /> : <X />}
                {option.label}
              </Button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
