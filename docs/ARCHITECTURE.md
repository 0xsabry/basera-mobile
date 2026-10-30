# BASERA Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ UI layer — src/app (expo-router screens)                    │
│ Onboarding · Home · Detect · Text Reader · Voice · History  │
│ Settings — all TalkBack-labelled, ≥60dp targets, AR/EN RTL  │
└───────────────┬───────────────────────────┬─────────────────┘
                │                           │
┌───────────────▼───────────────┐ ┌─────────▼─────────────────┐
│ Application services          │ │ State                     │
│ src/ai/SpeechService (TTS)    │ │ SettingsContext (lang,    │
│ src/ai/VoiceCommandService    │ │ theme, rate, contrast)    │
│ src/ai/DescriptionBuilder     │ │ src/i18n (full AR + EN)   │
│ src/ai/ObstacleAwareness      │ │ src/theme (design tokens) │
└───────────────┬───────────────┘ └───────────────────────────┘
                │
┌───────────────▼───────────────┐ ┌───────────────────────────┐
│ AI engines (interfaces)       │ │ Data                      │
│ ObjectDetector -> YoloDetector│ │ HistoryStore              │
│   (YOLOv8n TFLite, on-device) │ │ (AsyncStorage + app files,│
│ TextRecognizer -> MlKit OCR   │ │  on-device only)          │
│ yoloPostprocess (pure TS)     │ │                           │
│ imagePreprocess (pure TS)     │ │                           │
└───────────────▲───────────────┘ └───────────────────────────┘
                │ CapturedImage { uri, width, height, sourceKind }
┌───────────────┴─────────────────────────────────────────────┐
│ Image input layer — src/input/ImageSource.ts                │
│ GalleryImageSource · SampleImageSource ·                    │
│ PhoneCameraTestSource (TEST ONLY) ·                         │
│ SmartGlassesCameraSource (FUTURE — typed NotAvailable)      │
└─────────────────────────────────────────────────────────────┘
```

## Module map

| Module | Responsibility |
|---|---|
| `src/input/*` | Where images come from. The ONLY layer that knows about cameras/gallery/glasses. |
| `src/ai/ObjectDetector.ts` | Interface + YOLOv8n TFLite implementation (react-native-fast-tflite). |
| `src/ai/yoloPostprocess.ts` | Pure decode + NMS, verified against a real Python model run. |
| `src/ai/imagePreprocess.ts` | Letterbox tensor construction (pure core + on-device decode). |
| `src/ai/TextRecognizer.ts` | Interface + Google ML Kit OCR implementation. |
| `src/ai/SpeechService.ts` | expo-speech wrapper: speak/stop/repeat, rate, AR/EN. |
| `src/ai/VoiceCommandService.ts` | Recognition wrapper + pure AR/EN command parser + registry. |
| `src/ai/DescriptionBuilder.ts` | Detections → short spoken sentences (AR/EN). |
| `src/ai/ObstacleAwareness.ts` | Position + heuristic proximity category. NOT distance. |
| `src/data/HistoryStore.ts` | On-device history (list/add/remove/clear, capped at 50). |
| `src/state/SettingsContext.tsx` | Persisted settings + theme resolution + RTL switching. |
| `src/i18n/strings.ts` | Complete Arabic + English string tables. |
| `src/theme/tokens.ts` | Type scale, spacing, light/dark + high-contrast palettes. |

## Design rules

1. Screens never talk to native modules directly — only through the service
   interfaces above.
2. AI engines throw typed errors when their native module is unavailable;
   they never fabricate results.
3. Everything in the core pipeline works offline.
4. Adding the smart glasses = adding one `ImageSource` implementation.
