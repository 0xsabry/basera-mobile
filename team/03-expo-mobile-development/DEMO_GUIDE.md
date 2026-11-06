# 03 — Demo Guide: Expo & Mobile Development

## Live demo (60 seconds)

1. Open the Updates screen (`src/app/updates.tsx` route) on the phone.
2. Tap "Check for updates" — show the current update ID and the release
   note rendered from the in-bundle `RELEASE_NOTES`.
3. Show the app version (1.1.8 / code 10) in Settings or the Updates
   screen and state where it comes from (Gradle).

## Expected behavior

- If the phone is current, the screen says so (the update service returns
  an honest up-to-date result — the protocol answers 204 to a current
  client).
- The release note text matches the bundle the phone is running.

## Fallback

- No network in the room: the Updates screen reports the network state
  honestly; explain the channel model from `eas.json` instead and show
  `docs/RELEASE.md` with the current preview group and rollback target.

## Before the session

- Apply the latest update the night before (do not demo a mid-session
  update download on conference Wi-Fi).
- Know the current preview group ID from `docs/RELEASE.md`.
