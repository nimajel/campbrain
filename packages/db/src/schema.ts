import {
  pgTable, text, serial, integer, boolean, date, timestamp, numeric, jsonb,
  doublePrecision, primaryKey, foreignKey, unique, index, uniqueIndex, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const providers = pgTable("providers", {
  providerId: text("provider_id").primaryKey(),
  displayName: text("display_name").notNull(),
  baseUrl: text("base_url"),
});

export const parks = pgTable("parks", {
  providerId: text("provider_id").notNull().references(() => providers.providerId),
  parkPageId: text("park_page_id").notNull(),
  parkName: text("park_name").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
}, (t) => [primaryKey({ columns: [t.providerId, t.parkPageId] })]);

export const campgrounds = pgTable("campgrounds", {
  providerId: text("provider_id").notNull(),
  parkPageId: text("park_page_id").notNull(),
  campgroundName: text("campground_name").notNull(),
  campgroundId: text("campground_id").notNull(),
  nightlyFee: numeric("nightly_fee", { precision: 8, scale: 2 }),
  bookingUrl: text("booking_url"),
}, (t) => [
  primaryKey({ columns: [t.providerId, t.parkPageId, t.campgroundName] }),
  foreignKey({ columns: [t.providerId, t.parkPageId], foreignColumns: [parks.providerId, parks.parkPageId] }),
]);

export const sites = pgTable("sites", {
  siteId: serial("site_id").primaryKey(),
  providerId: text("provider_id").notNull(),
  parkPageId: text("park_page_id").notNull(),
  campgroundName: text("campground_name").notNull(),
  siteName: text("site_name").notNull(),
  access: text("access").notNull().default("drive_in"),
  siteKind: text("site_kind"),
  isGroup: boolean("is_group").notNull().default(false),
  isEquestrian: boolean("is_equestrian").notNull().default(false),
  isWalkUp: boolean("is_walk_up").notNull().default(false),
  isDayUse: boolean("is_day_use").notNull().default(false),
}, (t) => [
  unique().on(t.providerId, t.parkPageId, t.campgroundName, t.siteName),
  foreignKey({
    columns: [t.providerId, t.parkPageId, t.campgroundName],
    foreignColumns: [campgrounds.providerId, campgrounds.parkPageId, campgrounds.campgroundName],
  }),
  index("idx_sites_park").on(t.providerId, t.parkPageId),
]);

export const scanWindows = pgTable("scan_windows", {
  providerId: text("provider_id").notNull(),
  parkPageId: text("park_page_id").notNull(),
  windowStart: date("window_start").notNull(),
  windowEnd: date("window_end").notNull(),
  scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull(),
  sourceUrl: text("source_url").notNull(),
}, (t) => [
  primaryKey({ columns: [t.providerId, t.parkPageId, t.windowStart] }),
  foreignKey({ columns: [t.providerId, t.parkPageId], foreignColumns: [parks.providerId, parks.parkPageId] }),
  index("idx_scan_windows_end").on(t.windowEnd),
]);

export const availability = pgTable("availability", {
  siteId: integer("site_id").notNull().references(() => sites.siteId, { onDelete: "cascade" }),
  date: date("date").notNull(),
  status: text("status").notNull(),
}, (t) => [
  primaryKey({ columns: [t.siteId, t.date] }),
  index("idx_availability_date").on(t.date),
  index("idx_availability_available").on(t.date).where(sql`status = 'available'`),
  check("availability_status_check", sql`status IN ('available', 'unknown')`),
]);

export const savedSearches = pgTable("saved_searches", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  provider: text("provider").notNull().default("california-parks").references(() => providers.providerId),
  name: text("name").notNull(),
  definition: jsonb("definition").notNull(),
  alertEnabled: boolean("alert_enabled").notNull().default(false),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_saved_searches_user").on(t.userId),
  index("idx_saved_searches_alert_enabled").on(t.alertEnabled).where(sql`alert_enabled = true`),
]);

export const accessAllowlist = pgTable("access_allowlist", {
  email: text("email").primaryKey(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hits = pgTable("hits", {
  id: text("id").primaryKey(),
  savedSearchId: text("saved_search_id").notNull()
    .references(() => savedSearches.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  parkPageId: text("park_page_id").notNull(),
  parkName: text("park_name").notNull(),
  campgroundName: text("campground_name").notNull(),
  siteName: text("site_name").notNull(),
  arrivalDate: date("arrival_date").notNull(),
  nights: integer("nights").notNull(),
  bookingUrl: text("booking_url"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  disappearedAt: timestamp("disappeared_at", { withTimezone: true }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("uq_hits_opening").on(t.savedSearchId, t.parkPageId, t.campgroundName, t.siteName, t.arrivalDate),
  index("idx_hits_user").on(t.userId),
  index("idx_hits_unnotified").on(t.savedSearchId).where(sql`notified_at IS NULL`),
]);

export const scanRuns = pgTable("scan_runs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(),
  searchesScanned: integer("searches_scanned"),
  hitsNew: integer("hits_new"),
  hitsCurrent: integer("hits_current"),
  emailsSent: integer("emails_sent"),
  parksScanned: integer("parks_scanned"),
  errors: integer("errors"),
});

export const targets = pgTable("targets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  definition: jsonb("definition").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  calendarEnabled: boolean("calendar_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_targets_user").on(t.userId),
]);

export const calendarConnections = pgTable("calendar_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_calendar_conn_user_provider").on(t.userId, t.providerId),
]);

export const parkDigests = pgTable("park_digests", {
  provider: text("provider").notNull().references(() => providers.providerId),
  parkPageId: text("park_page_id").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }), // max scannedAt across windows; null when no windows
  digest: jsonb("digest").notNull(), // the unfiltered ParkAvailabilityResponse
  siteClass: jsonb("site_class").notNull(), // Record<siteName, SiteClassEntry>; day-use omitted
  builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.provider, t.parkPageId] }),
  foreignKey({
    columns: [t.provider, t.parkPageId],
    foreignColumns: [parks.providerId, parks.parkPageId],
  }).onDelete("cascade"),
]);

export const calendarSyncState = pgTable("calendar_sync_state", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  targetId: text("target_id").notNull().references(() => targets.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  googleEventId: text("google_event_id").notNull(),
  summary: text("summary").notNull(),
  startTimeIso: text("start_time_iso").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_calendar_sync_user_key").on(t.userId, t.key),
]);
