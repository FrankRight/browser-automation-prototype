import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApprovalCard } from "../components/approval-card";

afterEach(cleanup);

const approval = {
  step_key: "wait_for_user_1",
  question: "Create the secret **API_KEY** in Studio, for All Environments?",
  input_type: "approval" as const,
  options: [
    { id: "approve", label: "Create secret" },
    { id: "reject", label: "Don't create" },
  ],
  allow_custom: false,
  skippable: false,
};

describe("ApprovalCard", () => {
  it("sends approved, as Studio's card does", async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<ApprovalCard request={approval} onAnswer={onAnswer} />);
    expect(screen.getByText("API_KEY").tagName).toBe("STRONG");
    fireEvent.click(screen.getByRole("button", { name: /Create secret/ }));
    expect(onAnswer).toHaveBeenCalledWith("approved");
  });

  it("sends rejected", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<ApprovalCard request={approval} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: /Don't create/ }));
    expect(onAnswer).toHaveBeenCalledWith("rejected");
  });

  it("sends the chosen option's ID for a question", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const question = {
      ...approval,
      input_type: "select" as const,
      options: [
        { id: "created", label: "It's there" },
        { id: "not_created", label: "It isn't" },
      ],
    };
    render(<ApprovalCard request={question} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("button", { name: /It's there/ }));
    expect(onAnswer).toHaveBeenCalledWith("created");
  });
});
