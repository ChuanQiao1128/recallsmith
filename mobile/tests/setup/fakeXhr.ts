// mobile/tests/setup/fakeXhr.ts
//
// A stand-in for the global XMLHttpRequest (vitest runs in node, which has none) for the anonymous
// card report tests (R28 ANONREPORT). Records every request exactly as it would leave the device:
// method, URL, headers, body and the Sentry "own request" flag. Each send settles on a later
// macrotask with the next queued outcome: an HTTP status, or 'offline' (onerror).

export type SentXhr = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  sentryOwnRequest: boolean;
  timeout: number;
};

export type XhrOutcome = number | 'offline';

export function installFakeXhr() {
  const sent: SentXhr[] = [];
  const outcomes: XhrOutcome[] = [];
  let fallback: XhrOutcome = 202;
  const saved = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;

  class FakeXhr {
    timeout = 0;
    status = 0;
    onload: ((ev: never) => unknown) | null = null;
    onerror: ((ev: never) => unknown) | null = null;
    ontimeout: ((ev: never) => unknown) | null = null;
    __sentry_own_request__?: boolean;
    private method = '';
    private url = '';
    private readonly headers: Record<string, string> = {};

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }

    send(body: string) {
      sent.push({
        method: this.method,
        url: this.url,
        headers: { ...this.headers },
        body,
        sentryOwnRequest: this.__sentry_own_request__ === true,
        timeout: this.timeout,
      });
      const outcome = outcomes.length > 0 ? outcomes.shift()! : fallback;
      setTimeout(() => {
        if (outcome === 'offline') {
          this.onerror?.(undefined as never);
          return;
        }
        this.status = outcome;
        this.onload?.(undefined as never);
      }, 0);
    }
  }

  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;

  return {
    sent,
    /** Outcomes for the next sends, in order; afterwards every send gets the fallback. */
    queue(...next: XhrOutcome[]) {
      outcomes.push(...next);
    },
    setFallback(outcome: XhrOutcome) {
      fallback = outcome;
    },
    restore() {
      (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = saved;
    },
  };
}
