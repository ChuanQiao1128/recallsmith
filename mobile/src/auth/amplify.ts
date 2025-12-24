// mobile/src/auth/amplify.ts
import 'react-native-get-random-values';
import { Amplify } from 'aws-amplify';

let _configured = false;

export function configureAmplifyOnce() {
  if (_configured) return;

  const region = (process.env.EXPO_PUBLIC_AWS_REGION || '').trim();
  const userPoolId = (process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID || '').trim();
  const userPoolClientId = (process.env.EXPO_PUBLIC_COGNITO_USER_POOL_CLIENT_ID || '').trim();

  if (!region || !userPoolId || !userPoolClientId) {
  console.warn('[amplify] missing env vars for Cognito', { region, userPoolId, userPoolClientId });
  return; // ✅ 不要用空配置初始化
}

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        // （可选）如果你只允许 email 登录，这个字段可以留着
        loginWith: {
          email: true,
        },
      },
    },
  });

  _configured = true;
}