import * as Dialog from "@radix-ui/react-dialog";
import { Eye, EyeOff, Loader2, Play, X } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";

import { api } from "../lib/api";
import { Button } from "./ui";

const NAME = /^[A-Z][A-Z0-9_]*$/;

/** Studio's rule for secret names, applied as the person types: UPPER_SNAKE_CASE. */
export function toSecretName(text: string): string {
  return text.toUpperCase().replace(/[\s-]+/g, "_").replace(/[^A-Z0-9_]/g, "");
}

/** The form that starts create_secret, laid out like Studio's Add Secret. */
export function StartRun({ onStarted }: { onStarted: (runId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const [environments, setEnvironments] = useState<string[]>(["All Environments"]);
  const [adding, setAdding] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const ready = NAME.test(name) && value.length > 0 && environments.length > 0;

  const reset = () => {
    setName("");
    setValue("");
    setShown(false);
    setEnvironments(["All Environments"]);
    setProblem(null);
  };

  const addEnvironment = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !adding.trim()) return;
    event.preventDefault();
    if (!environments.includes(adding.trim())) setEnvironments([...environments, adding.trim()]);
    setAdding("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStarting(true);
    setProblem(null);
    try {
      const run = await api.start("create_secret", { name, environments, value });
      setOpen(false);
      reset();
      onStarted(run.id);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (setOpen(next), next || reset())}>
      <Dialog.Trigger asChild>
        <Button>
          <Play /> Run create_secret
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl">
          <form onSubmit={submit} className="flex h-full flex-col">
            <div className="flex items-start justify-between border-b border-border p-6">
              <div className="space-y-1">
                <Dialog.Title className="font-display text-lg font-medium">Run create_secret</Dialog.Title>
                <Dialog.Description className="text-muted-foreground">
                  Adds a secret to the project in Studio, through Studio's own pages. You'll sign in if needed and approve
                  before anything is created.
                </Dialog.Description>
              </div>
              <Dialog.Close className="p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="size-4" />
              </Dialog.Close>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              <label className="block space-y-1.5">
                <span className="font-medium">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(toSecretName(e.target.value))}
                  placeholder="e.g., MY_API_KEY"
                  autoComplete="off"
                  className="h-9 w-full border border-border bg-background px-3 font-mono"
                />
                <span className="block text-xs text-muted-foreground">Upper case, digits and underscores.</span>
              </label>

              <label className="block space-y-1.5">
                <span className="font-medium">Value</span>
                <span className="flex">
                  <input
                    type={shown ? "text" : "password"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Enter secret value"
                    autoComplete="off"
                    className="h-9 min-w-0 flex-1 border border-border bg-background px-3 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShown(!shown)}
                    aria-label={shown ? "Hide value" : "Show value"}
                    className="border border-l-0 border-border px-3 text-muted-foreground hover:text-foreground"
                  >
                    {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </span>
                <span className="block text-xs text-muted-foreground">
                  Never shown to the model or saved with the run: the browser types it in place of a placeholder.
                </span>
              </label>

              <div className="space-y-1.5">
                <span className="font-medium">Environments</span>
                <div className="flex flex-wrap gap-1.5 border border-border p-2">
                  {environments.map((environment) => (
                    <span key={environment} className="inline-flex items-center gap-1 bg-card px-2 py-1 text-xs">
                      {environment}
                      <button
                        type="button"
                        aria-label={`Remove ${environment}`}
                        onClick={() => setEnvironments(environments.filter((e) => e !== environment))}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={adding}
                    onChange={(e) => setAdding(e.target.value)}
                    onKeyDown={addEnvironment}
                    placeholder={environments.length ? "Add another" : "All Environments"}
                    aria-label="Add an environment"
                    className="min-w-24 flex-1 bg-transparent px-1 text-xs outline-none"
                  />
                </div>
                <span className="block text-xs text-muted-foreground">
                  At least one. All Environments also covers ones added later.
                </span>
              </div>

              {problem && <p className="text-destructive">{problem}</p>}
            </div>

            <div className="flex justify-end gap-2 border-t border-border p-6">
              <Dialog.Close asChild>
                <Button variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" disabled={!ready || starting}>
                {starting ? <Loader2 className="animate-spin" /> : <Play />} Start the run
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
