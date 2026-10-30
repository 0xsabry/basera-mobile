/**
 * Versioned glasses-to-phone hazard event interface (contract v1).
 *
 * The smart-glasses hardware does NOT exist yet. No transport (BLE,
 * Wi-Fi, USB) is specified or invented here — the transport lives inside
 * a future implementation of this interface, exactly like the camera
 * transport lives inside an ImageSource. What IS fixed now is the event
 * shape the phone's risk pipeline consumes, so glasses-detected events
 * and phone-detected events flow through the same evaluation, alerting,
 * history, and guardian-notification path.
 *
 * See docs/GLASSES_INTEGRATION.md.
 */

export const HAZARD_EVENT_CONTRACT_VERSION = 1;

export interface GlassesHazardEvent {
  contractVersion: typeof HAZARD_EVENT_CONTRACT_VERSION;
  /** Glasses-side monotonically increasing sequence number. */
  seq: number;
  /** Device clock timestamp (ms since epoch) at detection time. */
  deviceTimestamp: number;
  /** Detector class label as reported by the glasses (free-form until
   *  the hardware team's label set is frozen; the phone maps known
   *  labels onto its COCO taxonomy and ignores unknown ones). */
  classLabel: string;
  /** 0..1 detector confidence as reported by the glasses. */
  confidence: number;
  /** Optional normalized bounding box if the glasses provide one. */
  box?: { x: number; y: number; width: number; height: number };
  /** Optional glasses-side hazard category hint. Advisory only — the
   *  phone's RiskEngine always makes the final risk decision. */
  categoryHint?: 'vehicle' | 'person' | 'animal' | 'sharp' | 'static' | 'unknown';
}

export class HazardSourceNotAvailableError extends Error {
  readonly code = 'HAZARD_SOURCE_NOT_AVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'HazardSourceNotAvailableError';
  }
}

export interface HazardEventSource {
  readonly id: string;
  /** Resolves when the source can deliver events. MUST reject with
   *  HazardSourceNotAvailableError when the hardware is absent — never
   *  fake a connection. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(listener: (event: GlassesHazardEvent) => void): () => void;
}

/**
 * The only glasses hazard source that exists today: an honest
 * not-available implementation. It never emits events and never
 * pretends to be connected.
 */
export class NotAvailableHazardEventSource implements HazardEventSource {
  readonly id = 'smart-glasses';
  async connect(): Promise<void> {
    throw new HazardSourceNotAvailableError(
      'The smart glasses are not connected — the hardware is still in development. Hazard detection currently runs on the phone camera only.',
    );
  }
  async disconnect(): Promise<void> {
    // Nothing was ever connected.
  }
  onEvent(): () => void {
    return () => undefined;
  }
}
