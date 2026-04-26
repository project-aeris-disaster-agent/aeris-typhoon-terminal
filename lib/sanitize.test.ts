import { escapeHtml, isSafeUrl, isSpam, sanitizeText } from "./sanitize";

describe("sanitize helpers", () => {
  it("strips tags, control characters, collapses whitespace, and truncates", () => {
    const raw = "  <b>Flood</b>\n\r\talert\u0000 in   Cebu   City  ";
    expect(sanitizeText(raw, 12)).toBe("Flood alert ");
  });

  it("detects spammy content patterns but not normal incident reports", () => {
    expect(isSpam("Best CASINO crypto giveaway now")).toBe(true);
    expect(isSpam("Need evacuation for flooded barangay road")).toBe(false);
  });

  it("accepts only http and https URLs", () => {
    expect(isSafeUrl("https://example.com/photo.jpg")).toBe(true);
    expect(isSafeUrl("http://example.com/photo.jpg")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,boom")).toBe(false);
    expect(isSafeUrl("not a url")).toBe(false);
  });

  it("escapes all dangerous html characters in output", () => {
    expect(escapeHtml(`<tag attr="1">'&"</tag>`)).toBe(
      "&lt;tag attr=&quot;1&quot;&gt;&#39;&amp;&quot;&lt;/tag&gt;",
    );
  });
});
