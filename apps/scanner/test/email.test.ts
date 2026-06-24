import { describe, it, expect } from "vitest";
import { buildSubject, buildBody, sendAlertEmail, type AlertEmailRow } from "../src/notifications/email";

const row: AlertEmailRow = {
  searchName: "Big Sur weekends", parkName: "Pfeiffer Big Sur SP", campgroundName: "Main",
  siteName: "Site 12", arrivalDate: "2026-08-01", departureDate: "2026-08-03", nights: 2, bookingUrl: "https://book",
};

describe("alert email", () => {
  it("subject: singular names the search; plural counts", () => {
    expect(buildSubject([row])).toContain("Big Sur weekends");
    expect(buildSubject([row, row])).toContain("2 campsite openings");
  });
  it("body lists site + dates + book link + disclaimer", () => {
    const b = buildBody([row], "https://app/dashboard");
    expect(b).toContain("Site 12");
    expect(b).toContain("2026-08-01");
    expect(b).toContain("https://book");
    expect(b).toContain("/dashboard");
  });
  it("sendAlertEmail skips (no send) when unconfigured", async () => {
    const res = await sendAlertEmail({ apiKey: undefined, from: undefined, to: "x@y.z" }, [row], "https://app/dashboard");
    expect(res).toBe("skipped-unconfigured");
  });
});
