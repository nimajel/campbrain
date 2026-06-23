import dayjs from "dayjs";
import { weekendArrivals } from "../rules/weekend-arrivals";
import type { SavedSearch } from "@campbrain/types";

export interface StayWindow {
  from: string;   // YYYY-MM-DD arrival
  to: string;     // YYYY-MM-DD departure (arrival + nights)
  nights: number;
}

export function expandStayWindows(search: SavedSearch, today: string): StayWindow[] {
  const { datePattern, filters } = search;
  const minNights = filters.minNights;

  if (datePattern.kind === "fixed_range") {
    const { from, to } = datePattern;
    const windows: StayWindow[] = [];
    let arrival = dayjs(from);
    const lastArrival = dayjs(to).subtract(minNights, "day");
    while (!arrival.isAfter(lastArrival)) {
      windows.push({
        from: arrival.format("YYYY-MM-DD"),
        to: arrival.add(minNights, "day").format("YYYY-MM-DD"),
        nights: minNights,
      });
      arrival = arrival.add(1, "day");
    }
    return windows;
  }

  const arrivals = weekendArrivals(today, datePattern.horizonDays, minNights);
  return arrivals.map((a) => ({
    from: a.arrivalDate,
    to: dayjs(a.arrivalDate).add(a.nights, "day").format("YYYY-MM-DD"),
    nights: a.nights,
  }));
}

/** Inclusive arrival to exclusive departure date list (the nights occupied). */
export function stayDates(window: StayWindow): string[] {
  const dates: string[] = [];
  let cur = dayjs(window.from);
  const last = dayjs(window.to).subtract(1, "day");
  while (!cur.isAfter(last)) {
    dates.push(cur.format("YYYY-MM-DD"));
    cur = cur.add(1, "day");
  }
  return dates;
}
