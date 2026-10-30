import { formatPairingCode, isPairingCodeFormat, normalizePairingCodeInput } from '../pairing';

describe('pairing code input handling', () => {
  it('accepts plain, spaced, and dashed 6-digit codes', () => {
    expect(normalizePairingCodeInput('123456')).toBe('123456');
    expect(normalizePairingCodeInput('123 456')).toBe('123456');
    expect(normalizePairingCodeInput('123-456')).toBe('123456');
    expect(isPairingCodeFormat(' 123 456 ')).toBe(true);
  });

  it('rejects wrong lengths and non-codes', () => {
    expect(normalizePairingCodeInput('12345')).toBeNull();
    expect(normalizePairingCodeInput('1234567')).toBeNull();
    expect(normalizePairingCodeInput('abcdef')).toBeNull();
    expect(normalizePairingCodeInput('')).toBeNull();
    expect(isPairingCodeFormat('12')).toBe(false);
  });

  it('formats for display as two groups of three', () => {
    expect(formatPairingCode('123456')).toBe('123 456');
    expect(formatPairingCode('000001')).toBe('000 001');
    expect(formatPairingCode('xyz')).toBe('xyz');
  });
});
