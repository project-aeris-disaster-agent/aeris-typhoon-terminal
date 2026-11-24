import {
  GUIDE_BIOS,
  TUTORIAL_LANGS,
  TUTORIAL_STEPS,
  TUTORIAL_UI,
  detectTutorialLang,
} from "./content";

describe("tutorial content", () => {
  it("has every step in English, Tagalog and Bisaya", () => {
    for (const step of TUTORIAL_STEPS) {
      for (const lang of TUTORIAL_LANGS) {
        expect(step.title[lang].trim()).not.toBe("");
        expect(step.text[lang].trim()).not.toBe("");
      }
    }
    for (const lang of TUTORIAL_LANGS) {
      expect(TUTORIAL_UI[lang].next).toBeTruthy();
      expect(GUIDE_BIOS.aeris.role[lang]).toBeTruthy();
      expect(GUIDE_BIOS.minds.role[lang]).toBeTruthy();
    }
  });

  it("stays short: one headline and at most two sentences per step", () => {
    expect(TUTORIAL_STEPS.length).toBeLessThanOrEqual(6);
    for (const step of TUTORIAL_STEPS) {
      for (const lang of TUTORIAL_LANGS) {
        expect(step.text[lang].length).toBeLessThan(200);
      }
    }
  });

  it("guesses the language from the browser, defaulting to English", () => {
    expect(detectTutorialLang(["fil-PH", "en"])).toBe("tl");
    expect(detectTutorialLang(["tl"])).toBe("tl");
    expect(detectTutorialLang(["ceb-PH"])).toBe("ceb");
    expect(detectTutorialLang(["en-US"])).toBe("en");
    expect(detectTutorialLang(["ja-JP"])).toBe("en");
    expect(detectTutorialLang(undefined)).toBe("en");
  });
});
