/** Invite-code helpers — DEPLOYED contract (Edge Functions
 *  create-guardian-invite / accept-guardian-invite).
 *
 *  The old local design used strictly 6-digit codes from an RPC. The
 *  deployed function issues an `invite_code` whose exact format is the
 *  server's choice (numeric or alphanumeric), so these helpers no
 *  longer enforce 6 digits: they trim, strip internal spaces (users
 *  copy codes in display groups) and require a plausible token shape.
 *  Case is preserved — codes may be case-sensitive.
 */

/** Clean user input into a submittable code, or null when implausible. */
export function normalizePairingCodeInput(raw: string): string | null {
  const cleaned = raw.trim().replace(/\s+/g, '');
  if (cleaned.length < 4 || cleaned.length > 64) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(cleaned)) return null;
  return cleaned;
}

export function isPairingCodeFormat(raw: string): boolean {
  return normalizePairingCodeInput(raw) !== null;
}

/** Display: 6-digit numeric codes group as "123 456"; anything else is
 *  shown exactly as issued (never reformat a code the server chose). */
export function formatPairingCode(code: string): string {
  const digits = code.replace(/\D/g, '');
  if (digits.length === 6 && digits === code) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  return code;
}
