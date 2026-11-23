/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { useMediaQuery } from "./useMediaQuery";

type Listener = () => void;

function mockMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  window.matchMedia = jest.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      matches = next;
      listeners.forEach((l) => l());
    },
    listenerCount: () => listeners.size,
  };
}

describe("useMediaQuery", () => {
  it("reports the current match after mount and follows changes", () => {
    const media = mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(true);

    act(() => media.set(false));
    expect(result.current).toBe(false);
  });

  it("removes its listener on unmount", () => {
    const media = mockMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(media.listenerCount()).toBe(1);
    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
