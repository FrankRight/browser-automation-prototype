import type { ApprovalRequested } from "@browser-prototype/contract";
import { EyeOff, Globe, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { Button } from "./ui";

/**
 * The live browser a person uses while the run waits on them, such as to sign in. It opens as
 * a drawer on the right that pushes the steps aside, and closes once the person continues.
 *
 * Its link controls a signed-in browser, so the drawer asks the runner for it only when it
 * opens, keeps it in this component's memory, and drops it when it closes: never in storage,
 * the address bar or the run's events. The model sees nothing while the person works here.
 */
export function BrowserDrawer({
  open,
  runId,
  title,
  request,
  onAnswer,
}: {
  open: boolean;
  runId: string;
  title?: string;
  request?: ApprovalRequested;
  onAnswer: (response: "approved" | "rejected") => Promise<void>;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState<"approved" | "rejected" | null>(null);
  // Keep showing the last request while the drawer slides shut.
  const shown = useRef({ title, request });
  if (open && request) shown.current = { title, request };

  useEffect(() => {
    if (!open) {
      setLink(null);
      setProblem(null);
      setSending(null);
      return;
    }
    let current = true;
    api
      .browser(runId)
      .then(({ url }) => current && setLink(url))
      .catch((error: Error) => current && setProblem(error.message));
    return () => {
      current = false;
    };
  }, [open, runId, request?.step_key]);

  const answer = async (response: "approved" | "rejected") => {
    setSending(response);
    try {
      await onAnswer(response);
    } catch (error) {
      setProblem((error as Error).message);
      setSending(null);
    }
  };

  const options = shown.current.request?.options ?? [];
  const label = (id: string, fallback: string) => options.find((o) => o.id === id)?.label ?? fallback;

  return (
    <aside
      aria-label="Live browser"
      aria-hidden={!open}
      inert={!open}
      className="relative shrink-0 overflow-hidden border-l border-border bg-background transition-[width,border-color] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
      style={{ width: open ? "var(--drawer-width)" : 0, borderLeftColor: open ? undefined : "transparent" }}
    >
      <div className="flex h-full flex-col" style={{ width: "var(--drawer-width)" }}>
        <div className="space-y-1 border-b border-border px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 font-display text-base font-medium">
              <Globe className="size-4 text-warning" aria-hidden="true" />
              {shown.current.title ?? "Live browser"}
            </h2>
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <EyeOff className="size-3.5" aria-hidden="true" /> The model doesn't see this screen
            </span>
          </div>
          <p className="text-muted-foreground">{shown.current.request?.question.replace(/\*\*/g, "")}</p>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-card p-4">
          <div className="relative aspect-[1280/800] max-h-full w-full bg-background shadow-sm">
            {link ? (
              <iframe
                title="Live browser for this run"
                src={link}
                className="absolute inset-0 size-full animate-fade-in"
                allow="clipboard-read; clipboard-write; autoplay"
                referrerPolicy="no-referrer"
              />
            ) : (
              open && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
                  {problem ? (
                    <span className="max-w-md text-center text-destructive">{problem}</span>
                  ) : (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Opening the browser…
                    </>
                  )}
                </div>
              )
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border px-6 py-3">
          <span className="text-xs text-muted-foreground">
            {sending === "approved" ? "Continuing the run…" : "The run waits here until you continue."}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={sending !== null} onClick={() => answer("rejected")}>
              {label("reject", "Cancel")}
            </Button>
            <Button disabled={sending !== null} onClick={() => answer("approved")}>
              {sending === "approved" && <Loader2 className="animate-spin" />}
              {label("approve", "Continue")}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
