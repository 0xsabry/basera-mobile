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
  /** Inserts the hazard event server-side (when configured + signed in)
   *  and invokes the notify-guardian Edge Function. */
  notify(event: {
    className: string;
    level: 'medium' | 'high';
    confidence: number | null;
    direction: string | null;
    proximity: string | null;
    source: 'phone-yolo' | 'manual-sos';
  }): Promise<GuardianNotifyOutcome>;
}

/** Real notifier over Supabase. Unconfigured / signed-out → 'unavailable'. */
export const supabaseHazardNotifier: HazardNotifier = {
  async notify(event) {
    const client = getSupabaseClient();
    if (!client) return 'unavailable';
    const guardian = getGuardianService();
    const user = await guardian.getCurrentUser().catch(() => null);
    if (!user) return 'unavailable';
    try {
      const { data, error } = await client
        .from('hazard_events')
        .insert({
          user_id: user.id,
          hazard_class: event.className,
          risk_level: event.level,
          confidence: event.confidence,
          direction: event.direction,
          proximity_category: event.proximity,
          source: event.source,
        })
        .select('id')
        .single();
      if (error || !data) return 'failed';
      const { error: fnError } = await client.functions.invoke('notify-guardian', {
        body: { type: 'hazard', ownerUserId: user.id, hazardEventId: data.id },
      });
      return fnError ? 'failed' : 'sent';
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

/** "أنا بخير" — acknowledge all outstanding alerts, stop escalation. */
export async function acknowledgeHazards(): Promise<void> {
  deps.engine.acknowledge();
  await deps.store.acknowledgeAll();
  setHazardBusy(false);
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
