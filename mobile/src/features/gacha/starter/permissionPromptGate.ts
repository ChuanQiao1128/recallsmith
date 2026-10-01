import AsyncStorage from '@react-native-async-storage/async-storage';

// One-shot gate: completing the starter lesson (starterLesson.ts) marks it; the first DrawResult the
// user leaves via "Done" consumes it and pushes PermissionPrompt. Existing users (flag never set) are
// never prompted again. Lives here rather than in PermissionPromptScreen so the lesson can arm it
// without importing a screen; the screen re-exports these for its existing callers.
export const PERMISSION_PROMPT_PENDING_KEY = 'notifications:permission-prompt:pending:v1';

export async function markPermissionPromptPending(): Promise<void> {
  try { await AsyncStorage.setItem(PERMISSION_PROMPT_PENDING_KEY, '1'); } catch {}
}

export async function isPermissionPromptPending(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(PERMISSION_PROMPT_PENDING_KEY)) === '1'; } catch { return false; }
}

export async function clearPermissionPromptPending(): Promise<void> {
  try { await AsyncStorage.removeItem(PERMISSION_PROMPT_PENDING_KEY); } catch {}
}
