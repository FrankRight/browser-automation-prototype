import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StartRun, toSecretName } from "../components/start-run";

const posted: unknown[] = [];

beforeEach(() => {
  posted.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "run_new" }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StartRun", () => {
  it("asks only for a name and an environment, and leaves the value to the run", async () => {
    const onStarted = vi.fn();
    render(<StartRun open onOpenChange={() => {}} onStarted={onStarted} />);
    expect(screen.queryByPlaceholderText("Enter secret value")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Environments" }).textContent).toContain("All environments");
    expect(screen.getByRole("button", { name: /Start the run/ }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("e.g., MY_API_KEY"), { target: { value: "my api-key" } });
    fireEvent.click(screen.getByRole("button", { name: /Start the run/ }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("run_new"));
    expect(posted).toEqual([{ workflow: "create_secret", input: { name: "MY_API_KEY", environments: ["All Environments"] } }]);
  });

  it("forces names into UPPER_SNAKE_CASE", () => {
    expect(toSecretName("open ai-key 2!")).toBe("OPEN_AI_KEY_2");
  });
});
