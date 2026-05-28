import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { TargetsConfigSchema } from '../../../../src/config/schemas';
import type { Target } from '../../../../src/config/schemas';

function dataPath(): string {
  return path.join(process.cwd(), '..', 'data', 'targets.json');
}

function readTargets(): Target[] {
  const raw = fs.readFileSync(dataPath(), 'utf-8');
  return TargetsConfigSchema.parse(JSON.parse(raw)).targets;
}

function writeTargets(targets: Target[]): void {
  fs.writeFileSync(dataPath(), JSON.stringify({ targets }, null, 2) + '\n', 'utf-8');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function GET() {
  try {
    const targets = readTargets();
    return NextResponse.json(targets);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;
    const targets = readTargets();

    // Parse and validate the new target
    const newTarget = TargetsConfigSchema.shape.targets.element.parse(body);

    // Generate id from name if not set or empty
    if (!newTarget.id) {
      (newTarget as { id: string }).id = slugify(newTarget.name) || `target-${Date.now()}`;
    }

    // Ensure id is unique
    if (targets.some((t) => t.id === newTarget.id)) {
      return NextResponse.json({ error: `Target with id "${newTarget.id}" already exists` }, { status: 409 });
    }

    targets.push(newTarget);
    writeTargets(targets);

    return NextResponse.json(newTarget, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
