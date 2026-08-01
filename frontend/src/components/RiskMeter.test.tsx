import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RiskMeter } from "./RiskMeter";

describe("RiskMeter", () => {
  it("shows the numeric score and verdict label", () => {
    render(<RiskMeter score={72} verdict="suspicious" />);

    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("suspicious")).toBeInTheDocument();
  });

  it("exposes the score as an accessible progress value", () => {
    render(<RiskMeter score={72} verdict="suspicious" />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "72");
  });
});
