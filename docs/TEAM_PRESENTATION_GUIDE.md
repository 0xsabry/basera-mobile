# BASERA team presentation guide

This guide helps a team explain the application accurately and divide the presentation across 10 speakers. Adjust the split to match the work each person actually contributed; do not assign someone a contribution they did not make.

**The finalized division is the 10 numbered sections in [`team/`](../team/)** — each section folder contains its own overview, source map, code walkthrough, timed script, demo guide, and expected questions. This guide remains the shared reference for explanations and likely questions.

## Team members

| Student ID | Full Name |
|---|---|
| 2300788 | Shihab Eldin Mohamed Mahmoud |
| 2302181 | Radwa Khaled Kamal |
| 2300774 | Haidy Ahmed Mohamed |
| 2300611 | Shaza Eltahawy Abdelnaeem |
| 2201123 | Kenzy Ali Mohamed |
| 2300125 | Mohammed Ashraf Mohammed |
| 2300772 | Alameer Fahd Mohamed |
| 2201381 | Mohamed Sabry Hamdan |
| 2301535 | Omnia Medhat Khalifa |
| 2300825 | Eman Abdelbaset Abdelfatah |

Sections are identified by number and topic only; no topic is assigned to a named person in the repository materials.

## Suggested presentation structure

A clear presentation can use 12–14 slides and a short controlled demonstration:

1. Title and project identity — BASERA / بصيرة.
2. The problem — accessing visual information and orientation is difficult for blind and visually impaired users.
3. Project goals and scope — a bilingual mobile accessibility assistant, with smart glasses as future hardware rather than a finished feature.
4. User journey — onboarding, choose language, select an image or use a supported input, receive visual/text result, hear spoken feedback.
5. Application architecture — Expo, React Native, TypeScript, expo-router, service boundaries, and native modules.
6. Object detection — YOLO11n TFLite, image preprocessing, output decoding, bounding boxes, and spoken scene description.
7. OCR — separate Arabic PP-OCR and Latin ML Kit routes, including their limitations.
8. Speech and voice commands — device text-to-speech, platform speech recognition, and the TypeScript command parser.
9. Safety assistance — scan-based hazard risk engine, local alert history, and the separate SOS flow.
10. Family/Guardian — Supabase authentication, pairing, consent, location sharing, and Guardian PWA.
11. Supporting features — history, Smart Place Memory, accessibility settings, permissions, and updates.
12. Testing and quality — unit tests, model host verification, export/build evidence, and what still needs a physical-device test.
13. Limitations and future work — smart glasses, continuous monitoring, model accuracy, backend/push limits.
14. Conclusion and demonstration outcome.

## 10-person speaker split

| Section | Topic | Duration | Preparation pack |
|---|---|---|---|
| 01 | Introduction & Overview | 2 minutes | [team/01-introduction-overview](../team/01-introduction-overview/) |
| 02 | UI/UX | 2 minutes | [team/02-ui-ux](../team/02-ui-ux/) |
| 03 | Expo & Mobile Development | 2 minutes | [team/03-expo-mobile-development](../team/03-expo-mobile-development/) |
| 04 | YOLO & TFLite | 3 minutes | [team/04-yolo-tflite](../team/04-yolo-tflite/) |
| 05 | OCR | 2 minutes | [team/05-ocr](../team/05-ocr/) |
| 06 | Voice System | 2 minutes | [team/06-voice-system](../team/06-voice-system/) |
| 07 | Risk Detection | 2 minutes | [team/07-risk-detection](../team/07-risk-detection/) |
| 08 | Places & GPS | 2 minutes | [team/08-places-gps](../team/08-places-gps/) |
| 09 | History & Settings | 2 minutes | [team/09-history-settings](../team/09-history-settings/) |
| 10 | Guardian & Supabase | 3 minutes | [team/10-guardian-supabase](../team/10-guardian-supabase/) |

## Technical explanations for likely questions

### What is Expo?

Expo is the framework and toolchain used to configure, develop, build, and update the React Native application. It provides modules and build workflows. BASERA uses native libraries for tasks such as TFLite inference, ML Kit OCR, and microphone recognition, so those features require a compatible native development or standalone build. Expo Go alone is not the complete app runtime.

### What is React Native?

React Native is the framework that renders the mobile interface using native Android UI components while much of the application logic is written in JavaScript/TypeScript.

