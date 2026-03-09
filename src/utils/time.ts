export function nowIso(): string {
  return new Date().toISOString();
}

export function daysBetween(oldIso: string | null, now: Date = new Date()): number {
  if (!oldIso) return 0;
  const old = new Date(oldIso).getTime();
  const diff = now.getTime() - old;
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}
