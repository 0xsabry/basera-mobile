# 01 — Expected Questions: Introduction & Overview

**Q1. Why a mobile app and not a website or a desktop tool?**
The user needs help while moving, outdoors, in real time. A phone is always
carried, has a camera, GPS, and a screen reader built in. The app also works
offline because inference is on-device.

**Q2. Who exactly is the target user?**
Blind and visually impaired users, Arabic and English speakers. The UI is
TalkBack-first: every action is reachable and labelled for a screen reader,
touch targets are at least 48dp, and results are spoken, not only shown.

**Q3. What does the app actually do, in one list?**
Scene description (object detection + spoken narration), text reading (OCR),
obstacle/risk warnings, voice commands, saved places with proximity alerts,
history of past results, and a consent-based Guardian system (location
sharing + SOS) with a web app for family members.

**Q4. Does it need the internet?**
Detection, OCR, and speech work on-device without internet. The Guardian
features (accounts, sharing, SOS delivery to the backend) need connectivity,
and the app queues location points offline and uploads them later.

**Q5. How is this different from existing seeing-AI apps?**
Arabic-first bilingual experience, an Egyptian-voice path, a consent-based
family Guardian system with a web interface, and an architecture where the
image source is replaceable — designed so future smart glasses plug in
without rewriting the features.

**Q6. Are the smart glasses implemented?**
No. `src/input/SmartGlassesCameraSource.ts` is a typed placeholder that
reports itself unavailable. The phone camera today is an explicitly labelled
test source. This is future work and we present it as such.

**Q7. What is real AI here and what is rules?**
Object detection is a real YOLO11n neural network running in TFLite; Arabic
OCR is a real PP-OCRv3 pipeline; English OCR uses ML Kit. Risk warnings are
transparent rules on top of detections (section 07), and obstacle distance is
a proximity *category* from bounding-box size — we never claim metres.

**Q8. How was it tested?**
671 automated Jest tests (46 suites), Deno tests for the backend functions,
PWA tests, plus live API verification of the Guardian flows. Physical-device
verification is separate and we state exactly which parts have it.

**Q9. What are the project's honest limitations?**
The COCO model cannot detect stairs, holes, fire, or glass doors (listed
in-app), Arabic OCR can confuse dotted letters, push-notification delivery
for SOS is not yet proven, and the Guardian invitation hardening exists as
reviewed candidate code that is not deployed yet (section 10).

**Q10. Why Supabase and not a custom backend?**
It provides Auth, PostgreSQL, Row Level Security, and Edge Functions in one
managed platform, which let a student team enforce security at the database
level instead of trusting app code. Section 10 covers it in depth.

**Q11. Can the app work in Arabic completely?**
Yes — the full UI, narration, and copy are Arabic and English with RTL
support, guarded by automated copy tests that ban dialect terms and missing
keys in either language.

**Q12. What would you add next?**
Deploy the invitation hardening, prove push delivery end to end, run a
formal blind-listener panel for the Egyptian voice, and connect the glasses
input when hardware exists.
