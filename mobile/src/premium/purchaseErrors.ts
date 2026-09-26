// mobile/src/premium/purchaseErrors.ts
//
// Pure classification of RevenueCat purchase/restore errors into friendly copy.
// Intentionally has NO import of react-native-purchases: we compare the SDK's
// string error codes directly so this stays OTA-safe and unit-testable in node.
//
// RevenueCat error codes (strings), from
// @revenuecat/purchases-typescript-internal/dist/errors.d.ts:
//   PURCHASE_CANCELLED_ERROR = "1"
//   STORE_PROBLEM_ERROR = "2"
//   PURCHASE_NOT_ALLOWED_ERROR = "3"
//   PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR = "5"
//   PRODUCT_ALREADY_PURCHASED_ERROR = "6"
//   NETWORK_ERROR = "10"
//   PAYMENT_PENDING_ERROR = "20"
//   PRODUCT_REQUEST_TIMED_OUT_ERROR = "32"
//   OFFLINE_CONNECTION_ERROR = "35"

export type PurchaseErrorKind =
  | 'cancelled'
  | 'pending'
  | 'network'
  | 'already_owned'
  | 'store'
  | 'unknown';

function errorCode(err: unknown): string | null {
  const code = (err as any)?.code;
  if (code == null) return null;
  return String(code).trim();
}

function errorMessage(err: unknown): string {
  const msg = (err as any)?.message;
  return typeof msg === 'string' ? msg : '';
}

export function classifyPurchaseError(err: unknown): PurchaseErrorKind {
  if ((err as any)?.userCancelled === true) return 'cancelled';

  const code = errorCode(err);

  if (code === '1') return 'cancelled';
  if (code === '20') return 'pending';
  if (code === '10' || code === '32' || code === '35') return 'network';
  if (code === '6') return 'already_owned';
  if (code === '2' || code === '3' || code === '5') return 'store';

  if (/network|offline|internet/i.test(errorMessage(err))) return 'network';

  return 'unknown';
}

export type PurchaseErrorCopy = { title: string; body: string };

export const PURCHASE_ERROR_COPY: Record<
  Exclude<PurchaseErrorKind, 'cancelled'>,
  PurchaseErrorCopy
> = {
  pending: {
    title: 'Purchase pending',
    body: 'Your purchase is waiting for approval (for example Ask to Buy). Premium unlocks automatically once it is approved.',
  },
  network: {
    title: 'No connection',
    body: 'Check your internet connection and try again.',
  },
  already_owned: {
    title: 'Already purchased',
    body: 'This subscription is already active on your Apple ID. Tap Restore Purchases to unlock it here.',
  },
  store: {
    title: 'Purchase not available',
    body: 'The App Store could not complete this purchase right now. Please try again later.',
  },
  unknown: {
    title: 'Purchase failed',
    body: 'The purchase did not go through. Please try again.',
  },
};
