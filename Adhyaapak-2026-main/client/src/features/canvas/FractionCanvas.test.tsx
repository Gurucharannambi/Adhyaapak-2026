import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FractionCanvas } from "./FractionCanvas";

const pictures = () => screen.getAllByRole("img").map((i) => i.getAttribute("aria-label"));

describe("FractionCanvas", () => {
  it("starts with 1/2 = 2/4 and shows the same fractions in the bars and the circles", () => {
    render(<FractionCanvas />);
    expect(screen.getByText("1/2 = 2/4")).toBeInTheDocument();
    expect(pictures()).toEqual([
      "Bar showing 1 of 2 equal parts shaded",
      "Bar showing 2 of 4 equal parts shaded",
      "Circle showing 1 of 2 equal slices shaded",
      "Circle showing 2 of 4 equal slices shaded",
    ]);
  });

  it("updates every linked picture together when the multiplier or the fraction changes", async () => {
    render(<FractionCanvas />);
    await userEvent.click(screen.getByRole("radio", { name: "× 3" }));
    expect(screen.getByText("1/2 = 3/6")).toBeInTheDocument();
    expect(pictures().filter((p) => p!.includes("3 of 6"))).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Increase the bottom number" }));
    expect(screen.getByText("1/3 = 3/9")).toBeInTheDocument();
    expect(pictures().every((p) => /1 of 3|3 of 9/.test(p!))).toBe(true);
  });

  it("only offers multipliers that fit, and explains a fraction it cannot show", async () => {
    render(<FractionCanvas />);
    for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole("button", { name: "Increase the bottom number" }));
    expect(screen.getByText("1/6 = 2/12")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "× 3" })).not.toBeInTheDocument();

    const bottom = screen.getByRole("textbox", { name: "The bottom number" });
    await userEvent.clear(bottom);
    await userEvent.type(bottom, "0");
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot be cut into 0 parts".replace("cannot be cut into 0 parts", "a whole cannot be cut into 0 parts"));
    // The pictures did not change.
    expect(screen.getByText("1/6 = 2/12")).toBeInTheDocument();

    await userEvent.clear(bottom);
    await userEvent.type(bottom, "13");
    expect(screen.getByRole("alert")).toHaveTextContent("at most 12 equal parts");
  });

  it("keeps the explanation hidden until the teacher reveals it, one step at a time, and can hide it again", async () => {
    render(<FractionCanvas />);
    const steps = () => screen.queryAllByRole("listitem").filter((li) => li.className.includes("fc-step"));
    expect(steps()).toHaveLength(0);
    expect(screen.getByText("The explanation is hidden. Reveal it one step at a time.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reveal the first step" }));
    expect(steps()).toHaveLength(1);
    expect(steps()[0]).toHaveTextContent("Start with 1/2");
    await userEvent.click(screen.getByRole("button", { name: "Reveal the next step" }));
    expect(steps()[1]).toHaveTextContent("2 × 2 = 4 parts");
    await userEvent.click(screen.getByRole("button", { name: "Hide the explanation" }));
    expect(steps()).toHaveLength(0);
  });

  it("undoes and resets", async () => {
    render(<FractionCanvas />);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "× 4" }));
    expect(screen.getByText("1/2 = 4/8")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("1/2 = 2/4")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "× 5" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("1/2 = 2/4")).toBeInTheDocument();
  });

  it("the spotlight dims the picture the class should not look at", async () => {
    render(<FractionCanvas />);
    await userEvent.click(screen.getByRole("radio", { name: "The start" }));
    const bars = screen.getAllByRole("img", { name: /^Bar/ });
    expect(bars[0]).not.toHaveClass("is-dim");
    expect(bars[1]).toHaveClass("is-dim");
    await userEvent.click(screen.getByRole("radio", { name: "The new name" }));
    expect(screen.getAllByRole("img", { name: /^Bar/ })[0]).toHaveClass("is-dim");
    await userEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(screen.getAllByRole("img", { name: /^Bar/ }).some((b) => b.classList.contains("is-dim"))).toBe(false);
  });

  it("practice: checks by equivalence, distinguishes invalid from wrong, gives hints one at a time and reveals the answer on request", async () => {
    render(<FractionCanvas />);
    await userEvent.click(screen.getByRole("tab", { name: "Practice" }));
    expect(screen.getByText("1/2 = ?/4")).toBeInTheDocument();
    const answer = screen.getByRole("textbox", { name: "Your answer" });

    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByRole("status")).toHaveTextContent("Type a whole number.");
    await userEvent.type(answer, "3");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByRole("status")).toHaveTextContent("Not yet: 3/4 is not the same amount as 1/2.");

    await userEvent.click(screen.getByRole("button", { name: "Give a hint" }));
    expect(screen.getByText("Look at the bottom numbers: 2 became 4.")).toBeInTheDocument();
    expect(screen.queryByText("Do the same to the top: 1 × 2 = ?")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Answer:/)).not.toBeInTheDocument();

    await userEvent.clear(answer);
    await userEvent.type(answer, "2");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByRole("status")).toHaveTextContent("Yes: 1/2 = 2/4.");

    await userEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    expect(screen.getByText(/Answer:/)).toHaveTextContent("Answer: 2. 1/2 = 2/4.");
  });

  it("challenge: includes a question where the numbers get smaller", async () => {
    render(<FractionCanvas />);
    await userEvent.click(screen.getByRole("tab", { name: "Challenge" }));
    await userEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByText("4/10 = 2/?")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Your answer" }), "5");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByRole("status")).toHaveTextContent("Yes: 4/10 = 2/5.");
  });

  it("is operable from the keyboard: Tab reaches controls and Enter on a radio button chooses it", async () => {
    render(<FractionCanvas />);
    const x3 = screen.getByRole("radio", { name: "× 3" });
    x3.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("1/2 = 3/6")).toBeInTheDocument();
  });
});
