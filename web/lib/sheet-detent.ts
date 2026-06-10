export type SheetDetent = 'peek' | 'half' | 'full';

const ORDER: SheetDetent[] = ['peek', 'half', 'full'];

export function cycleDetent(current: SheetDetent): SheetDetent {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
}
