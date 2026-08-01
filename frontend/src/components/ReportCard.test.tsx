import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Finding } from "@/types/scan";
import { ReportCard } from "./ReportCard";

const findings: Finding[] = [
  { check: "ssl", message: "Valid HTTPS certificate.", severity: "info" },
  { check: "whois", message: "Domain registered 2 days ago.", severity: "high" },
];

describe("ReportCard", () => {
  it("lists each finding's check and message", () => {
    render(<ReportCard findings={findings} aiSummary="Looks risky." />);

    expect(screen.getByText("Valid HTTPS certificate.")).toBeInTheDocument();
    expect(screen.getByText("Domain registered 2 days ago.")).toBeInTheDocument();
  });

  it("shows the AI summary", () => {
    render(<ReportCard findings={findings} aiSummary="Looks risky." />);

    expect(screen.getByText("Looks risky.")).toBeInTheDocument();
  });

  it("renders a fallback message when there are no findings", () => {
    render(<ReportCard findings={[]} aiSummary="All clear." />);

    expect(screen.getByText(/no issues found/i)).toBeInTheDocument();
  });
});
