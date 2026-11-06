# BASERA instructions for GitHub Copilot

Follow the root AGENTS.md and docs/AI_INSPECTION_GUIDE.md before making changes.

Key project facts:
- Expo SDK 58, React Native 0.88, TypeScript, expo-router.
- YOLO11n TFLite for object detection.
- PP-OCR for Arabic OCR; Google ML Kit for Latin OCR only.
- expo-speech for TTS; expo-speech-recognition for microphone recognition.
- Supabase Guardian behaviour follows docs/SUPABASE_INTEGRATION.md, not archived local SQL.
- Smart glasses, continuous camera monitoring, browser push delivery, and KemeTone integration are not current app capabilities.
- Keep local inference, Guardian backend, and telemetry boundaries explicit.

Never run production migrations/deployments or EAS builds/publishes without explicit owner approval. Never add secrets. Do not treat host tests as physical-device verification.