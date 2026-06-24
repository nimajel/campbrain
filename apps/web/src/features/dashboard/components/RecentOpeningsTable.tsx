import type { RecentOpening } from "@campbrain/types";
import { injectBookingDates } from "@/lib/booking-url";

interface Props {
  openings: RecentOpening[];
}

export function RecentOpeningsTable({ openings }: Props) {
  if (openings.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-xl border shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left">Park</th>
            <th className="px-3 py-2 text-left">Campground</th>
            <th className="px-3 py-2 text-left">Site</th>
            <th className="px-3 py-2 text-left">Arrival</th>
            <th className="px-3 py-2 text-left">Nights</th>
            <th className="px-3 py-2 text-left"></th>
          </tr>
        </thead>
        <tbody>
          {openings.map((o) => (
            <tr key={o.id} className="border-b last:border-0 hover:bg-muted/20">
              <td className="px-3 py-2 font-medium">{o.parkName}</td>
              <td className="px-3 py-2 text-muted-foreground">{o.campgroundName}</td>
              <td className="px-3 py-2 text-muted-foreground">{o.siteName}</td>
              <td className="px-3 py-2 tabular-nums">{o.arrivalDate}</td>
              <td className="px-3 py-2 tabular-nums">{o.nights}</td>
              <td className="px-3 py-2">
                {o.bookingUrl !== null ? (
                  <a
                    href={injectBookingDates(o.bookingUrl, o.arrivalDate, o.nights)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Book
                  </a>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
