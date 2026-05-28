import fs from 'fs';
import path from 'path';
import { TargetsConfigSchema, type Target } from './schemas.js';

export function loadTargets(): Target[] {
  const configPath = path.join(process.cwd(), 'data', 'targets.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(`Targets config not found at ${configPath}`);
  }

  const rawContent = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(rawContent);
  const validated = TargetsConfigSchema.parse(parsed);

  return validated.targets;
}

export function getTargetById(id: string): Target | undefined {
  const targets = loadTargets();
  return targets.find((t) => t.id === id);
}
