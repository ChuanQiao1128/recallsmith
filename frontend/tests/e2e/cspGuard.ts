// The Playwright `test` every smoke spec uses: Playwright's own, plus one
// automatic fixture that fails a test when the browser reports a
// Content-Security-Policy violation on its page.
//
// The smoke runs the built bundle behind scripts/serve-with-headers.mjs, which
// sends the production security headers from
// infra/modules/edge/security_headers.json (the CloudFront response headers
// policy of console.developercards.app, infra/RUNBOOK.md §16). The CSP is
// enforced there, so a violation here is something the live console would not
// be able to do: a script, style, font or request the policy does not allow.
//
// The listener is installed before any page script runs (addInitScript goes in
// through the DevTools protocol, which the page's CSP does not govern) and
// writes one console line per `securitypolicyviolation` event; Chromium's own
// "Refused to ..." console errors are counted too.

import { expect, test as base } from '@playwright/test';

export const CSP_VIOLATION_PREFIX = '[csp-violation]';

export const test = base.extend<{ cspViolations: string[] }>({
  cspViolations: [
    async ({ page }, use) => {
      const violations: string[] = [];
      await page.addInitScript(prefix => {
        document.addEventListener(
          'securitypolicyviolation',
          event => {
            console.error(
              `${prefix} ${event.effectiveDirective} blocked ${event.blockedURI || '(inline)'} ` +
                `(${event.disposition}) at ${event.sourceFile || event.documentURI}:${event.lineNumber}`,
            );
          },
          true,
        );
      }, CSP_VIOLATION_PREFIX);
      page.on('console', message => {
        const text = message.text();
        if (text.startsWith(CSP_VIOLATION_PREFIX) || text.includes('Content Security Policy')) violations.push(text);
      });

      await use(violations);

      expect(violations, 'Content-Security-Policy violations reported by the browser').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
