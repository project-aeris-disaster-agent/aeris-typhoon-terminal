import {
  reduceBulletins,
  isSwbQuietHtml,
  extractLatestArchiveBulletin,
  parseSwbPage,
} from "@/lib/pagasa-bulletins";

const FIXTURE = {
  error: false,
  age: 0,
  bulletins: [
    {
      name: "ester",
      count: 1,
      final: false,
      file: "TCB#1_ester.pdf",
      link: "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%231_ester.pdf",
    },
    {
      name: "ester",
      count: 6,
      final: false,
      file: "TCB#6_ester.pdf",
      link: "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%236_ester.pdf",
    },
    {
      name: "dindo",
      count: 12,
      final: true,
      file: "TCB#12_dindo.pdf",
      link: "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%2312_dindo.pdf",
    },
  ],
};

describe("reduceBulletins", () => {
  it("keeps the latest bulletin per cyclone and title-cases names", () => {
    const out = reduceBulletins(FIXTURE);
    expect(out).not.toBeNull();
    expect(out!.bulletins).toHaveLength(2);

    const ester = out!.bulletins.find((b) => b.name === "Ester");
    expect(ester).toBeDefined();
    expect(ester!.number).toBe(6);
    expect(ester!.final).toBe(false);
    expect(ester!.file).toBe("TCB#6_ester.pdf");
  });

  it("sorts active (non-final) cyclones ahead of final ones", () => {
    const out = reduceBulletins(FIXTURE);
    expect(out!.bulletins[0].name).toBe("Ester");
    expect(out!.bulletins[0].final).toBe(false);
    expect(out!.bulletins[1].name).toBe("Dindo");
    expect(out!.bulletins[1].final).toBe(true);
  });

  it("sets hasActive based on any non-final bulletin", () => {
    expect(reduceBulletins(FIXTURE)!.hasActive).toBe(true);
    const allFinal = {
      error: false,
      bulletins: [
        { name: "dindo", count: 12, final: true, file: "x", link: "https://x/y.pdf" },
      ],
    };
    expect(reduceBulletins(allFinal)!.hasActive).toBe(false);
  });

  it("parses upstream index age seconds", () => {
    const out = reduceBulletins({ ...FIXTURE, age: 742 });
    expect(out!.indexAgeSeconds).toBe(742);
  });

  it("leaves indexAgeSeconds null when upstream age is missing or invalid", () => {
    const { age: _age, ...withoutAge } = FIXTURE;
    expect(reduceBulletins(withoutAge)!.indexAgeSeconds).toBeNull();
    expect(reduceBulletins({ ...FIXTURE, age: -1 })!.indexAgeSeconds).toBeNull();
  });

  it("returns an empty list (not null) when no bulletins are active", () => {
    const out = reduceBulletins({ error: false, bulletins: [] });
    expect(out).not.toBeNull();
    expect(out!.bulletins).toHaveLength(0);
    expect(out!.hasActive).toBe(false);
  });

  it("returns null on upstream error or malformed payloads", () => {
    expect(reduceBulletins({ error: true })).toBeNull();
    expect(reduceBulletins(null)).toBeNull();
    expect(reduceBulletins({ foo: "bar" })).toBeNull();
  });

  it("skips entries missing required fields", () => {
    const out = reduceBulletins({
      error: false,
      bulletins: [
        { name: "", count: 1, link: "https://x/y.pdf" },
        { name: "agaton", count: null, link: "https://x/y.pdf" },
        { name: "agaton", count: 2, link: "" },
        { name: "agaton", count: 3, final: false, file: "f", link: "https://x/z.pdf" },
      ],
    });
    expect(out!.bulletins).toHaveLength(1);
    expect(out!.bulletins[0].name).toBe("Agaton");
    expect(out!.bulletins[0].number).toBe(3);
  });

  it("keeps concurrent active cyclones regardless of bulletin number gap", () => {
    // Former number-gap heuristic could drop a new #1 storm beside a stale #21.
    const out = reduceBulletins({
      error: false,
      age: 0,
      bulletins: [
        {
          name: "francisco",
          count: 21,
          final: false,
          file: "TCB#21_francisco.pdf",
          link: "https://pubfiles.pagasa.dost.gov.ph/x/TCB%2321_francisco.pdf",
        },
        {
          name: "julian",
          count: 1,
          final: false,
          file: "TCB#1_julian.pdf",
          link: "https://pubfiles.pagasa.dost.gov.ph/x/TCB%231_julian.pdf",
        },
      ],
    });
    expect(out!.bulletins.map((b) => b.name).sort()).toEqual([
      "Francisco",
      "Julian",
    ]);
  });
});

describe("isSwbQuietHtml", () => {
  it("detects the official quiet-PAR banner", () => {
    expect(
      isSwbQuietHtml(
        "<h3>No Active Tropical Cyclone within the Philippine Area of Responsibility</h3>",
      ),
    ).toBe(true);
  });

  it("is false when the quiet banner is absent", () => {
    expect(
      isSwbQuietHtml(
        "<h3>Tropical Cyclone Bulletin</h3><p>Tropical Cyclone INDAY</p>",
      ),
    ).toBe(false);
  });
});

describe("SWB archive parsing", () => {
  const QUIET_WITH_ARCHIVE = `
    <h3>No Active Tropical Cyclone within the Philippine Area of Responsibility</h3>
    <span>Archive</span>
    <a href="https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%231_inday.pdf">TCB#1_inday.pdf</a>
    <a href="https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%2316_inday.pdf">TCB#16_inday.pdf</a>
    <a href="https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%2315_inday.pdf">TCB#15_inday.pdf</a>
  `;

  it("picks only the highest-numbered archive PDF", () => {
    const latest = extractLatestArchiveBulletin(QUIET_WITH_ARCHIVE);
    expect(latest).toMatchObject({
      name: "Inday",
      number: 16,
      archive: true,
      final: true,
      file: "TCB#16_inday.pdf",
    });
    expect(latest!.pdfUrl).toContain("TCB%2316_inday.pdf");
  });

  it("parseSwbPage returns archive only when quiet", () => {
    const quiet = parseSwbPage(QUIET_WITH_ARCHIVE);
    expect(quiet.quiet).toBe(true);
    expect(quiet.latestArchive?.number).toBe(16);

    const active = parseSwbPage(
      `<h3>Tropical Cyclone Bulletin</h3>
       <a href="https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%231_ester.pdf">TCB#1_ester.pdf</a>`,
    );
    expect(active.quiet).toBe(false);
    expect(active.latestArchive).toBeNull();
  });
});
