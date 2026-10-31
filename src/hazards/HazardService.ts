/**
 * Hazard alert orchestration: detections → RiskEngine → user feedback
 * (speech + vibration + banner data) → local event history → optional
 * guardian notification.
 *
 * Delivery rules (docs/V1.1_PLAN.md §6.4):
 * - medium: short spoken alert (announcement channel — the ordinary
 *   repeat target is untouched) + single-pattern vibration + event.
 * - high: spoken warning on the ALERT channel (becomes the alert repeat
 *   target) + strong vibration pattern + event + guardian notification
 *   attempt (and the OTA reload guard is raised until acknowledged).
 * - SOS: always a high event; guardian notification attempted; the user
 *   is told HONESTLY whether guardians were notified, could not be
 *   notified, or the send failed. "Sent" means the BASERA service
 *   accepted the notification — delivery to a guardian's phone is never
 *   guaranteed and the UI copy says so.
 *
 * Guardian location is attached ONLY by the server-side flow and ONLY
 * when the user has location sharing ON; this module never sends
 * coordinates itself — it references the hazard event row.
 *
 * DEPLOYED-CONTRACT NOTE (owner's Supabase project): there is no
 * hazard_events table and no notify-guardian function in the deployed
 * project. SOS alerts are rows in `sos_alerts`, gated by the wearer's
 * OWN sos_sharing_enabled consent; hazard (camera) events have no
 * server destination in the deployed schema, so their guardian outcome
 * is honestly 'unavailable' — they remain on-device events. See
 * docs/SUPABASE_INTEGRATION.md.
 */
import { speechService } from '../ai/SpeechService';
import type { AppLanguage, Detection } from '../ai/types';
import { getGuardianService } from '../guardian/GuardianService';
import { getSupabaseClient } from '../guardian/supabaseClient';
import { t } from '../i18n/strings';
import { setAccessibilityBusy } from '../state/accessibilityBusy';
import { hapticAlertHigh, hapticAlertMedium } from '../state/haptics';
import { alertHistoryStore, type AlertEvent } from './AlertHistoryStore';
import { RiskEngine, type HazardAlert } from './RiskEngine';

export type GuardianNotifyOutcome = 'sent' | 'failed' | 'unavailable';

export interface HazardNotifier {
  /** SOS: records the alert in sos_alerts for linked guardians when
   *  the wearer's SOS consent is on. Hazard events have no deployed
   *  server destination and honestly report 'unavailable'. */
  notify(event: {
    className: string;
    level: 'medium' | 'high';
    confidence: number | null;
    direction: string | null;
    proximity: string | null;
    source: 'phone-yolo' | 'manual-sos';
  }): Promise<GuardianNotifyOutcome>;
}

/**
 * Real notifier over the DEPLOYED Supabase contract.
 * - SOS: inserts into sos_alerts ONLY when the wearer's own
 *   sos_sharing_enabled consent is ON (consent off ⇒ the SOS stays
 *   local-only and the outcome says so — never fake-sent). When the
 *   wearer also shares location, their last shared fix is attached as
 *   the alert snapshot. 'sent' means the sos_alerts row was accepted —
 *   linked guardians can then read it (Realtime/polling in their PWA);
 *   delivery to a guardian's phone is never guaranteed.
 * - Hazard (camera) events: the deployed project has no table for
 *   them, so the outcome is 'unavailable' — the event stays on-device.
 * Unconfigured / signed-out → 'unavailable'.
 */
export const supabaseHazardNotifier: HazardNotifier = {
  async notify(event) {
    if (event.source !== 'manual-sos') return 'unavailable';
    const client = getSupabaseClient();
    if (!client) return 'unavailable';
    const guardian = getGuardianService();
    const user = await guardian.getCurrentUser().catch(() => null);
    if (!user) return 'unavailable';
    try {
      const consent = await guardian.getConsent();
      if (!consent.sosSharingEnabled) return 'unavailable';
      const last = consent.locationSharingEnabled
        ? await guardian.getLatestLocation(user.id).catch(() => null)
        : null;
      await guardian.sendSosAlert(
        last
          ? {
              lat: last.lat,
              lng: last.lng,
              accuracyM: last.accuracyM,
              recordedAt: last.recordedAt,
            }
          : null,
      );
      return 'sent';
    } catch {
      return 'failed';
    }
  },
};

export interface HazardRuntimeDeps {
  engine: RiskEngine;
  store: typeof alertHistoryStore;
  notifier: HazardNotifier;
  isSharingOn: () => boolean;
}

let deps: HazardRuntimeDeps = {
  engine: new RiskEngine(),
  store: alertHistoryStore,
  notifier: supabaseHazardNotifier,
  isSharingOn: () => false,
};

