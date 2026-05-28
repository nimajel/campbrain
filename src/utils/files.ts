import fs from 'fs';
import path from 'path';

export function ensureDebugDir(): string {
  const debugDir = path.join(process.cwd(), '.campbrain', 'debug');
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }
  return debugDir;
}

export function saveDebugHtml(
  targetId: string,
  arrivalDate: string,
  nights: number,
  html: string
): string {
  const debugDir = ensureDebugDir();
  const filename = `${targetId}-${arrivalDate}-${nights}n.html`;
  const filepath = path.join(debugDir, filename);
  fs.writeFileSync(filepath, html, 'utf-8');
  return filepath;
}
