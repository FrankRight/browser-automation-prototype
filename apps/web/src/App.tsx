import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { RunPage } from "./components/run-page";
import { RunsList } from "./components/runs-list";
import { StartRun } from "./components/start-run";
import { TopBar } from "./components/top-bar";
import { api, ApiError, signInFromAddress } from "./lib/api";

function runFromAddress(): string | null {
  return new URLSearchParams(window.location.search).get("run");
}

/** Runs, and one run at ?run=<id>, as Studio opens them. */
export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [runId, setRunId] = useState<string | null>(runFromAddress);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    signInFromAddress()
      .then(() => api.runs())
      .then(() => setSignedIn(true))
      .catch((error) => setSignedIn(!(error instanceof ApiError && error.status === 401)));
    const follow = () => setRunId(runFromAddress());
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  const go = (next: string | null) => {
    history.pushState(null, "", next ? `?run=${encodeURIComponent(next)}` : window.location.pathname);
    setRunId(next);
  };

  if (signedIn === false) {
    return (
      <div className="flex h-dvh flex-col">
        <TopBar trail={[{ label: "Runs" }]} />
        <main className="mx-auto max-w-lg animate-fade-in space-y-3 px-6 py-24">
          <KeyRound className="size-5 text-muted-foreground" aria-hidden="true" />
          <h1 className="font-display text-xl font-medium">Open the runner's address to sign in</h1>
          <p className="text-muted-foreground">
            When the runner starts, it prints an address ending in <span className="font-mono">#token=…</span>. Open that
            address in this browser once; the page then signs in by itself.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        trail={runId ? [{ label: "Runs", onClick: () => go(null) }, { label: runId, mono: true }] : [{ label: "Runs" }]}
      />
      {signedIn === null ? null : runId ? (
        <RunPage key={runId} runId={runId} onNewRun={() => (go(null), setStarting(true))} />
      ) : (
        <RunsList onOpen={go} onNew={() => setStarting(true)} />
      )}
      <StartRun open={starting} onOpenChange={setStarting} onStarted={go} />
    </div>
  );
}
