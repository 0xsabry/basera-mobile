/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  transform: {
    '^.+\\.(ts|tsx)$': ['babel-jest', {
      configFile: false,
      babelrc: false,
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        ['@babel/preset-typescript', { isTSX: true, allExtensions: true }],
        ['@babel/preset-react', { runtime: 'automatic' }],
      ],
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(tflite|jpg|png)$': '<rootDir>/tests/fileMock.js',
    '^expo-.*$': '<rootDir>/tests/expoMock.js',
    '^react-native$': '<rootDir>/tests/rnMock.js',
    '^@react-native-async-storage/async-storage$': '<rootDir>/tests/asyncStorageMock.js',
    '^@react-native-ml-kit/text-recognition$': '<rootDir>/tests/mlkitMock.js',
    '^@react-native-voice/voice$': '<rootDir>/tests/voiceMock.js',
    '^react-native-fast-tflite$': '<rootDir>/tests/tfliteMock.js',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
};
