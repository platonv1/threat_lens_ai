import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ScanTabs } from "./ScanTabs";

describe("ScanTabs", () => {
  it("shows the URL form by default", () => {
    render(<ScanTabs />);
    expect(screen.getByPlaceholderText("example.com")).toBeInTheDocument();
  });

  it("switches to the Email form when the Email tab is clicked", async () => {
    const user = userEvent.setup();
    render(<ScanTabs />);

    await user.click(screen.getByRole("tab", { name: "Email" }));

    expect(screen.getByPlaceholderText("Paste the email content here…")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("example.com")).not.toBeInTheDocument();
  });

  it("switches to the SMS form when the SMS tab is clicked", async () => {
    const user = userEvent.setup();
    render(<ScanTabs />);

    await user.click(screen.getByRole("tab", { name: "SMS" }));

    expect(screen.getByPlaceholderText("Paste the SMS text here…")).toBeInTheDocument();
  });

  it("switches to the Screenshot form when the Screenshot tab is clicked", async () => {
    const user = userEvent.setup();
    render(<ScanTabs />);

    await user.click(screen.getByRole("tab", { name: "Screenshot" }));

    expect(screen.getByLabelText(/upload a screenshot to scan/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("example.com")).not.toBeInTheDocument();
  });

  it("switches to the QR Code form when the QR Code tab is clicked", async () => {
    const user = userEvent.setup();
    render(<ScanTabs />);

    await user.click(screen.getByRole("tab", { name: "QR Code" }));

    expect(screen.getByLabelText(/upload an image containing a qr code/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("example.com")).not.toBeInTheDocument();
  });
});
