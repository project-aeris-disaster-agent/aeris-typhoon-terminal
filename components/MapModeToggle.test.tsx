import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapModeToggle } from "./MapModeToggle";

describe("MapModeToggle", () => {
  it("renders both modes, reflects pressed state, and notifies on click", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();

    render(<MapModeToggle mode="2d" onChange={onChange} />);

    const button2d = screen.getByRole("button", { name: "2D Analytical" });
    const button3d = screen.getByRole("button", { name: "3D Immersive" });

    expect(button2d).toHaveAttribute("aria-pressed", "true");
    expect(button3d).toHaveAttribute("aria-pressed", "false");

    await user.click(button3d);
    await user.click(button2d);

    expect(onChange).toHaveBeenNthCalledWith(1, "3d");
    expect(onChange).toHaveBeenNthCalledWith(2, "2d");
  });
});
