# 01 — Demo Guide: Introduction & Overview

## Opening moment (20–30 seconds, during the introduction)

1. Hold the phone running BASERA (1.1.8 + latest preview update applied).
2. Open the Smart Assistant tab, pick the sample street image from the
   gallery source.
3. Let the app speak the scene description aloud — the committee hears the
   product before any architecture is explained.

## Expected behavior

- The description names the main objects and their positions (left / center /
  right) in the selected app language.
- Speech starts from on-device TTS; detection ran on-device (no network
  needed — airplane mode is a valid, honest way to show this).

## Fallback if the live moment fails

- Switch to a history item: open the History tab and replay a previous
  detection result (stored on-device in `src/data/HistoryStore.ts` data).
- State plainly: "the live run failed on this device just now; the stored
  result is from a real earlier run" — never present a stored result as live.

## Before the session

- Charge the phone, disable auto-lock, set the app language you will present
  in, and apply the latest in-app update the night before.
- Close other apps; detection and speech are on-device and compete for RAM.
