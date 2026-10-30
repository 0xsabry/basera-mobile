// Mock of @react-native-ml-kit/text-recognition mirroring its real API:
// default export with recognize(uri, script) + TextRecognitionScript enum
// (Latin/Chinese/Devanagari/Japanese/Korean — no Arabic, like the real lib).
module.exports = {
  __esModule: true,
  TextRecognitionScript: {
    LATIN: 'Latin',
    CHINESE: 'Chinese',
    DEVANAGARI: 'Devanagari',
    JAPANESE: 'Japanese',
    KOREAN: 'Korean',
  },
  default: { recognize: async () => ({ text: '', blocks: [] }) },
};
