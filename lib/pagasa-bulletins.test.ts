import { reduceBulletins, filterSupersededBulletins } from "@/lib/pagasa-bulletins";

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
});

describe("filterSupersededBulletins", () => {
  it("drops stale cyclones when one active system is far ahead", () => {
    const filtered = filterSupersededBulletins([
      {
        name: "Francisco",
        number: 16,
        final: false,
        file: "TCB#16_francisco.pdf",
        pdfUrl: "https://x/francisco.pdf",
      },
      {
        name: "Ester",
        number: 6,
        final: false,
        file: "TCB#6_ester.pdf",
        pdfUrl: "https://x/ester.pdf",
      },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("Francisco");
  });

  it("keeps multiple active cyclones when bulletin numbers are close", () => {
    const filtered = filterSupersededBulletins([
      {
        name: "Agaton",
        number: 4,
        final: false,
        file: "a.pdf",
        pdfUrl: "https://x/a.pdf",
      },
      {
        name: "Bising",
        number: 6,
        final: false,
        file: "b.pdf",
        pdfUrl: "https://x/b.pdf",
      },
    ]);
    expect(filtered).toHaveLength(2);
  });
});

describe("reduceBulletins with superseded filter", () => {
  it("removes laggard cyclones from real upstream-shaped payloads", () => {
    const out = reduceBulletins({
      error: false,
      age: 0,
      bulletins: [
        {
          name: "francisco",
          count: 16,
          final: false,
          file: "TCB#16_francisco.pdf",
          link: "https://pubfiles.pagasa.dost.gov.ph/x/TCB%2316_francisco.pdf",
        },
        {
          name: "ester",
          count: 6,
          final: false,
          file: "TCB#6_ester.pdf",
          link: "https://pubfiles.pagasa.dost.gov.ph/x/TCB%236_ester.pdf",
        },
      ],
    });
    expect(out!.bulletins).toHaveLength(1);
    expect(out!.bulletins[0].name).toBe("Francisco");
  });
});