### Why TypeScript?

TypeScript adds static types to JavaScript. In BASERA it is used for contracts between image sources, AI engines, application services, UI screens, and backend adapters. This helps catch mismatched inputs and outputs before runtime.

### What is Supabase?

Supabase is the hosted backend platform used for Guardian functionality. It provides PostgreSQL database storage, authentication, Realtime capabilities, Row Level Security policies, and Edge Functions. It is not the on-device YOLO/OCR model and it does not perform the app's image inference.

### What is Row Level Security (RLS)?

RLS is database-level access control. BASERA relies on it so a signed-in wearer or guardian can only read or change records permitted by the deployed policies and the relevant consent settings. The deployed Guardian contract is described in docs/SUPABASE_INTEGRATION.md.

### What is TensorFlow Lite?

TensorFlow Lite is a runtime format for executing machine-learning models on mobile and edge devices. BASERA packages its YOLO11n and PP-OCR models as TFLite files and executes them through a React Native native binding.

### What is OCR?

Optical Character Recognition converts text appearing in an image into machine-readable text. BASERA uses PP-OCR for Arabic and ML Kit for Latin text.

### What is TTS and speech recognition?

Text-to-Speech (TTS) converts text into audio. Speech recognition converts microphone speech into text. BASERA uses expo-speech for TTS and expo-speech-recognition for microphone recognition. The command parser then interprets recognized text as an application action.

### What is a PWA?

A Progressive Web App is a web application that can be installed and launched in a browser-like standalone experience. BASERA's Guardian PWA is a separate companion client for guardians. Its currently documented deployed backend view is latest-location and SOS data; browser push delivery is not connected to the deployed backend.

### What is OTA?

Over-the-air (OTA) updates deliver compatible JavaScript updates to an already installed native app. OTA cannot add a missing native library or change native permissions. Those changes normally require a new APK.

## Demonstration order

Use a pretested phone and a small number of known sample inputs:

1. Open the app and show Arabic/English language selection or current language.
2. Open a bundled sample image and demonstrate object detection.
3. Show text reading with one Arabic sample and one Latin sample.
4. Demonstrate speech output and, only if verified on the phone, one microphone command.
5. Show a saved history item or a saved place.
6. Explain Family pairing and consent with screenshots or a prepared test account. Do not display real location or personal account data.
7. Explain hazard warnings using a prepared controlled frame. State clearly that scanning is user-triggered, not continuous.
8. Finish with test evidence and limitations.

Do not improvise with emergency SOS, real guardian accounts, or real location sharing during a live classroom presentation unless the team has rehearsed with dedicated test accounts and has owner approval.

## Demo fallback plan

Prepare these in advance:

- Screenshots or a short screen recording of each successful flow.
- The bundled sample images and their expected results.
- A slide showing the architecture and model files.
- A copy of the test summary with dates and environment.
- A short recorded speech sample only if it was actually generated by the app and the recording's device/build context is known.

If a native feature fails live, state that it is not verified on that device and show the prepared evidence. Do not invent a successful result.

## Statements to avoid

| Do not say | Say instead |
|---|---|
| "The glasses are connected and working." | "The app includes a future image-source interface; glasses hardware integration is planned." |
| "BASERA continuously scans the road." | "Hazard checks run on images the user captures; continuous monitoring is not implemented." |
| "It tells the exact distance to an obstacle." | "It provides heuristic position/proximity categories; it does not measure distance." |
| "The Arabic OCR is perfect." | "The Arabic OCR pipeline is real and host-verified on bundled samples, but accuracy is limited and device evaluation is still required." |
| "Every alert reaches the guardian's phone." | "SOS can create a server record when consent allows it; push delivery is not guaranteed and browser push is not wired." |
| "Guardian can see movement history for 24 hours." | "The deployed Guardian view exposes the latest location only." |
| "KemeTone is BASERA's current voice." | "The current app uses the operating system's TTS through expo-speech; KemeTone has not been integrated." |
| "All features have been tested on mobile." | "Some logic is unit-tested or host-verified; each native feature must be labelled according to its actual device evidence." |

## Suggested closing

BASERA brings several assistive capabilities into one bilingual mobile experience: image understanding, text reading, speech interaction, local safety assistance, and consent-based Guardian support. The project is designed around honest reporting of model and hardware limits. Its future direction is to connect a real smart-glasses input source once the hardware and interface are available.