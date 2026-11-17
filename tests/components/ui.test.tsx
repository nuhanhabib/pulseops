import { render, screen } from "@testing-library/react";
import { Activity } from "lucide-react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChartCard } from "@/components/charts/chart-card";
import { SegmentedBar, StatTile, UptimeBars } from "@/components/charts/figures";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { IncidentStatusBadge, MonitorStatusBadge, SeverityBadge } from "@/components/ui/status";
import { Pagination } from "@/components/ui/table";
import { SegmentedControl } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("status badges", () => {
  it("always pair colour with a text label", () => {
    render(<><MonitorStatusBadge status="DOWN" /><MonitorStatusBadge status="UP" /><IncidentStatusBadge status="MONITORING" /><SeverityBadge severity="CRITICAL" /></>);
    for (const label of ["Down", "Operational", "Monitoring", "Critical"]) expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("blocks clicks and announces busy state while loading", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: /save/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});

describe("Field", () => {
  it("wires the label, hint and error to the control for assistive technology", () => {
    const { rerender } = render(<Field label="URL" hint="Include https://"><Input /></Field>);
    const input = screen.getByLabelText("URL");
    expect(input).toHaveAccessibleDescription("Include https://");
    expect(input).not.toHaveAttribute("aria-invalid");
    rerender(<Field label="URL" hint="Include https://" error="Enter a full URL."><Input /></Field>);
    expect(screen.getByLabelText("URL")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a full URL.");
  });
});

describe("ConfirmDialog", () => {
  it("keeps a destructive action locked until the confirmation text is typed", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onOpenChange={() => {}} destructive title="Delete Acme?" description="This cannot be undone." confirmLabel="Delete organization" confirmText="acme" onConfirm={onConfirm} />);
    const confirm = screen.getByRole("button", { name: "Delete organization" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "acm");
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "e");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("states", () => {
  it("offers a way forward from empty and error states", async () => {
    const onRetry = vi.fn();
    render(<><EmptyState icon={Activity} title="No monitors yet" description="Add one." action={<Button>New monitor</Button>} /><ErrorState onRetry={onRetry} /></>);
    expect(screen.getByRole("button", { name: "New monitor" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("SegmentedControl and Pagination", () => {
  it("reports the selected option and changes", async () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Time range" value="24h" onChange={onChange} options={[{ value: "24h", label: "24h" }, { value: "7d", label: "7d" }]} />);
    expect(screen.getByRole("radio", { name: "24h" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "7d" }));
    expect(onChange).toHaveBeenCalledWith("7d");
  });
  it("disables paging at the bounds", () => {
    render(<Pagination page={1} totalPages={3} total={55} pageSize={25} onPageChange={() => {}} noun="monitors" />);
    expect(screen.getByText(/1–25 of 55 monitors/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
  });
});

describe("figures", () => {
  it("renders a stat tile with its change", () => {
    render(<StatTile label="Uptime" value="99.94%" delta={{ text: "+0.12 pts", direction: "up", good: true }} hint="vs previous 24h" />);
    expect(screen.getByText("99.94%")).toBeInTheDocument();
    expect(screen.getByText("+0.12 pts")).toBeInTheDocument();
  });
  it("gives every uptime bar a text equivalent, including days without data", () => {
    render(<TooltipProvider><UptimeBars days={[{ date: "2026-01-01", uptime: 100 }, { date: "2026-01-02", uptime: 97.5 }, { date: "2026-01-03", uptime: null }]} /></TooltipProvider>);
    expect(screen.getByLabelText("Jan 1: 100% uptime")).toBeInTheDocument();
    expect(screen.getByLabelText("Jan 2: 97.50% uptime")).toBeInTheDocument();
    expect(screen.getByLabelText("Jan 3: no data")).toBeInTheDocument();
  });
  it("shows counts and shares for a segmented bar", () => {
    render(<SegmentedBar segments={[{ label: "Operational", value: 9, color: "green" }, { label: "Down", value: 1, color: "red" }]} />);
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
  });
});

describe("ChartCard", () => {
  const table = { columns: ["Time", "Average"], rows: [["10:00", "120 ms"], ["10:30", "140 ms"]] };
  it("offers the same data as a table", async () => {
    render(<TooltipProvider><ChartCard title="Response time" table={table}><div>chart</div></ChartCard></TooltipProvider>);
    expect(screen.getByText("chart")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(screen.getByRole("columnheader", { name: "Average" })).toBeInTheDocument();
    expect(screen.getByText("140 ms")).toBeInTheDocument();
  });
  it("shows an empty state instead of an empty plot, and omits the legend for one series", () => {
    render(<TooltipProvider><ChartCard title="Response time" empty legend={[{ label: "Average", color: "blue" }]}><div>chart</div></ChartCard></TooltipProvider>);
    expect(screen.getByText("No data in this window")).toBeInTheDocument();
    expect(screen.queryByText("chart")).not.toBeInTheDocument();
    expect(screen.queryByText("Average")).not.toBeInTheDocument();
  });
});
