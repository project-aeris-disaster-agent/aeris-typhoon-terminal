import {
  stormEmailBody,
  stormEmailSubject,
} from "@/lib/storm-watch/email-templates";

describe("storm email templates", () => {
  const bulletin = {
    name: "Ester",
    number: 1,
    final: false,
    file: "TCB#1_ester.pdf",
    pdfUrl: "https://pubfiles.pagasa.dost.gov.ph/tcb/1.pdf",
  };

  it("uses entered PAR subject for first bulletin", () => {
    expect(stormEmailSubject("Ester", bulletin, "entered_par")).toContain(
      "entered PAR",
    );
  });

  it("includes cyclone name and bulletin link in body", () => {
    const body = stormEmailBody({
      cycloneName: "Ester",
      bulletin,
      eventType: "entered_par",
      issuedAt: "2026-06-22T12:00:00.000Z",
    });
    expect(body).toContain("Tropical Cyclone Ester");
    expect(body).toContain("Philippine Area of Responsibility");
    expect(body).toContain(bulletin.pdfUrl);
    expect(body).toContain("Not an official PAGASA product");
  });
});
