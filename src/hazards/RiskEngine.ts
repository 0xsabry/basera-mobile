/**
 * Deterministic hazard risk engine over YOLO/COCO detections.
 *
 * Implements the taxonomy in docs/V1.1_PLAN.md §6.3. Pure and fully
 * unit-tested: same inputs + same clock → same alerts. No ML, no
 * randomness, no network.
 *
 * HONESTY CONTRACT (also shown in-app):
 * - This evaluates single user-captured frames ("scan-based" checks).
 *   It is NOT continuous real-time protection.
 * - A bounding box gives position + a heuristic proximity CATEGORY —
 *   never a distance. The engine never claims meters.
 * - Whole hazard classes are INVISIBLE to the COCO model (stairs,
 *   holes, fire/smoke, glass doors, weapons…). Absence of an alert
 *   NEVER means the user is safe. See NOT_DETECTABLE below.
 * - A detected "person" is never, on its own, announced as danger:
 *   people are usually not hazards. A person alerts (medium only) when
 *   near + centered + persistent — a possible collision course.
 */
import {
  horizontalPosition,
  proximityCategory,
  type HorizontalPosition,
  type ProximityCategory,
} from '../ai/ObstacleAwareness';
import type { Detection } from '../ai/types';

export type RiskLevel = 'low' | 'medium' | 'high';
export type HazardCategory = 'vehicle' | 'person' | 'animal' | 'sharp' | 'static';

export interface HazardCandidate {
  className: string;
  labelEn: string;
  labelAr: string;
  category: HazardCategory;
  confidence: number;
  direction: HorizontalPosition;
  proximity: ProximityCategory;
  /** Risk if this candidate were alerted on right now. */
  level: RiskLevel;
}

export interface HazardAlert extends HazardCandidate {
  /** Unique per engine instance: `${at}-${className}-${direction}-${n}`. */
  id: string;
  at: number;
  /** True when this alert crosses the escalation threshold (3 high
   *  alerts within 5 minutes without acknowledgment). */
  escalated: boolean;
}

interface CategoryRule {
  category: HazardCategory;
  classes: string[];
  /** Minimum model confidence for the class to be considered at all. */
  threshold: number;
}

