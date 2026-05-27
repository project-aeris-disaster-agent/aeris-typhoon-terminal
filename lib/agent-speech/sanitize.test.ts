import {
  isPlaceholderSpeechContent,
  sanitizeForSpeech,
} from "@/lib/agent-speech/sanitize";

describe("sanitizeForSpeech", () => {
  it("strips markdown formatting", () => {
    expect(sanitizeForSpeech("**Current status:** No active warnings.")).toBe(
      "Current status: No active warnings.",
    );
  });

  it("caps length", () => {
    const long = "a".repeat(600);
    const out = sanitizeForSpeech(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith("...")).toBe(true);
  });
});

describe("isPlaceholderSpeechContent", () => {
  it("detects analyzing placeholder", () => {
    expect(isPlaceholderSpeechContent("Analyzing dashboard context...")).toBe(
      true,
    );
  });

  it("allows real assistant text", () => {
    expect(
      isPlaceholderSpeechContent("Standing by for queries."),
    ).toBe(false);
  });
});
