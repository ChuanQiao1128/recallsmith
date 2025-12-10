// src/auth/hostedUi.ts
export {
  startLogin,
  buildLogoutUrl,
  consumePostLoginRedirect,
  exchangeCodeForTokens,
  type OAuthTokenResponse,
} from './cognito';

// ✅ 兼容旧名字（如果你项目里还有老调用）
import {
  startLogin,
  buildLogoutUrl,
  consumePostLoginRedirect,
  exchangeCodeForTokens,
} from './cognito';

export const startHostedUiLogin = startLogin;
export const getLogoutUrl = buildLogoutUrl;
export const consumeRedirectAfterLogin = consumePostLoginRedirect;
export const exchangeAuthCodeForTokens = exchangeCodeForTokens;