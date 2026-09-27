// src/features/automation/ModeBannerCallout.tsx
//
// The mode banner on every tab (A00 §16.1): configured and effective mode, why
// live is blocked, and the one sentence that says how the mode changes. It is
// text only: the mode has no switch on this page.
import type { AutomationMode } from '../../api/automation';
import { Callout } from '../../components/ui/Callout';
import { modeBanner } from '../../lib/automationRules';

export function ModeBannerCallout({ mode }: { mode: AutomationMode }) {
  const banner = modeBanner(mode);
  // ui/Callout has no neutral tone; "off" reads as plain information.
  const tone = banner.tone === 'neutral' ? 'info' : banner.tone;
  return (
    <div data-testid="automation-mode-banner">
      <Callout tone={tone} title={banner.title}>
        <ul className="space-y-0.5">
          {banner.lines.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </Callout>
    </div>
  );
}
