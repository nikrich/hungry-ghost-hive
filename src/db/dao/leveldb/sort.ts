export function compareIsoAsc(
  a: { created_at: string; id: string },
  b: { created_at: string; id: string }
): number {
  const byTime = a.created_at.localeCompare(b.created_at);
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

export function compareIsoDesc(
  a: { created_at: string; id: string },
  b: { created_at: string; id: string }
): number {
  const byTime = b.created_at.localeCompare(a.created_at);
  if (byTime !== 0) return byTime;
  return b.id.localeCompare(a.id);
}

export function compareIsoAscByTimestamp<T extends { timestamp: string; id: number }>(
  a: T,
  b: T
): number {
  const byTime = a.timestamp.localeCompare(b.timestamp);
  if (byTime !== 0) return byTime;
  return a.id - b.id;
}

export function compareIsoDescByTimestamp<T extends { timestamp: string; id: number }>(
  a: T,
  b: T
): number {
  const byTime = b.timestamp.localeCompare(a.timestamp);
  if (byTime !== 0) return byTime;
  return b.id - a.id;
}
