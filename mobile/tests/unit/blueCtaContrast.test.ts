import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { colors } from '../../src/theme/colors';
import { composite, contrastRatio } from '../helpers/contrast';

// Read the caller's real StyleSheet values, including pressed opacity. A token-only
// assertion would miss a screen keeping its old white foreground or a dimmed label.
function readStyle(file: string, name: string): Record<string, string | number> {
  const path = resolve(__dirname, '../../src', file);
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  let result: Record<string, string | number> | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'StyleSheet.create') {
      const sheet = node.arguments[0];
      if (ts.isObjectLiteralExpression(sheet)) {
        const entry = sheet.properties.find((property) => property.name?.getText(source) === name);
        if (entry && ts.isPropertyAssignment(entry) && ts.isObjectLiteralExpression(entry.initializer)) {
          result = {};
          for (const property of entry.initializer.properties) {
            if (!ts.isPropertyAssignment(property)) continue;
            const key = property.name.getText(source);
            if (!['color', 'backgroundColor', 'opacity'].includes(key)) continue;
            const value = property.initializer;
            if (ts.isStringLiteral(value)) result[key] = value.text;
            else if (ts.isNumericLiteral(value)) result[key] = Number(value.text);
            else if (ts.isPropertyAccessExpression(value) && value.expression.getText(source) === 'colors') {
              result[key] = colors[value.name.text as keyof typeof colors];
            } else throw new Error(`Unsupported contrast style ${file}/${name}/${key}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!result) throw new Error(`Missing StyleSheet style ${file}/${name}`);
  return result;
}

const callers = [
  ['screens/HomeScreen.tsx', 'primaryCta', 'primaryCtaText', 'pressed'],
  ['screens/HomeScreen.tsx', 'errorRetryPill', 'errorRetryText', 'pressed'],
  ['components/AppInfoScreen.tsx', 'primaryButton', 'primaryButtonText'],
  ['screens/WelcomeScreen.tsx', 'primaryButton', 'primaryButtonText', 'pressed'],
  ['screens/AudienceSurveyScreen.tsx', 'primaryButton', 'primaryButtonText', 'pressed'],
  ['screens/PermissionPromptScreen.tsx', 'primaryButton', 'primaryButtonText', 'pressed'],
  ['screens/SignInScreen.tsx', 'primaryBtn', 'primaryText', 'pressed'],
  ['screens/ForgotPasswordScreen.tsx', 'primaryBtn', 'primaryText', 'pressed'],
  ['screens/CardDetailScreen.tsx', 'primaryAction', 'primaryActionText', 'pressed'],
  ['screens/MistakeBookScreen.tsx', 'primaryAction', 'primaryActionText', 'pressed'],
  ['screens/DomainProgressScreen.tsx', 'practice', 'practiceText', 'pressed'],
  ['screens/SessionSummaryScreen.tsx', 'primaryButton', 'primaryButtonText', 'buttonPressed'],
  ['screens/SessionCardScreen.tsx', 'doneButton', 'doneButtonText', 'pressed'],
  ['screens/DrawScreen.tsx', 'primaryCta', 'primaryCtaText', 'pressed'],
  ['features/gacha/components/ReviewBody.tsx', 'flipButton', 'flipText', 'pressed'],
  ['features/gacha/components/LearningStudyView.tsx', 'gotIt', 'gotItText', 'pressed'],
  ['features/gacha/components/McqActionDock.tsx', 'primary', 'primaryLabel', 'pressed'],
  ['features/gacha/components/McqCoachLine.tsx', 'dismiss', 'dismissText', 'pressed'],
  ['features/gacha/components/drawResultStyles.ts', 'primaryCta', 'primaryCtaText', 'pressed'],
  ['features/gacha/library/libraryScreenStyles.ts', 'emptyCollectionBanner', 'emptyCollectionBannerEyebrow', 'pressed'],
  ['features/gacha/library/libraryScreenStyles.ts', 'emptyCollectionBanner', 'emptyCollectionBannerTitle', 'pressed'],
  ['features/gacha/library/libraryScreenStyles.ts', 'emptyCollectionBanner', 'emptyCollectionBannerArrow', 'pressed'],
  ['features/gacha/settings/feedback/FeedbackSection.tsx', 'pillOn', 'pillTextOn', 'pressed'],
  ['features/gacha/settings/study/CardLangRow.tsx', 'choiceOn', 'choiceTextOn', 'pressed'],
  ['features/gacha/home/HomePackCarousel.tsx', 'updateChip', 'updateChipText'],
  ['features/cardReport/ReportCardSheet.tsx', 'primary', 'primaryText', 'primaryPressed', colors.pokeBlueDeep],
];

describe('blue CTA caller text contrast', () => {
  it.each(callers)('%s %s / %s clears 4.5:1 in normal and pressed states', (file, backgroundName, textName, pressedName, expectedBackground) => {
    const background = readStyle(file, backgroundName);
    const text = readStyle(file, textName);
    const pressedOpacity = pressedName ? Number(readStyle(file, pressedName).opacity ?? 1) : 1;
    expect(background.backgroundColor).toBe(expectedBackground ?? colors.pokeBlue);
    // Include every light surface used under the fixed brand blue, including
    // the gradient endpoints. Compose the whole control, not only its fill.
    for (const backdrop of [colors.softCream, colors.softPeach, colors.softLavender, colors.softMist, colors.parchmentBg, colors.parchmentBgDeep, '#FFFFFF']) {
      for (const opacity of [1, pressedOpacity]) {
        const visibleBackground = composite(String(background.backgroundColor), backdrop, opacity);
        const localForeground = composite(String(text.color), String(background.backgroundColor), Number(text.opacity ?? 1));
        const visibleForeground = composite(localForeground, backdrop, opacity);
        expect(contrastRatio(visibleForeground, visibleBackground), `${file}/${textName}/${opacity}/${backdrop}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('preserves the white foreground on the darker updating chip', () => {
    const file = 'features/gacha/home/HomePackCarousel.tsx';
    const background = readStyle(file, 'updateChipUpdating');
    const text = readStyle(file, 'updateChipTextUpdating');
    expect(contrastRatio(String(text.color), String(background.backgroundColor))).toBeGreaterThanOrEqual(4.5);
    expect(readFileSync(resolve(__dirname, '../../src', file), 'utf8')).toContain("page.realRow.update.state === 'updating' && styles.updateChipTextUpdating");
  });
});