/** Wired by the root layout / screens with the live settings value. */
export function configureHazardRuntime(patch: Partial<HazardRuntimeDeps>): void {
  deps = { ...deps, ...patch };
}

/** Test seam. */
export function resetHazardRuntimeForTests(): void {
  deps = {
    engine: new RiskEngine(),
    store: alertHistoryStore,
    notifier: supabaseHazardNotifier,
    isSharingOn: () => false,
  };
  hazardBusyRaised = false;
}

let hazardBusyRaised = false;
function setHazardBusy(active: boolean): void {
  if (active === hazardBusyRaised) return;
  hazardBusyRaised = active;
  setAccessibilityBusy('hazard', active);
}

function positionText(lang: AppLanguage, dir: string | null): string {
  if (dir === 'left') return t(lang, 'positionLeft');
  if (dir === 'right') return t(lang, 'positionRight');
  return t(lang, 'positionCenter');
}

function proximityText(lang: AppLanguage, prox: string | null): string {
  if (prox === 'near') return t(lang, 'proximityNear');
  if (prox === 'medium') return t(lang, 'proximityMedium');
  return t(lang, 'proximityFar');
}

/** Spoken/banner text for an alert, in the user's language. */
export function hazardAlertText(lang: AppLanguage, a: HazardAlert): string {
  const label = lang === 'ar' ? a.labelAr : a.labelEn;
  const prefix = a.level === 'high' ? t(lang, 'hazardWarnPrefix') : t(lang, 'hazardCarefulPrefix');
  return `${prefix} ${label} — ${positionText(lang, a.direction)} — ${proximityText(lang, a.proximity)}`;
}

export interface ProcessResult {
  alerts: HazardAlert[];
  events: AlertEvent[];
}

/**
 * Run one detection batch through the engine and deliver any alerts.
 * Called by the detect screen after each analysis — this is a
 * scan-based check on a user-captured frame, never a continuous loop.
 */
export async function processHazardDetections(
  detections: Detection[],
  lang: AppLanguage,
): Promise<ProcessResult> {
  const { alerts } = deps.engine.evaluate(detections);
  const events: AlertEvent[] = [];
  for (const a of alerts) {
    const text = hazardAlertText(lang, a);
    let notify: AlertEvent['guardianNotify'] = 'not-attempted';
    if (a.level === 'high') {
      setHazardBusy(true);
      speechService.setRate(1);
      void speechService.speakAlert(text, lang);
      hapticAlertHigh();
      notify = await deps.notifier.notify({
        className: a.className,
        level: 'high',
        confidence: a.confidence,
        direction: a.direction,
        proximity: a.proximity,
        source: 'phone-yolo',
      });
    } else {
      void speechService.speakAnnouncement(text, lang);
      hapticAlertMedium();
    }
    events.push(
      await deps.store.add({
        kind: 'hazard',
        className: a.className,
        category: a.category,
        level: a.level,
        direction: a.direction,
        proximity: a.proximity,
        acknowledged: false,
        guardianNotify: notify,
        locationShared: deps.isSharingOn(),
      }),
    );
  }
  return { alerts, events };
}

/** "أنا بخير" — acknowledge all outstanding alerts, stop escalation.
 *  Also resolves the wearer's own ACTIVE server-side SOS alerts
 *  (best-effort: updates are wearer-only in the deployed RLS, and
 *  alerts cannot be deleted by clients — resolving is the terminal
 *  state a guardian's PWA will show). */
export async function acknowledgeHazards(): Promise<void> {
  deps.engine.acknowledge();
  await deps.store.acknowledgeAll();
  setHazardBusy(false);
  await getGuardianService()
    .resolveMyActiveSos()
    .catch(() => undefined);
}

export interface SosOutcome {
  event: AlertEvent;
  notify: GuardianNotifyOutcome;
  message: string;
}

/**
 * Manual SOS (button or voice command). Always recorded locally first;
 * guardian notification attempted when possible; the returned message
 * states plainly which of the three outcomes happened.
 */
export async function triggerSos(lang: AppLanguage): Promise<SosOutcome> {
  setHazardBusy(true);
  hapticAlertHigh();
  const notify = await deps.notifier.notify({
    className: 'sos',
    level: 'high',
    confidence: null,
    direction: null,
    proximity: null,
    source: 'manual-sos',
  });
  const event = await deps.store.add({
    kind: 'sos',
    className: 'sos',
    category: 'sos',
    level: 'high',
    direction: null,
    proximity: null,
    acknowledged: false,
    guardianNotify: notify,
    locationShared: deps.isSharingOn(),
  });
  const message =
    notify === 'sent'
      ? t(lang, 'sosSent')
      : notify === 'failed'
        ? t(lang, 'sosNotifyFailed')
        : t(lang, 'sosLocalOnly');
  void speechService.speakAlert(message, lang);
  return { event, notify, message };
}
