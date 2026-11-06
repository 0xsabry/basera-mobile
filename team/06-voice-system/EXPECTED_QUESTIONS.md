# 06 — Expected Questions: Voice System

**Q1. Which TTS engine speaks?**
The device's own text-to-speech via expo-speech, behind our
`SpeechService`. There is no cloud TTS and no bundled voice in the app —
voice quality is whatever the phone provides, which is why selection
logic matters.

**Q2. How do you pick an "Egyptian" voice?**
`selectEgyptianVoice()` filters the device voice list to an exact
normalized `ar-EG` language match, then sorts by quality tier. Anything
looser (any Arabic voice) would mislabel Gulf/Levantine voices as
Egyptian.

**Q3. What if the phone has no Egyptian voice?**
Selection returns null and speech falls back to the `ar-EG` language
tag, letting the engine choose its closest Arabic voice. Speech never
blocks on voice availability.

**Q4. Why did the first sentence used to take so long?**
Voice discovery (`getAvailableVoicesAsync`) was awaited, unbounded, on
the first Arabic auto utterance, and every utterance paid a `stop()`
round-trip even when idle. Fixes: startup warm-up, a 300 ms bounded
race with language fallback, and an active-speech tracker that skips
idle stops. Contracts are in `speechLatency.test.ts`.

**Q5. Can a hazard alert interrupt speech?**
Yes — interruption semantics are preserved: when speech is active, a
hazard announcement stops it and speaks immediately. The optimization
only skips the stop call when nothing is playing.

**Q6. How do voice commands work?**
The platform recognizer turns speech into text; `parseVoiceCommand()`
matches it against a fixed `COMMAND_REGISTRY` of Arabic and English
phrases. No free-form understanding — unmatched speech is rejected with
a clear message, which is the safe behavior for an assistive app.

**Q7. Does voice recognition work offline?**
That depends on the device's recognizer; the app surfaces recognizer
unavailability as typed errors (`VoiceUnavailableError`) instead of
pretending. We do not claim offline recognition where the device does
not provide it.

**Q8. Why not ship the neural Egyptian voice (KemeTone)?**
KemeTone is a separate prototype: its pronunciation converter and
engine start are proven on the target phone, but end-to-end audio
generation had not passed its acceptance test when this app version was
frozen, and it needs a native module (a new APK, ~350 MB in prototype
form). Shipping an unproven voice into a safety app would be dishonest.

**Q9. Who writes the spoken sentences?**
`DescriptionBuilder` composes them from detections: object names from
the label table, positions from `ObstacleAwareness`, Egyptian-style
direction phrases for narration. It never rewrites OCR output, names,
or numbers.

**Q10. How are voices tested without listening in CI?**
Selection and timing logic are unit-tested (catalog filters, the
300 ms race, stop-skip). Actual sound quality can only be judged by
human listeners on a device — we separate "logic verified" from
"listened to" in our status reporting.

**Q11. Can the user change voices?**
Yes — Settings → Voice offers Automatic (Egyptian selection), System
default, or any specific installed voice; the preference persists and
legacy stored values are migrated (`migrateVoicePreference`).

**Q12. Does the app ever speak unprompted?**
No. An automated guard (`noEntrySpeech.test.ts`) forbids speech calls
in entry effects; even the startup warm-up is explicitly silent — it
only enumerates voices.
