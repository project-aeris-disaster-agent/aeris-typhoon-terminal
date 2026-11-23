/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReportToasts } from "./ReportToasts";
import type { IncidentReport } from "@/services/reports-client";

function report(id: string, aiPriority?: IncidentReport["aiPriority"]): IncidentReport {
  return {
    id,
    category: "flood",
    description: `Family of 4 stranded (${id})`,
    position: [123.19, 13.62],
    createdAt: new Date().toISOString(),
    confirmations: 0,
    aiPriority,
  } as IncidentReport;
}

function poll(reports: IncidentReport[]) {
  act(() => {
    window.dispatchEvent(new CustomEvent("aeris:reports-updated", { detail: { reports } }));
  });
}

describe("ReportToasts", () => {
  it("toasts a new urgent report, not the backlog, and Go to flies the map", () => {
    const onGoTo = jest.fn();
    render(<ReportToasts onGoTo={onGoTo} onOpenReports={jest.fn()} />);

    poll([report("old", "urgent")]);
    expect(screen.queryByText(/stranded \(old\)/)).not.toBeInTheDocument();

    poll([report("old", "urgent"), report("new", "urgent"), report("calm", "low_priority")]);
    expect(screen.getByText(/stranded \(new\)/)).toBeInTheDocument();
    expect(screen.queryByText(/stranded \(calm\)/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go to" }));
    expect(onGoTo).toHaveBeenCalledWith(expect.objectContaining({ id: "new" }));
    expect(screen.queryByText(/stranded \(new\)/)).not.toBeInTheDocument();
  });

  it("caps the stack at three and offers the rest as +N more", () => {
    const onOpenReports = jest.fn();
    render(<ReportToasts onGoTo={jest.fn()} onOpenReports={onOpenReports} />);
    poll([report("seed")]);
    poll([report("seed"), ...["a", "b", "c", "d", "e"].map((id) => report(id, "urgent"))]);

    expect(screen.getAllByRole("button", { name: "Go to" })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "+2 more · open reports" }));
    expect(onOpenReports).toHaveBeenCalled();
  });

  it("renders nothing while hidden", () => {
    render(<ReportToasts hidden onGoTo={jest.fn()} onOpenReports={jest.fn()} />);
    poll([report("seed")]);
    poll([report("seed"), report("x", "urgent")]);
    expect(screen.queryByRole("region", { name: "Urgent report alerts" })).not.toBeInTheDocument();
  });
});
