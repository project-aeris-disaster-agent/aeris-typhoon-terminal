import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { STORAGE_KEY, THEME_COLOR_DARK, THEME_COLOR_LIGHT } from "@/lib/theme-storage";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      {theme}
    </button>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    document.querySelector('meta[name="theme-color"]')?.remove();
  });

  it("defaults to light and toggles with persistence", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    const button = screen.getByRole("button", { name: "light" });
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await user.click(button);
    expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      THEME_COLOR_DARK,
    );
  });

  it("resolves system preference from localStorage on mount", async () => {
    window.localStorage.setItem(STORAGE_KEY, "system");
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("restores dark from localStorage on init", async () => {
    window.localStorage.setItem(STORAGE_KEY, "dark");

    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "dark" })).toBeInTheDocument();
    });
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      THEME_COLOR_DARK,
    );
  });

  it("applies light theme-color meta when starting light", () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    );

    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      THEME_COLOR_LIGHT,
    );
  });
});
