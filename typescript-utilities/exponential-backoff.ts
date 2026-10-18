export interface BackoffOptions {
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio?: number;
}

export function delayForAttempt(
  attempt: number,
  options: BackoffOptions,
  random: () => number = Math.random,
): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError("attempt must be a non-negative integer");
  }
  if (options.baseDelayMs < 0 || options.maxDelayMs < options.baseDelayMs) {
    throw new RangeError("invalid delay bounds");
  }
  const jitter = options.jitterRatio ?? 0;
  if (jitter < 0 || jitter > 1) {
    throw new RangeError("jitterRatio must be between 0 and 1");
  }
  const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
  const spread = exponential * jitter;
  const offset = (random() * 2 - 1) * spread;
  return Math.max(0, Math.min(options.maxDelayMs, exponential + offset));
}

export function retryDelays(
  attempts: number,
  options: BackoffOptions,
  random?: () => number,
): number[] {
  if (!Number.isInteger(attempts) || attempts < 0) {
    throw new RangeError("attempts must be a non-negative integer");
  }
  return Array.from({ length: attempts }, (_, attempt) =>
    delayForAttempt(attempt, options, random),
  );
}
