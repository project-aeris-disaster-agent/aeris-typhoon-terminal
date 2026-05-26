import {
  isRelevantNewsTitle,
  rankAndFilterNewsItems,
  scoreNewsRelevance,
  splitGoogleNewsTitle,
} from "./news-relevance";

describe("news-relevance", () => {
  it("scores typhoon and PAGASA headlines highly", () => {
    expect(scoreNewsRelevance("PAGASA raises Signal No. 2 as typhoon approaches")).toBeGreaterThanOrEqual(6);
    expect(isRelevantNewsTitle("PAGASA raises Signal No. 2 as typhoon approaches")).toBe(true);
  });

  it("includes earthquake and building-collapse stories", () => {
    expect(
      isRelevantNewsTitle(
        "&#8216;Akala ko earthquake&#8217;: resident recalls building collapse",
      ),
    ).toBe(true);
  });

  it("splits Google News headline suffix into outlet", () => {
    expect(
      splitGoogleNewsTitle("Magnitude 5.3 quake hits Surigao - Inquirer.net"),
    ).toEqual({
      title: "Magnitude 5.3 quake hits Surigao",
      source: "Inquirer.net",
    });
  });

  it("falls back to relaxed ranking when too few strict matches", () => {
    const items = [
      { title: "Sports trade rumor", publishedAt: "2026-05-26T10:00:00Z" },
      { title: "Heavy rain expected in Luzon", publishedAt: "2026-05-26T11:00:00Z" },
      { title: "Typhoon watch issued", publishedAt: "2026-05-26T12:00:00Z" },
    ];
    const out = rankAndFilterNewsItems(items, { minItems: 2 });
    expect(out.some((i) => i.title.includes("Typhoon"))).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
});
