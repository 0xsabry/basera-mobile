# 06 — Demo Guide: Voice System

## Live demo (45–60 seconds)

1. Fresh-start the app, immediately run one detection on a bundled sample
   and let it speak — the first sentence should start without the old
   multi-second stall (warm-up at startup).
2. While a long description is speaking, trigger an interruption (start a
   new action / hazard announcement) to show speech yields immediately.
3. Open Settings → Voice: show Automatic / System / custom rows; play the
   sample line in the selected voice.

## Expected behavior

- First utterance begins promptly; if voice discovery was still running,
  the first sentence uses the language fallback and the *next* sentence
  uses the discovered Egyptian voice.
- No speech ever starts by itself on app entry.

## Fallback

- If the demo phone has **no** ar-EG voice installed, say so plainly and
  show the voice list as evidence — selection can only pick what the
  device offers; that is exactly the limitation the catalog code handles.
- If TTS is silent, check media volume and the device TTS engine before
  retrying; do not claim a voice the room did not hear.

## Before the session

- Reboot the phone, open the app once (warm-up + any pending update),
  then close and reopen for the demo.
- Verify which voices the demo device actually has installed.
