import fs from 'fs';
import path from 'path';
// Use process.cwd() — Next.js sets this to the web/ directory, so ../data reaches repo root
import { TargetsConfigSchema } from '../../src/config/schemas';
import type { Target } from '../../src/config/schemas';

export type { Target };

export function loadTargets(): Target[] {
  const dataPath = path.join(process.cwd(), '..', 'data', 'targets.json');
  const raw = fs.readFileSync(dataPath, 'utf-8');
  return TargetsConfigSchema.parse(JSON.parse(raw)).targets;
}
