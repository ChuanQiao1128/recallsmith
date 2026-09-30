// Metro config: the Sentry wrapper around Expo's default config stamps Debug IDs
// into the JS bundle and its source maps (M00 §3.1). It uploads nothing.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
module.exports = getSentryExpoConfig(__dirname);
