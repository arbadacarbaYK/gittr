/**
 * Count in-flight multi-source file HTTP so Amber bunker dials can wait
 * for browser socket budget instead of landing CLOSED.
 */
let inflight = 0;
const waiters: Array<() => void> = [];

export function noteGitSourceHttpStart(): void {
  inflight += 1;
}

export function noteGitSourceHttpEnd(): void {
  inflight = Math.max(0, inflight - 1);
  if (inflight === 0) {
    const pending = waiters.splice(0);
    for (const w of pending) w();
  }
}

export function gitSourceHttpInflight(): number {
  return inflight;
}

export function waitForGitSourceHttpIdle(maxMs = 5000): Promise<void> {
  if (inflight <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => resolve();
    const timer = setTimeout(() => {
      const i = waiters.indexOf(finish);
      if (i >= 0) waiters.splice(i, 1);
      resolve();
    }, maxMs);
    const wrapped = () => {
      clearTimeout(timer);
      finish();
    };
    waiters.push(wrapped);
  });
}
