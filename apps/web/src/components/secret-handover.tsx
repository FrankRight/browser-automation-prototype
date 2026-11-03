import type { ApprovalRequested } from "@browser-prototype/contract";
import { Check, CheckCircle2, Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { Button, Question } from "./ui";

/**
 * The run's last step for a new secret: Studio has it, and the person copies its value.
 *
 * The value is fetched from the runner only while the run waits here, kept in this
 * component's memory, and masked until the person chooses to show it, since screens are
 * often shared. Copying doesn't need it shown. Confirming ends the run, which deletes the
 * value from this machine; Studio keeps it.
 */
export function SecretHandover({
  runId,
  request,
  onAnswer,
}: {
  runId: string;
  request: ApprovalRequested;
  onAnswer: (response: string) => Promise<void>;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let current = true;
    api
      .secret(runId)
      .then((secret) => current && setValue(secret.value))
      .catch((error: Error) => current && setProblem(error.message));
    return () => {
      current = false;
      setValue(null);
    };
  }, [runId, request.step_key]);

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setProblem("The browser didn't allow copying. Show the value and copy it by hand.");
    }
  };

  const confirm = async () => {
    setSending(true);
    try {
      await onAnswer("approved");
    } catch (error) {
      setProblem((error as Error).message);
      setSending(false);
    }
  };

  return (
    <section className="animate-rise-in border border-success/40 shadow-sm" aria-label="Copy your new secret">
      <div className="flex items-center gap-2 bg-success/10 px-4 py-2 text-sm font-medium text-success">
        <CheckCircle2 className="size-4" aria-hidden="true" /> Created in Studio. Copy its value now.
      </div>
      <div className="space-y-4 p-4">
        <Question text={request.question} />
        <div className="flex items-stretch border border-border">
          <code
            className="flex min-h-10 min-w-0 flex-1 items-center overflow-x-auto px-3 font-mono text-sm whitespace-nowrap select-all"
            aria-label="Secret value"
          >
            {value ? (shown ? value : "•".repeat(Math.min(value.length, 32))) : problem ? "" : "Fetching the value…"}
          </code>
          <button
            type="button"
            onClick={() => setShown(!shown)}
            disabled={!value}
            aria-label={shown ? "Hide the value" : "Show the value"}
            className="border-l border-border px-3 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
          <button
            type="button"
            onClick={copy}
            disabled={!value}
            className="inline-flex w-24 items-center justify-center gap-1.5 border-l border-border text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            {copied ? (
              <>
                <Check className="size-4 text-success" /> Copied
              </>
            ) : (
              <>
                <Copy className="size-4" /> Copy
              </>
            )}
          </button>
        </div>
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">Studio keeps the secret. It won't show you the value.</p>
          <Button onClick={confirm} disabled={!value || sending}>
            {sending ? <Loader2 className="animate-spin" /> : <Check />} I've copied it
          </Button>
        </div>
      </div>
    </section>
  );
}
