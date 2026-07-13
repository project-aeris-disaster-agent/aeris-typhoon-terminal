import {
  dedupeNewsItems,
  isRelevantNewsTitle,
  preferNewsItem,
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
      {
        title: "Sports trade rumor",
        url: "https://example.com/sports",
        publishedAt: "2026-05-26T10:00:00Z",
      },
      {
        title: "Heavy rain expected in Luzon",
        url: "https://example.com/rain",
        publishedAt: "2026-05-26T11:00:00Z",
      },
      {
        title: "Typhoon watch issued",
        url: "https://example.com/typhoon",
        publishedAt: "2026-05-26T12:00:00Z",
      },
    ];
    const out = rankAndFilterNewsItems(items, { minItems: 2 });
    expect(out.some((i) => i.title.includes("Typhoon"))).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it("dedupes the same headline across Google News and publisher feeds", () => {
    const items = [
      {
        id: "g",
        source: "Rappler",
        title: "LPA outside PAR develops into tropical depression",
        url: "https://news.google.com/articles/abc",
        publishedAt: "2026-07-13T08:00:00Z",
        relevance: 6,
      },
      {
        id: "r",
        source: "Rappler",
        title: "LPA outside PAR develops into tropical depression",
        url: "https://www.rappler.com/philippines/weather/lpa-update/",
        publishedAt: "2026-07-13T08:05:00Z",
        relevance: 6,
      },
    ];
    const out = dedupeNewsItems(items);
    expect(out).toHaveLength(1);
    expect(out[0].url).toContain("rappler.com");
  });

  it("prefers a direct publisher URL over an aggregator redirect", () => {
    const google = {
      url: "https://news.google.com/rss/articles/xyz",
      publishedAt: "2026-07-13T10:00:00Z",
    };
    const publisher = {
      url: "https://www.inquirer.net/flood-update/",
      publishedAt: "2026-07-13T09:00:00Z",
    };
    expect(preferNewsItem(google, publisher)).toBe(publisher);
  });

  it("collapses cross-feed duplicates during ranking", () => {
    const items = [
      {
        title: "PAGASA monitors LPA east of Mindanao",
        url: "https://news.google.com/articles/lpa",
        publishedAt: "2026-05-26T04:00:00Z",
      },
      {
        title: "PAGASA monitors LPA east of Mindanao",
        url: "https://www.gmanetwork.com/news/lpa",
        publishedAt: "2026-05-26T04:10:00Z",
      },
      {
        title: "Flood response in Manila",
        url: "https://inquirer.net/flood",
        publishedAt: "2026-05-26T03:00:00Z",
      },
    ];
    const out = rankAndFilterNewsItems(items, { minItems: 1 });
    const lpa = out.filter((i) => i.title.includes("PAGASA"));
    expect(lpa).toHaveLength(1);
    expect(lpa[0].url).toContain("gmanetwork.com");
  });
});
