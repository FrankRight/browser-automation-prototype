import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SecretHandover } from "../components/secret-handover";

const VALUE = "generated-value-for-the-test-0123456789abc";
const request = {
  step_key: "hand_over_secret_1",
  question: "Copy the value of **API_KEY** now.",
  input_type: "approval" as const,
  options: [{ id: "approve", label: "I've copied it" }],
  allow_custom: false,
  skippable: false,
};
const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ field: "value", value: VALUE }), { status: 200 })),
  );
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SecretHandover", () => {
  it("fetches the value, keeps it masked, and copies it without showing it", async () => {
    render(<SecretHandover runId="run_test" request={request} onAnswer={vi.fn()} />);
    const shownValue = screen.getByLabelText("Secret value");
    await waitFor(() => expect(shownValue.textContent).toMatch(/^•+$/));
    expect(screen.queryByText(VALUE)).toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/v1/runs/run_test/secret", expect.objectContaining({ cache: "no-store" }));

    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(VALUE));
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(screen.queryByText(VALUE)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show the value" }));
    expect(shownValue.textContent).toBe(VALUE);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(VALUE);
    expect(window.location.href).not.toContain(VALUE);
  });

  it("confirms with approved, which ends the run", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<SecretHandover runId="run_test" request={request} onAnswer={onAnswer} />);
    const confirm = screen.getByRole("button", { name: /I've copied it/ });
    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
    fireEvent.click(confirm);
    expect(onAnswer).toHaveBeenCalledWith("approved");
  });
});
