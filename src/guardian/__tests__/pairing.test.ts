/**
 * Invite-code input handling — DEPLOYED contract. (Updated from the old
 * 6-digit-only tests: the deployed Edge Function chooses the code
 * format, so the client accepts plausible tokens instead of enforcing
 * exactly 6 digits. See docs/SUPABASE_INTEGRATION.md.)
 */
import { formatPairingCode, isPairingCodeFormat, normalizePairingCodeInput } from '../pairing';

describe('invite code input handling', () => {
  it('accepts numeric and alphanumeric codes, strips grouping spaces', () => {
    expect(normalizePairingCodeInput('123456')).toBe('123456');
    expect(normalizePairingCodeInput('123 456')).toBe('123456');
    expect(normalizePairingCodeInput('  XY29-KD  ')).toBe('XY29-KD');
    expect(normalizePairingCodeInput('aB3dEf9')).toBe('aB3dEf9'); // case preserved
    expect(isPairingCodeFormat('1234')).toBe(true);
  });

  it('rejects empty, too short, and non-token input', () => {
    expect(normalizePairingCodeInput('')).toBeNull();
    expect(normalizePairingCodeInput('ab1')).toBeNull();
    expect(normalizePairingCodeInput('code with spaces!')).toBeNull();
    expect(normalizePairingCodeInput('x'.repeat(65))).toBeNull();
    expect(isPairingCodeFormat('!!')).toBe(false);
  });

  it('formats only pure 6-digit codes for display; others pass through', () => {
    expect(formatPairingCode('123456')).toBe('123 456');
    expect(formatPairingCode('000001')).toBe('000 001');
    expect(formatPairingCode('XY29-KD')).toBe('XY29-KD');
    expect(formatPairingCode('1234567')).toBe('1234567');
  });
});
