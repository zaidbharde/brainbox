export type RetryDecision = { attempt: number; delayMs: number };

export function retrySchedule(attempts: number, baseDelayMs: number, maxDelayMs: number): RetryDecision[] {
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError('attempts must be positive');
  if (baseDelayMs < 0 || maxDelayMs < baseDelayMs) throw new RangeError('invalid delay bounds');
  return Array.from({ length: attempts }, (_, index) => ({
    attempt: index + 1,
    delayMs: Math.min(maxDelayMs, baseDelayMs * 2 ** index),
  }));
}
