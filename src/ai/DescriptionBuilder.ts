/**
 * Builds short, spoken-friendly scene descriptions from detections.
 * Obstacle-relevant classes are mentioned first; counts are grouped;
 * positions use simple words (left / center / right — شمالك / قدامك /
 * يمينك in the spoken-Egyptian Arabic narration).
 * Pure and unit-tested in EN + AR.
 */
import type { AppLanguage, Detection } from './types';
import { horizontalPosition, PRIORITY_CLASSES } from './ObstacleAwareness';

const POSITION_EN = { left: 'on the left', center: 'in front of you', right: 'on the right' } as const;
/** Arabic narration is spoken Egyptian (owner order 2026-11-02):
 *  natural everyday words, with directions kept explicit and
 *  unambiguous — قدامك (in front of you) / على شمالك (your left) /
 *  على يمينك (your right). */
const POSITION_AR = { left: 'على شمالك', center: 'قدامك', right: 'على يمينك' } as const;

interface Group {
  labelEn: string;
  labelAr: string;
  count: number;
  /** Dominant position: position of the largest instance. */
  position: 'left' | 'center' | 'right';
  priority: boolean;
  maxArea: number;
}

function groupDetections(detections: Detection[]): Group[] {
  const map = new Map<number, Group & { classId: number }>();
  for (const d of detections) {
    const area = d.box.width * d.box.height;
    const existing = map.get(d.classId);
    if (!existing) {
      map.set(d.classId, {
        classId: d.classId,
        labelEn: d.labelEn,
        labelAr: d.labelAr,
        count: 1,
        position: horizontalPosition(d),
        priority: PRIORITY_CLASSES.has(d.labelEn),
        maxArea: area,
      });
    } else {
      existing.count += 1;
      if (area > existing.maxArea) {
        existing.maxArea = area;
        existing.position = horizontalPosition(d);
      }
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return b.maxArea - a.maxArea;
  });
}

export function buildDescription(detections: Detection[], lang: AppLanguage): string {
  if (detections.length === 0) {
    return lang === 'ar'
      ? 'مش شايف حاجة واضحة في الصورة.'
      : 'I could not recognize anything clear in this image.';
  }
  const groups = groupDetections(detections).slice(0, 5);

  if (lang === 'en') {
    const parts = groups.map((g) => {
      const noun = g.count > 1 ? `${g.count} ${pluralize(g.labelEn)}` : articleFor(g.labelEn);
      return `${noun} ${POSITION_EN[g.position]}`;
    });
    return `I can see: ${joinEn(parts)}.`;
  }
  const parts = groups.map((g) => {
    const noun = g.count > 1 ? `${g.count} ${g.labelAr}` : g.labelAr;
    return `${noun} ${POSITION_AR[g.position]}`;
  });
  return `شايف: ${parts.join('، ')}.`;
}

function articleFor(label: string): string {
  return /^[aeiou]/i.test(label) ? `an ${label}` : `a ${label}`;
}

function pluralize(label: string): string {
  if (/(s|x|ch|sh)$/.test(label)) return `${label}es`;
  if (/[^aeiou]y$/.test(label)) return `${label.slice(0, -1)}ies`;
  // Multi-word labels: pluralize the last word.
  const words = label.split(' ');
  if (words.length > 1) {
    words[words.length - 1] = pluralize(words[words.length - 1]);
    return words.join(' ');
  }
  return `${label}s`;
}

/** One-line summary for a single detection, used in lists. */
export function describeDetection(d: Detection, lang: AppLanguage): string {
  const pos = horizontalPosition(d);
  const pct = Math.round(d.confidence * 100);
  if (lang === 'ar') {
    return `${d.labelAr} — ${POSITION_AR[pos]} (ثقة ${pct}٪)`;
  }
  return `${d.labelEn} — ${POSITION_EN[pos]} (${pct}% confidence)`;
}

function joinEn(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
