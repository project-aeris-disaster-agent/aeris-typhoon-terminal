import {
  applyThemeToDocument,
  readDocumentTheme,
  resolveStoredTheme,
  STORAGE_KEY,
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
} from "./theme-storage";

describe("resolveStoredTheme", () => {
  it("maps dark explicitly", () => {
    expect(resolveStoredTheme("dark")).toBe("dark");
  });

  it("maps system via prefersDark", () => {
    expect(resolveStoredTheme("system", true)).toBe("dark");
    expect(resolveStoredTheme("system", false)).toBe("light");
  });

  it("defaults unknown values to light", () => {
    expect(resolveStoredTheme(null)).toBe("light");
    expect(resolveStoredTheme("light")).toBe("light");
    expect(resolveStoredTheme("")).toBe("light");
  });
});

describe("applyThemeToDocument", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    document.querySelector('meta[name="theme-color"]')?.remove();
  });

  it("applies dark class, data-theme, and meta color", () => {
    applyThemeToDocument("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      THEME_COLOR_DARK,
    );
  });

  it("applies light class and meta color", () => {
    applyThemeToDocument("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      THEME_COLOR_LIGHT,
    );
  });

  it("updates existing theme-color meta", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "#ffffff");
    document.head.appendChild(meta);

    applyThemeToDocument("dark");
    expect(meta.getAttribute("content")).toBe(THEME_COLOR_DARK);
  });
});

describe("readDocumentTheme", () => {
  it("reads from document class", () => {
    document.documentElement.classList.add("dark");
    expect(readDocumentTheme()).toBe("dark");
    document.documentElement.classList.remove("dark");
    expect(readDocumentTheme()).toBe("light");
  });
});

describe("STORAGE_KEY", () => {
  it("matches aeris-theme", () => {
    expect(STORAGE_KEY).toBe("aeris-theme");
  });
});
