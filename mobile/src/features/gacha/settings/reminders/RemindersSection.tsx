import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReminderPrefs, NotificationPermissionState } from '../../../../notifications/reminders';
import { colors } from '../../../../theme/colors';
import { spacing } from '../../../../theme/spacing';
import { typography } from '../../../../theme/typography';

export const REMINDERS_COPY = {
  title: 'Reminders',
  body: 'A daily morning reminder at the time you pick, plus an optional evening check-in that only fires while cards are still due.',
  permissionGranted: 'Notifications are on for DeveloperCards.',
  permissionUndetermined: 'Reminders are off. Turn them on to get a daily nudge.',
  permissionDenied: 'Notifications are blocked in iOS Settings.',
  turnOn: 'Turn on reminders',
  openSettings: 'Open iOS Settings',
  morningLabel: 'Morning reminder',
  eveningLabel: 'Evening check-in',
  eveningHint: 'Only when cards are still due',
} as const;

export const MORNING_TIME_PRESETS = ['07:00', '08:00', '09:00'] as const;
export const EVENING_TIME_PRESETS = ['19:00', '20:00', '21:00'] as const;

type Props = {
  permission: NotificationPermissionState | 'unknown';
  prefs: ReminderPrefs;
  busy?: boolean;
  onTurnOn(): void;
  onOpenSettings(): void;
  onToggleMorning(enabled: boolean): void;
  onToggleEvening(enabled: boolean): void;
  onSelectMorningTime(time: string): void;
  onSelectEveningTime(time: string): void;
};

function statusText(permission: Props['permission']): string {
  switch (permission) {
    case 'granted':
      return REMINDERS_COPY.permissionGranted;
    case 'denied':
      return REMINDERS_COPY.permissionDenied;
    default:
      return REMINDERS_COPY.permissionUndetermined;
  }
}

function ToggleRow(props: {
  testID: string;
  label: string;
  hint?: string;
  enabled: boolean;
  onToggle(enabled: boolean): void;
}) {
  const { testID, label, hint, enabled, onToggle } = props;
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        {hint ? (
          <Text style={styles.rowHint} numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Pressable
        testID={testID}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        style={({ pressed }) => [styles.toggle, enabled && styles.toggleOn, pressed && styles.pressed]}
        onPress={() => onToggle(!enabled)}
      >
        <Text style={styles.toggleText} numberOfLines={1}>
          {enabled ? 'On' : 'Off'}
        </Text>
      </Pressable>
    </View>
  );
}

function TimeChips(props: {
  slot: 'morning' | 'evening';
  presets: readonly string[];
  selected: string;
  onSelect(time: string): void;
}) {
  const { slot, presets, selected, onSelect } = props;
  return (
    <View style={styles.chipRow}>
      {presets.map((t) => {
        const isSelected = t === selected;
        return (
          <Pressable
            key={t}
            testID={`settings-reminders-${slot}-time-${t.replace(':', '')}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            style={({ pressed }) => [styles.chip, isSelected && styles.chipSelected, pressed && styles.pressed]}
            onPress={() => onSelect(t)}
          >
            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]} numberOfLines={1}>
              {t}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function RemindersSection(props: Props) {
  const {
    permission,
    prefs,
    busy,
    onTurnOn,
    onOpenSettings,
    onToggleMorning,
    onToggleEvening,
    onSelectMorningTime,
    onSelectEveningTime,
  } = props;

  const showTurnOn = permission === 'undetermined' || permission === 'unknown';
  const showOpenSettings = permission === 'denied';
  const showControls = permission === 'granted';

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {REMINDERS_COPY.title}
      </Text>
      <Text style={styles.sectionBody}>{REMINDERS_COPY.body}</Text>

      <Text style={styles.metaLine} testID="settings-reminders-permission">
        {statusText(permission)}
      </Text>

      {showTurnOn ? (
        <Pressable
          testID="settings-reminders-turn-on"
          disabled={busy}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}
          onPress={onTurnOn}
        >
          <Text style={styles.primaryButtonText} numberOfLines={1}>
            {REMINDERS_COPY.turnOn}
          </Text>
        </Pressable>
      ) : null}

      {showOpenSettings ? (
        <Pressable
          testID="settings-reminders-open-settings"
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={onOpenSettings}
        >
          <Text style={styles.secondaryButtonText} numberOfLines={1}>
            {REMINDERS_COPY.openSettings}
          </Text>
        </Pressable>
      ) : null}

      {showControls ? (
        <View style={styles.controls}>
          <ToggleRow
            testID="settings-reminders-morning-toggle"
            label={REMINDERS_COPY.morningLabel}
            enabled={prefs.morningEnabled}
            onToggle={onToggleMorning}
          />
          {prefs.morningEnabled ? (
            <TimeChips
              slot="morning"
              presets={MORNING_TIME_PRESETS}
              selected={prefs.morningTime}
              onSelect={onSelectMorningTime}
            />
          ) : null}

          <ToggleRow
            testID="settings-reminders-evening-toggle"
            label={REMINDERS_COPY.eveningLabel}
            hint={REMINDERS_COPY.eveningHint}
            enabled={prefs.eveningEnabled}
            onToggle={onToggleEvening}
          />
          {prefs.eveningEnabled ? (
            <TimeChips
              slot="evening"
              presets={EVENING_TIME_PRESETS}
              selected={prefs.eveningTime}
              onSelect={onSelectEveningTime}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default RemindersSection;

const styles = StyleSheet.create({
  sectionCard: {
    marginTop: spacing.sm,
    borderRadius: spacing.cardRadius,
    padding: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.12)',
  },
  sectionTitle: {
    fontSize: typography.body,
    fontWeight: '800',
    color: colors.ink,
  },
  sectionBody: {
    marginTop: 4,
    fontSize: typography.bodySmall,
    color: colors.inkSecondary,
  },
  metaLine: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: colors.inkSecondary,
    lineHeight: 17,
  },
  controls: {
    marginTop: spacing.sm,
  },
  row: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabelWrap: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  rowLabel: {
    fontSize: typography.bodySmall,
    fontWeight: '700',
    color: colors.ink,
  },
  rowHint: {
    marginTop: 2,
    fontSize: typography.caption,
    color: colors.inkSecondary,
  },
  toggle: {
    minHeight: 32,
    minWidth: 56,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  toggleText: {
    fontSize: typography.caption,
    fontWeight: '800',
    color: colors.ink,
  },
  chipRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
  },
  chip: {
    marginRight: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  chipText: {
    fontSize: typography.caption,
    fontWeight: '700',
    color: colors.ink,
  },
  chipTextSelected: {
    color: colors.parchmentBg,
  },
  primaryButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.parchmentBg,
    fontSize: typography.button,
    fontWeight: '800',
  },
  secondaryButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: spacing.buttonRadius,
    borderWidth: 1,
    borderColor: 'rgba(42,34,24,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: typography.button,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.9,
  },
});
