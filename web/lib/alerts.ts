import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { AlertSchema } from '../../src/config/alerts';
import type { Alert } from '../../src/config/alerts';

// Web-layer path helper: process.cwd() is web/ in Next.js
function dataPath(): string {
  return path.join(process.cwd(), '..', 'data', 'targets.json');
}

function readRaw(): object[] {
  const p = dataPath();
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as { targets?: unknown[] };
    return Array.isArray(parsed.targets) ? (parsed.targets as object[]) : [];
  } catch {
    return [];
  }
}

function writeAlerts(alerts: Alert[]): void {
  const p = dataPath();
  fs.writeFileSync(p, JSON.stringify({ targets: alerts }, null, 2) + '\n', 'utf-8');
}

export function listAlertsWeb(): Alert[] {
  const raw = readRaw();
  const result: Alert[] = [];
  for (const item of raw) {
    const parsed = AlertSchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
  }
  return result;
}

export function getAlertWeb(id: string): Alert | undefined {
  return listAlertsWeb().find((a) => a.id === id);
}

export function createAlertWeb(data: unknown): Alert {
  const parsed = AlertSchema.parse(data);
  const existing = listAlertsWeb();

  if (existing.some((a) => a.id === parsed.id)) {
    throw new Error(`Alert with id "${parsed.id}" already exists`);
  }

  const now = new Date().toISOString();
  const alert: Alert = { ...parsed, createdAt: now, updatedAt: now };
  writeAlerts([...existing, alert]);
  return alert;
}

export function updateAlertWeb(id: string, data: unknown): Alert {
  const existing = listAlertsWeb();
  const idx = existing.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error(`Alert "${id}" not found`);

  const merged = { ...existing[idx], ...(data as object), id };
  const parsed = AlertSchema.parse(merged);
  const updated: Alert = { ...parsed, updatedAt: new Date().toISOString() };

  const next = [...existing];
  next[idx] = updated;
  writeAlerts(next);
  return updated;
}

export function deleteAlertWeb(id: string): void {
  const existing = listAlertsWeb();
  if (!existing.some((a) => a.id === id)) {
    throw new Error(`Alert "${id}" not found`);
  }
  writeAlerts(existing.filter((a) => a.id !== id));
}

export function enableAlertWeb(id: string): Alert {
  return updateAlertWeb(id, { enabled: true });
}

export function disableAlertWeb(id: string): Alert {
  return updateAlertWeb(id, { enabled: false });
}

// Re-export type
export type { Alert };
