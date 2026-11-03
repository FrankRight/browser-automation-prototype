import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, KeyRound, Loader2, Play, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import { api } from "../lib/api";
import { Button } from "./ui";

const NAME = /^[A-Z][A-Z0-9_]*$/;

/** The choices, by what Studio's picker calls them: its "All Environments" option, and the project's environments. */
export const ENVIRONMENTS = [
  { value: "All Environments", label: "All environments", hint: "Also covers environments added later" },
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
];

/** Studio's rule for secret names, applied as the person types: UPPER_SNAKE_CASE. */
export function toSecretName(text: string): string {
  return text.toUpperCase().replace(/[\s-]+/g, "_").replace(/[^A-Z0-9_]/g, "");
}

/** The form that starts create_secret. The value isn't asked for: the run generates it, and hands it over at the end. */
export function StartRun({
  open,
  onOpenChange,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (runId: string) => void;
}) {
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState(ENVIRONMENTS[0].value);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

  const ready = NAME.test(name);

  const reset = () => {
    setName("");
    setEnvironment(ENVIRONMENTS[0].value);
    setProblem(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || starting) return;
    setStarting(true);
    setProblem(null);
    try {
      const run = await api.start("create_secret", { name, environments: [environment] });
      onOpenChange(false);
      reset();
      onStarted(run.id);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (onOpenChange(next), next || reset())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-foreground/30 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <Dialog.Content
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            nameInput.current?.focus();
          }}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-2xl outline-none data-[state=closed]:animate-slide-out-right data-[state=open]:animate-slide-in-right"
        >
          <form onSubmit={submit} className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div className="space-y-1">
                <Dialog.Title className="font-display text-lg font-medium">New run: create_secret</Dialog.Title>
                <Dialog.Description className="text-muted-foreground">
                  Adds a secret to the project in Studio, through Studio's own pages. You'll sign in if Studio needs it, and
                  approve before anything is created.
                </Dialog.Description>
              </div>
              <Dialog.Close className="p-1 text-muted-foreground transition-colors hover:text-foreground" aria-label="Close">
                <X className="size-4" />
              </Dialog.Close>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              <label className="block space-y-1.5">
                <span className="font-medium">Name</span>
                <input
                  ref={nameInput}
                  value={name}
                  onChange={(e) => setName(toSecretName(e.target.value))}
                  placeholder="e.g., MY_API_KEY"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-10 w-full border border-border bg-background px-3 font-mono transition-colors focus:border-primary"
                />
                <span className="block text-xs text-muted-foreground">Upper case, digits and underscores.</span>
              </label>

              <div className="space-y-1.5">
                <span id="environment-label" className="block font-medium">
                  Environments
                </span>
                <Select.Root value={environment} onValueChange={setEnvironment}>
                  <Select.Trigger
                    aria-labelledby="environment-label"
                    className="flex h-10 w-full items-center justify-between border border-border bg-background px-3 text-left transition-colors outline-none focus:border-primary data-[state=open]:border-primary"
                  >
                    <Select.Value />
                    <Select.Icon>
                      <ChevronDown className="size-4 text-muted-foreground" />
                    </Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content
                      position="popper"
                      sideOffset={4}
                      className="z-[60] w-[var(--radix-select-trigger-width)] border border-border bg-background shadow-lg data-[state=open]:animate-scale-in"
                    >
                      <Select.Viewport className="p-1">
                        {ENVIRONMENTS.map((option) => (
                          <Select.Item
                            key={option.value}
                            value={option.value}
                            className="relative flex cursor-pointer flex-col py-2 pr-9 pl-3 outline-none select-none data-[highlighted]:bg-accent"
                          >
                            <Select.ItemText>{option.label}</Select.ItemText>
                            {option.hint && <span className="text-xs text-muted-foreground">{option.hint}</span>}
                            <Select.ItemIndicator className="absolute top-2.5 right-3">
                              <Check className="size-4" />
                            </Select.ItemIndicator>
                          </Select.Item>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
              </div>

              <div className="flex gap-3 bg-card px-4 py-3">
                <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p className="text-muted-foreground">
                  The value is generated for you: 43 random characters. The model never sees it and the run doesn't record it.
                  Once Studio has the secret, you copy the value at the end of the run.
                </p>
              </div>

              {problem && <p className="animate-fade-in text-destructive">{problem}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
              {!ready && <span className="mr-auto text-xs text-muted-foreground">Add a name to start.</span>}
              <Dialog.Close asChild>
                <Button variant="ghost">Cancel</Button>
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
