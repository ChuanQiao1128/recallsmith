// src/features/automation/ModeBannerCallout.tsx
//
// The mode banner on every tab (A00 §16.1): configured and effective mode, why
// live is blocked, and the one sentence that says how the mode changes. It is
// text only: the mode has no switch on this page.
//
// ui/Callout has no neutral tone, so "off" shares the info colour with a dry
// run; the mode badge (OFF / DRY RUN / LIVE) in front of the lines keeps the
// three apart at a glance (B07 frontend-console-11).
import type { AutomationMode } from '../../api/automation';
import { Badge } from '../../components/ui/Badge';
import { Callout } from '../../components/ui/Callout';
import { modeBadge, modeBanner } from '../../lib/automationRules';

export function ModeBannerCallout({ mode }: { mode: AutomationMode }) {
  const banner = modeBanner(mode);
  const badge = modeBadge(mode.effective);
  const tone = banner.tone === 'neutral' ? 'info' : banner.tone;
  return (
    <div data-testid="automation-mode-banner">
      <Callout tone={tone} title={banner.title}>
        <div className="mb-1" data-testid="automation-mode-badge">
          <Badge tone={badge.tone}>{badge.text}</Badge>
        </div>
        <ul className="space-y-0.5">
          {banner.lines.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Callout>
    </div>
  );
}
