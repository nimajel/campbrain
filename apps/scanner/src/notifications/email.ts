export interface AlertEmailRow {
  searchName: string;
  parkName: string;
  campgroundName: string;
  siteName: string;
  arrivalDate: string;
  departureDate: string;
  nights: number;
  bookingUrl: string | null;
}

export type DeliveryResult = "delivered" | "skipped-unconfigured" | "failed";

export function buildSubject(rows: AlertEmailRow[]): string {
  return rows.length === 1
    ? `CampBrain: campsite opening found – ${rows[0]!.searchName}`
    : `CampBrain: ${rows.length} campsite openings found`;
}

export function buildBody(rows: AlertEmailRow[], dashboardUrl: string): string {
  const lines: string[] = ["CampBrain found new campsite availability.\n"];
  for (const r of rows) {
    lines.push(`Alert:      ${r.searchName}`);
    lines.push(`Park:       ${r.parkName}`);
    lines.push(`Campground: ${r.campgroundName}`);
    lines.push(`Site:       ${r.siteName}`);
    lines.push(`Arrival:    ${r.arrivalDate}`);
    lines.push(`Departure:  ${r.departureDate} (${r.nights} night${r.nights !== 1 ? "s" : ""})`);
    if (r.bookingUrl) lines.push(`Book:       ${r.bookingUrl}`);
    lines.push("");
  }
  lines.push("⚠️  Availability can disappear quickly. Complete your booking manually on the official reservation site.");
  lines.push(`Manage your alerts: ${dashboardUrl}`);
  return lines.join("\n");
}

export interface EmailConfig {
  apiKey: string | undefined;
  from: string | undefined;
  to: string;
}

export async function sendAlertEmail(
  cfg: EmailConfig,
  rows: AlertEmailRow[],
  dashboardUrl: string,
): Promise<DeliveryResult> {
  if (rows.length === 0) return "delivered";
  if (!cfg.apiKey || !cfg.from) {
    console.log("📧 Email skipped: RESEND_API_KEY and ALERT_EMAIL_FROM must be set.");
    return "skipped-unconfigured";
  }
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(cfg.apiKey);
    const { error } = await resend.emails.send({
      from: cfg.from,
      to: cfg.to,
      subject: buildSubject(rows),
      text: buildBody(rows, dashboardUrl),
    });
    if (error) {
      console.error(`📧 Email send failed: ${error.message}`);
      return "failed";
    }
    console.log(`📧 Alert email sent to ${cfg.to}`);
    return "delivered";
  } catch (err: unknown) {
    console.error(`📧 Email send failed: ${String(err)}`);
    return "failed";
  }
}
