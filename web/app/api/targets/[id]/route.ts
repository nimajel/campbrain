import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { TargetsConfigSchema } from '../../../../../src/config/schemas';
import type { Target } from '../../../../../src/config/schemas';

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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as unknown;
    const targets = readTargets();
    const idx = targets.findIndex((t) => t.id === id);

    if (idx === -1) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }

    const merged = typeof body === 'object' && body !== null ? { ...body as object, id } : { id };
    const updated = TargetsConfigSchema.shape.targets.element.parse(merged);
    targets[idx] = updated;
    writeTargets(targets);

    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const targets = readTargets();
    const idx = targets.findIndex((t) => t.id === id);

    if (idx === -1) {
      return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    }

    targets.splice(idx, 1);
    writeTargets(targets);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
