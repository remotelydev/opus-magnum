// Slows down password guessing: after too many failed logins from one address (or for one login),
// further attempts are refused for a while. Kept in memory: a restart clears it, which is fine for
// one process on the clinic's mini-PC.

export interface LoginLimiterOptions {
  /** Failed attempts allowed per window for one login from one address. */
  maxPerLogin?: number;
  /** Failed attempts allowed per window from one address, across all logins. */
  maxPerAddress?: number;
  windowMs?: number;
  now?: () => number;
}

export interface LoginLimiter {
  /** Seconds to wait before trying again, or 0 when an attempt is allowed. */
  retryAfter(address: string, login: string): number;
  fail(address: string, login: string): void;
  succeed(address: string, login: string): void;
}

export function createLoginLimiter(options: LoginLimiterOptions = {}): LoginLimiter {
  const maxPerLogin = options.maxPerLogin ?? 5;
  const maxPerAddress = options.maxPerAddress ?? 20;
  const windowMs = options.windowMs ?? 15 * 60_000;
  const now = options.now ?? Date.now;
  const failures = new Map<string, number[]>();

  const recent = (key: string) => {
    const cutoff = now() - windowMs;
    const list = (failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  };
  const keys = (address: string, login: string) => [`a|${address}`, `l|${address}|${login.toLowerCase()}`];

  return {
    retryAfter(address, login) {
      const [byAddress, byLogin] = keys(address, login).map(recent);
      const blocked = [
        byLogin.length >= maxPerLogin ? byLogin : null,
        byAddress.length >= maxPerAddress ? byAddress : null,
      ].filter((l): l is number[] => l !== null);
      if (!blocked.length) return 0;
      // Allowed again once the oldest failure in the full list leaves the window.
      const until = Math.max(...blocked.map((l) => l[0] + windowMs));
      return Math.max(1, Math.ceil((until - now()) / 1000));
    },
    fail(address, login) {
      for (const key of keys(address, login)) failures.set(key, [...recent(key), now()]);
    },
    succeed(address, login) {
      failures.delete(keys(address, login)[1]);
    },
  };
}
