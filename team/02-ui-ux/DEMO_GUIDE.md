# 02 — Demo Guide: UI/UX

## Live demo (60–90 seconds)

1. Turn TalkBack ON and navigate: Home → Smart Assistant → back, using
   swipe gestures only, screen visible to the committee.
2. Switch the app language Arabic ↔ English in Settings and show the layout
   flipping to RTL and back.
3. Switch theme: light → dark → high contrast; point out the status bar
   staying readable in each.
4. Open the Family tab and show a status pill and a toggle row — everything
   labelled, everything reachable by swipe.

## Expected behavior

- Every control announces a clear label; no unlabelled stops.
- Layout mirrors fully in Arabic (tab order and alignment flip).
- Text never overflows its card; pills stay one short word.

## Fallback

- If TalkBack slows the flow, narrate the same path with it off and state
  that the labels are what TalkBack reads (they are visible in the code as
  `accessibilityLabel` props).
- Screenshots do not exist in the repository — do not invent any; use the
  live device or nothing.

## Before the session

- Set TalkBack speech rate to a level the room can follow.
- Prepare the phone in the light theme (the fresh-install default).
