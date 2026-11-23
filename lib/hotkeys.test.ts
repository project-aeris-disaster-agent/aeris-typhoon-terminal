/**
 * @jest-environment jsdom
 */
import { isBareHotkey, isTypingTarget } from "./hotkeys";

function keydown(target: EventTarget, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key: "3", bubbles: true, ...init });
  Object.defineProperty(e, "target", { value: target });
  return e;
}

describe("hotkeys", () => {
  it("treats inputs, textareas, selects and contenteditable as typing", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(isTypingTarget(document.createElement(tag))).toBe(true);
    }
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.appendChild(inner);
    expect(isTypingTarget(inner)).toBe(true);
  });

  it("does not treat buttons or the page as typing", () => {
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("only fires bare hotkeys outside text fields and without modifiers", () => {
    expect(isBareHotkey(keydown(document.body))).toBe(true);
    expect(isBareHotkey(keydown(document.createElement("input")))).toBe(false);
    expect(isBareHotkey(keydown(document.body, { ctrlKey: true }))).toBe(false);
    expect(isBareHotkey(keydown(document.body, { metaKey: true }))).toBe(false);
  });
});