export const HAZARD_RULES: CategoryRule[] = [
  { category: 'vehicle', classes: ['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'train'], threshold: 0.35 },
  { category: 'person', classes: ['person'], threshold: 0.4 },
  {
    category: 'animal',
    classes: ['dog', 'cat', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'bird'],
    threshold: 0.4,
  },
  // Sharps get a HIGHER threshold: kitchens are full of them and false
  // positives destroy trust (plan §6.3 false-positive budget).
  { category: 'sharp', classes: ['knife', 'scissors'], threshold: 0.55 },
  {
    category: 'static',
    classes: ['chair', 'bench', 'couch', 'dining table', 'potted plant', 'bed'],
    threshold: 0.5,
  },
];

const RULE_BY_CLASS = new Map<string, CategoryRule>();
for (const rule of HAZARD_RULES) {
  for (const c of rule.classes) RULE_BY_CLASS.set(c, rule);
}

/** Hazard classes the shipped COCO model CANNOT detect. Displayed in-app. */
export const NOT_DETECTABLE: { en: string; ar: string }[] = [
  { en: 'Stairs and steps', ar: 'السلالم والدرج' },
  { en: 'Holes and drop-offs', ar: 'الحفر والمنحدرات المفاجئة' },
  { en: 'Fire and smoke', ar: 'النار والدخان' },
  { en: 'Glass doors and walls', ar: 'الأبواب والحوائط الزجاجية' },
  { en: 'Weapons', ar: 'الأسلحة' },
  { en: 'Hanging obstacles above the camera view', ar: 'عوائق معلقة فوق مستوى الكاميرا' },
  { en: 'Water, ice and slippery floors', ar: 'الماء والجليد والأرضيات الزلقة' },
];

/** Base risk for a candidate, from category + proximity + direction. */
export function baseRisk(c: Omit<HazardCandidate, 'level'>): RiskLevel {
  const { category, proximity, direction } = c;
  switch (category) {
    case 'vehicle':
      if (proximity === 'near') return 'high';
      if (proximity === 'medium' && direction === 'center') return 'high';
      if (proximity === 'medium') return 'medium';
      return 'low';
    case 'person':
      // Never "high": a person alone is context, not danger.
      if (proximity === 'near' && direction === 'center') return 'medium';
      return 'low';
    case 'animal':
      if (proximity === 'near') return 'medium';
      return 'low';
    case 'sharp':
      if (proximity === 'near') return 'medium';
      return 'low';
    case 'static':
      return 'low';
  }
}

/** Extract above-threshold hazard candidates from one evaluation. */
export function extractCandidates(detections: Detection[]): HazardCandidate[] {
  const out: HazardCandidate[] = [];
  for (const d of detections) {
    const rule = RULE_BY_CLASS.get(d.labelEn);
    if (!rule) continue;
    if (d.confidence < rule.threshold) continue;
    const partial = {
      className: d.labelEn,
      labelEn: d.labelEn,
      labelAr: d.labelAr,
      category: rule.category,
      confidence: d.confidence,
      direction: horizontalPosition(d),
      proximity: proximityCategory(d),
    };
    out.push({ ...partial, level: baseRisk(partial) });
  }
  return out;
}

export interface RiskEngineOptions {
  /** Same class+direction re-alert suppression window. */
  cooldownMs?: number;
  /** High alerts inside this window count toward escalation. */
  escalationWindowMs?: number;
  /** High alerts (unacknowledged) that trigger escalation. */
  escalationCount?: number;
  now?: () => number;
}

const PROXIMITY_RANK: Record<ProximityCategory, number> = { far: 0, medium: 1, near: 2 };

export class RiskEngine {
  private readonly cooldownMs: number;
  private readonly escalationWindowMs: number;
  private readonly escalationCount: number;
  private readonly now: () => number;
  /** Ring of the last 3 evaluations: candidate keys present in each. */
  private recentKeys: Set<string>[] = [];
  private lastAlertAt = new Map<string, { at: number; proximity: ProximityCategory }>();
  private highAlertTimes: number[] = [];
  private alertSeq = 0;

  constructor(options: RiskEngineOptions = {}) {
    this.cooldownMs = options.cooldownMs ?? 20_000;
    this.escalationWindowMs = options.escalationWindowMs ?? 5 * 60_000;
    this.escalationCount = options.escalationCount ?? 3;
    this.now = options.now ?? (() => Date.now());
  }

  private static key(c: HazardCandidate): string {
    return `${c.className}|${c.direction}`;
  }

  /** Mark current hazards acknowledged: clears the escalation window. */
  acknowledge(): void {
    this.highAlertTimes = [];
  }

  reset(): void {
    this.recentKeys = [];
    this.lastAlertAt.clear();
    this.highAlertTimes = [];
  }

  /**
   * Evaluate one frame-batch. Returns the candidates (for display) and
   * the alerts that pass persistence + cooldown RIGHT NOW.
   * Persistence: the same class+direction must appear in ≥2 of the last
   * 3 evaluations (including this one) before it can alert.
   */
  evaluate(detections: Detection[]): { candidates: HazardCandidate[]; alerts: HazardAlert[] } {
    const at = this.now();
    const candidates = extractCandidates(detections);
    const keysNow = new Set(candidates.map((c) => RiskEngine.key(c)));
    this.recentKeys.push(keysNow);
    if (this.recentKeys.length > 3) this.recentKeys.shift();

    const alerts: HazardAlert[] = [];
    for (const c of candidates) {
      if (c.level === 'low') continue; // low = informational only, never an alert
      const key = RiskEngine.key(c);
      const seen = this.recentKeys.filter((s) => s.has(key)).length;
      if (seen < 2) continue;
      const last = this.lastAlertAt.get(key);
      if (last && at - last.at < this.cooldownMs) {
        // Cooldown — unless the hazard got CLOSER since the last alert.
        if (PROXIMITY_RANK[c.proximity] <= PROXIMITY_RANK[last.proximity]) continue;
      }
      const escalated = this.recordAlert(c, at);
      alerts.push({ ...c, id: `hz-${at}-${c.className}-${c.direction}-${this.alertSeq}`, at, escalated });
    }
    return { candidates, alerts };
  }

  private recordAlert(c: HazardCandidate, at: number): boolean {
    this.alertSeq += 1;
    this.lastAlertAt.set(RiskEngine.key(c), { at, proximity: c.proximity });
    if (c.level !== 'high') return false;
    this.highAlertTimes = this.highAlertTimes.filter((t) => at - t < this.escalationWindowMs);
    this.highAlertTimes.push(at);
    return this.highAlertTimes.length >= this.escalationCount;
  }
}
