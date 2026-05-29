import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { TargetSchema, TargetsConfigSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Alert schema — extends Target with alert-specific fields
// ---------------------------------------------------------------------------

export const AlertSchema = TargetSchema.extend({
  enabled: z.boolean().default(true),
  emailEnabled: z.boolean().default(true),
  calendarEnabled: z.boolean().default(false),
  scanIntervalMinutes: z.number().int().positive().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).refine(
  (a) => a.acceptableSites.length >= 1,
  { message: 'At least one acceptable site is required' }
).refine(
  (a) => a.maxNights >= a.minNights,
  { message: 'maxNights must be greater than or equal to minNights' }
);

export type Alert = z.infer<typeof AlertSchema>;

const AlertsConfigSchema = z.object({
  targets: z.array(AlertSchema),
});

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function dataPath(): string {
  return path.join(process.cwd(), 'data', 'targets.json');
}

function readRaw(): object[] {
  const p = dataPath();
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown;
    const validated = TargetsConfigSchema.parse(parsed);
    return validated.targets as object[];
  } catch {
    return [];
  }
}

function readRawAll(): object[] {
  const p = dataPath();
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as { targets?: unknown[] };
    return Array.isArray(parsed.targets) ? (parsed.targets as object[]) : [];
  } catch {
    return [];
  }
}

function write(alerts: Alert[]): void {
  const p = dataPath();
  fs.writeFileSync(p, JSON.stringify({ targets: alerts }, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function listAlerts(): Alert[] {
  const raw = readRawAll();
  const result: Alert[] = [];
  for (const item of raw) {
    const parsed = AlertSchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
}

export function getAlert(id: string): Alert | undefined {
  return listAlerts().find((a) => a.id === id);
}

export function createAlert(data: unknown): Alert {
  const parsed = AlertSchema.parse(data);
  const existing = listAlerts();

  if (existing.some((a) => a.id === parsed.id)) {
    throw new Error(`Alert with id "${parsed.id}" already exists`);
  }

  const now = new Date().toISOString();
  const alert: Alert = {
    ...parsed,
    createdAt: now,
    updatedAt: now,
  };

  write([...existing, alert]);
  return alert;
}

export function updateAlert(id: string, data: unknown): Alert {
  const existing = listAlerts();
  const idx = existing.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error(`Alert "${id}" not found`);

  const merged = { ...existing[idx], ...(data as object), id };
  const parsed = AlertSchema.parse(merged);
  const updated: Alert = { ...parsed, updatedAt: new Date().toISOString() };

  const next = [...existing];
  next[idx] = updated;
  write(next);
  return updated;
}

export function deleteAlert(id: string): void {
  const existing = listAlerts();
  if (!existing.some((a) => a.id === id)) {
    throw new Error(`Alert "${id}" not found`);
  }
  write(existing.filter((a) => a.id !== id));
}

export function enableAlert(id: string): Alert {
  return updateAlert(id, { enabled: true });
}

export function disableAlert(id: string): Alert {
  return updateAlert(id, { enabled: false });
}

// ---------------------------------------------------------------------------
// Convenience filter helpers
// ---------------------------------------------------------------------------

export function activeAlerts(): Alert[] {
  return listAlerts().filter((a) => a.enabled);
}

export function calendarAlerts(): Alert[] {
  return listAlerts().filter((a) => a.calendarEnabled);
}

// ---------------------------------------------------------------------------
// Validation helper (for API use)
// ---------------------------------------------------------------------------

export function validateAlertInput(data: unknown): Alert {
  return AlertSchema.parse(data);
}
