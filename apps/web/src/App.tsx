import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { RunPage } from "./components/run-page";
import { RunsList } from "./components/runs-list";
import { api, ApiError, signInFromAddress } from "./lib/api";

function runFromAddress(): string | null {
  return new URLSearchParams(window.location.search).get("run");
}

/** Runs, and one run at ?run=<id>, as Studio opens them. */
export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [runId, setRunId] = useState<string | null>(runFromAddress);

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

  if (signedIn === null) return null;
  if (!signedIn) {
    return (
      <main className="mx-auto max-w-lg space-y-3 px-6 py-24">
        <KeyRound className="size-5 text-muted-foreground" aria-hidden="true" />
        <h1 className="font-display text-xl font-medium">Open the runner's address to sign in</h1>
        <p className="text-muted-foreground">
          When the runner starts, it prints an address ending in <span className="font-mono">#token=…</span>. Open that
          address in this browser once; the page then signs in by itself.
        </p>
      </main>
    );
  }
  return runId ? <RunPage runId={runId} onBack={() => go(null)} /> : <RunsList onOpen={go} />;
}
