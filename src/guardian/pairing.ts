/** Pairing-code helpers (V1.1 Phase 1). Pure functions, unit-tested.
 *
 * Codes are 6-digit, generated SERVER-side by the `create_pairing_code`
 * RPC (the raw code is returned once; only its SHA-256 hash is stored).
 * These helpers only format user input/display on the client.
 */

/** "123 456" / "123-456" / "123456" -> "123456"; anything else -> null. */
export function normalizePairingCodeInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
}

export function isPairingCodeFormat(raw: string): boolean {
  return normalizePairingCodeInput(raw) !== null;
}

/** Display grouping: "123456" -> "123 456". Non-6-digit input passes through. */
export function formatPairingCode(code: string): string {
  const digits = code.replace(/\D/g, '');
  if (digits.length !== 6) return code;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}
