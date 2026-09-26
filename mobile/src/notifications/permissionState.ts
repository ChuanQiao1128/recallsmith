// mobile/src/notifications/permissionState.ts
//
// Pure permission-state mapping, deliberately free of any expo-notifications /
// react-native import: PermissionPromptScreen loads this synchronously, and
// several screen tests (and DrawResultScreen) import that screen without an
// expo-notifications mock. Keeping this module dependency-free means those
// imports never touch the native module.

export type NotificationPermissionState = 'granted' | 'denied' | 'undetermined';

/**
 * Normalize an expo-notifications permission response into a tri-state value.
 *
 * Fixes MACCT-09: the old `res?.status ?? res?.granted ? 'granted' : …`
 * expression let `??` bind tighter than `?:`, so any non-empty status
 * (including `'denied'`) collapsed to `'granted'`.
 *
 * - `'granted'` when `res.granted === true` or `res.status === 'granted'`.
 * - `'denied'` when `res.status === 'denied'`.
 * - otherwise (including `null`, `undefined`, non-objects) `'undetermined'`.
 */
export function mapPermissionResponse(res: unknown): NotificationPermissionState {
  if (!res || typeof res !== 'object') return 'undetermined';
  const obj = res as { status?: unknown; granted?: unknown };
  if (obj.granted === true || obj.status === 'granted') return 'granted';
  if (obj.status === 'denied') return 'denied';
  return 'undetermined';
}
