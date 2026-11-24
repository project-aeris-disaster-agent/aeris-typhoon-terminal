import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FirstRunTutorial } from "./FirstRunTutorial";
import { BOOT_DONE_EVENT, TUTORIAL_OPEN_EVENT } from "@/lib/tutorial/storage";

function bootDone() {
  act(() => {
    (window as Window & { __aerisBootDone?: boolean }).__aerisBootDone = true;
    window.dispatchEvent(new Event(BOOT_DONE_EVENT));
  });
}

/** A `data-tour` target with a real-looking box (jsdom lays nothing out). */
function addTarget(name: string) {
  const el = document.createElement("div");
  el.setAttribute("data-tour", name);
  el.getBoundingClientRect = () =>
    ({ top: 100, left: 100, width: 200, height: 120, right: 300, bottom: 220 }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe("FirstRunTutorial", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete (window as Window & { __aerisBootDone?: boolean }).__aerisBootDone;
    document.querySelectorAll("[data-tour]").forEach((el) => el.remove());
  });

  it("opens after the boot screen on a first visit, and not before", () => {
    render(<FirstRunTutorial />);
    expect(screen.queryByRole("dialog")).toBeNull();
    bootDone();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Welcome to A.E.R.I.S.")).toBeInTheDocument();
  });

  it("walks through the steps and is not shown again once finished", async () => {
    const user = userEvent.setup();
    ["map", "layers", "alerts", "reports", "live-updates"].forEach(addTarget);
    const { unmount } = render(<FirstRunTutorial />);
    bootDone();

    expect(screen.getByText("Step 1 of 6")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("The live map")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Disaster Minds™" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Welcome to A.E.R.I.S.")).toBeInTheDocument();

    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByText("Ask me anything")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Let's go" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    unmount();
    render(<FirstRunTutorial />);
    bootDone();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves out steps whose target is not on screen", () => {
    addTarget("reports");
    render(<FirstRunTutorial />);
    bootDone();
    // welcome + reports only
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
  });

  it("switches language and remembers it", async () => {
    const user = userEvent.setup();
    addTarget("map");
    const { unmount } = render(<FirstRunTutorial />);
    bootDone();

    await user.click(screen.getByRole("button", { name: "TL" }));
    expect(screen.getByText("Maligayang pagdating sa A.E.R.I.S.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "BIS" }));
    expect(screen.getByText("Maayong pag-abot sa A.E.R.I.S.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Laktawi" })).toBeInTheDocument();

    unmount();
    render(<FirstRunTutorial />);
    act(() => {
      window.dispatchEvent(new Event(TUTORIAL_OPEN_EVENT));
    });
    expect(screen.getByText("Maayong pag-abot sa A.E.R.I.S.")).toBeInTheDocument();
  });

  it("Skip and Escape close it; the header button replays it", async () => {
    const user = userEvent.setup();
    addTarget("map");
    render(<FirstRunTutorial />);
    bootDone();
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      window.dispatchEvent(new Event(TUTORIAL_OPEN_EVENT));
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
