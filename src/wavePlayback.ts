export type WaveClock = { epoch: number; count: number };
// Display only received samples; never extrapolate the signal through a network gap.
export function advanceHead(head: number | null, count: number, rate: number, dt: number) {
  const target = Math.max(0, count - rate * 0.12);
  if (head === null || head > count || target - head > rate * 0.5) return target;
  const speed = rate * (1 + Math.max(-0.1, Math.min(0.1, (target - head) / rate)));
  return Math.min(count, Math.max(head, head + Math.max(0, Math.min(dt, 0.1)) * speed));
}
