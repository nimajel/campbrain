import { NextResponse } from 'next/server';
import path from 'path';
import { getSetupStatus } from '../../../../src/status/setup-status';

export async function GET() {
  try {
    // In Next.js, process.cwd() is the web/ directory — adjust paths to project root
    const projectRoot = path.join(process.cwd(), '..');
    const status = getSetupStatus({
      stateDir: path.join(projectRoot, '.campbrain', 'state'),
      tokenPath: path.join(projectRoot, '.campbrain', 'google-token.json'),
      dataDir: path.join(projectRoot, 'data'),
    });
    return NextResponse.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
