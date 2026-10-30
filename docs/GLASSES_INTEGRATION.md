# Smart Glasses Integration Contract (Future)

**Status: hardware does not exist yet. No protocol has been invented, and
none should be invented before hardware specifications exist.**

This document defines only the *software seam* the glasses will plug into —
the `ImageSource` interface the app already uses for gallery, samples, and
the phone-camera test input.

## The contract

The glasses software must provide one implementation of:

```ts
// src/input/ImageSource.ts
interface ImageSource {
  readonly id: string;            // 'smart-glasses'
  readonly kind: 'smart-glasses';
  getImage(): Promise<CapturedImage | null>;
}

interface CapturedImage {
  uri: string;          // local file URI of the frame (JPEG or PNG)
  width: number;        // pixels
  height: number;       // pixels
  sourceKind: 'smart-glasses';
}
```

`SmartGlassesCameraSource` already exists implementing this interface and
currently throws `ImageSourceNotAvailableError`. The glasses team replaces
its body — nothing else in the app changes. All screens, the YOLO detector,
OCR, TTS, voice commands, and history work with glasses frames unchanged,
because they only ever consume `CapturedImage`.

## Frame format expectations (to be confirmed with hardware)

- Still frames as JPEG (preferred) or PNG files written to a local URI the
  app can read, OR delivered through whatever transport the hardware team
  chooses (the transport lives *inside* the glasses `ImageSource`
  implementation; the app must not depend on it).
- Minimum useful resolution: 640×480. Recommended: 1280×720 or higher —
  YOLO letterboxes to 640×640, OCR benefits from higher resolution.
- Correct orientation metadata applied (frames upright as the user sees).
- For a future continuous mode: a frame rate and delivery model must be
  specified by the hardware team before any streaming work is scheduled;
  the current app is single-frame, on-demand.

## Capability handshake fields (to be defined WITH the hardware team)

When hardware exists, the glasses should report at minimum:

- device id / model, firmware version
- camera resolution(s) and field of view
- whether a depth/distance sensor exists and its type/range
  (this matters: only with a real depth source may BASERA ever speak
  actual distances — see `src/ai/ObstacleAwareness.ts`)
- battery level, connection state

Field names and the transport for this handshake are deliberately NOT
specified yet. They will be designed against the real hardware spec, not
guessed in advance.

## Explicitly not implemented

- No Bluetooth or Wi-Fi protocol, pairing flow, or driver exists in the app.
- No fake "connected" state anywhere in the UI. Settings shows the honest
  status: "Smart glasses: not connected — hardware in development".
- No simulated camera feed.
