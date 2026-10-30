module.exports = {
  requestMediaLibraryPermissionsAsync: async () => ({ granted: true }),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
  launchCameraAsync: async () => ({ canceled: true, assets: [] }),
  speak: () => undefined,
  stop: async () => undefined,
  isSpeakingAsync: async () => false,
};
