import type { ApprovalRequested } from "@browser-prototype/contract";
import { Globe, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../lib/api";
import { Button, Question } from "./ui";

/**
 * The live browser a person uses while the run waits on them, such as to sign in.
 *
 * Its link controls a signed-in browser, so the panel asks the runner for it only when it
 * opens, keeps it in this component's memory, and drops it when it closes: never in storage,
 * the address bar or the run's events. The model sees nothing while the person works here.
 */
export function BrowserPanel({
  runId,
  request,
  onAnswer,
}: {
  runId: string;
  request: ApprovalRequested;
  onAnswer: (response: "approved" | "rejected") => Promise<void>;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState<"approved" | "rejected" | null>(null);

  useEffect(() => {
    let open = true;
    api
      .browser(runId)
      .then(({ url }) => open && setLink(url))
      .catch((error: Error) => open && setProblem(error.message));
    return () => {
      open = false;
      setLink(null);
    };
  }, [runId, request.step_key]);

  const label = (id: string, fallback: string) => request.options.find((o) => o.id === id)?.label ?? fallback;

  const answer = async (response: "approved" | "rejected") => {
    setSending(response);
    try {
      await onAnswer(response);
    } catch (error) {
      setProblem((error as Error).message);
      setSending(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Live browser"
      className="fixed inset-0 z-40 flex flex-col bg-background/95 backdrop-blur-sm"
    >
      <header className="flex items-start justify-between gap-6 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-warning uppercase">
            <Globe className="size-3.5" aria-hidden="true" /> Live browser · waiting for you
          </div>
          <Question text={request.question} />
        </div>
        <p className="flex max-w-xs items-start gap-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          This page is the only place that holds this browser's link. The model doesn't see the screen while
          you use it.
        </p>
      </header>

      <main className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div className="aspect-[1280/800] w-full max-w-[1280px] border border-border bg-card">
          {link ? (
            <iframe
              title="Live browser for this run"
              src={link}
              className="block size-full"
              allow="clipboard-read; clipboard-write; autoplay"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex size-full items-center justify-center gap-2 text-muted-foreground">
              {problem ? (
                <span className="text-destructive">{problem}</span>
              ) : (
                <>
                  <Loader2 className="size-4 animate-spin" /> Opening the browser…
                </>
              )}
            </div>
          )}
        </div>
      </main>

      <footer className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
        <Button variant="secondary" disabled={sending !== null} onClick={() => answer("rejected")}>
          {label("reject", "Cancel")}
        </Button>
        <Button disabled={sending !== null} onClick={() => answer("approved")}>
          {sending === "approved" && <Loader2 className="animate-spin" />}
          {label("approve", "Continue")}
        </Button>
      </footer>
    </div>
  );
}
