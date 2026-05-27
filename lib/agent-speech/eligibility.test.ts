import { emotionForMessage, isSpeakEligible } from "@/lib/agent-speech/eligibility";

describe("isSpeakEligible", () => {
  it("allows completed assistant messages", () => {
    expect(
      isSpeakEligible({
        id: "1",
        role: "assistant",
        content: "All clear.",
        source: "assistant",
      }),
    ).toBe(true);
  });

  it("rejects pending and user messages", () => {
    expect(
      isSpeakEligible({
        id: "2",
        role: "assistant",
        content: "Analyzing dashboard context...",
        pending: true,
      }),
    ).toBe(false);

    expect(
      isSpeakEligible({
        id: "3",
        role: "user",
        content: "Hello",
        source: "user",
      }),
    ).toBe(false);
  });

  it("allows weather and system broadcasts", () => {
    expect(
      isSpeakEligible({
        id: "4",
        role: "system",
        content: "Typhoon watch issued.",
        source: "weather_report",
      }),
    ).toBe(true);

    expect(
      isSpeakEligible({
        id: "5",
        role: "system",
        content: "Urgent incident reported.",
        source: "system",
      }),
    ).toBe(true);
  });

  it("rejects operator relay messages", () => {
    expect(
      isSpeakEligible({
        id: "6",
        role: "assistant",
        content: "On my way.",
        source: "operator",
      }),
    ).toBe(false);
  });
});

describe("emotionForMessage", () => {
  it("maps sources to emotions", () => {
    expect(
      emotionForMessage({
        id: "w",
        role: "system",
        content: "Rain expected.",
        source: "weather_report",
      }),
    ).toBe("weather");

    expect(
      emotionForMessage({
        id: "s",
        role: "system",
        content: "Flood alert.",
        source: "system",
      }),
    ).toBe("urgent");
  });
});
