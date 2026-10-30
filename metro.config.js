// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Bundle the on-device YOLO TFLite model as an asset.
config.resolver.assetExts = [...config.resolver.assetExts, 'tflite'];

module.exports = config;
