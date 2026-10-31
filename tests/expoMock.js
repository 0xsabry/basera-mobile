module.exports = {
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
  launchCameraAsync: async () => ({ canceled: true, assets: [] }),
  speak: () => undefined,
  stop: async () => undefined,
  isSpeakingAsync: async () => false,
  // expo-router stubs (additive — used by UI render-smoke tests only;
  // navigation itself is exercised on-device, never in jest).
  Redirect: () => null,
  useFocusEffect: () => undefined,
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
  router: { push: () => undefined, replace: () => undefined, back: () => undefined },
  Stack: () => null,
  Tabs: () => null,
  // expo-camera stubs for permission reads in effects (not run in SSR).
  Camera: {
    getCameraPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
    getMicrophonePermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
    requestCameraPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
    requestMicrophonePermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
  },
  // expo-location stubs.
  getForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: true, status: 'undetermined' }),
  getBackgroundPermissionsAsync: async () => ({ granted: false, canAskAgain: true, status: 'undetermined' }),
  requestForegroundPermissionsAsync: async () => ({ granted: false, canAskAgain: true, status: 'undetermined' }),
  // expo-speech stubs.
  getAvailableVoicesAsync: async () => [],
};
