const totp = require('../../src/auth/totp');

// RFC 6238 appendix B, SHA-1, secret = ASCII "12345678901234567890".
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
  [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 test vectors (8 digits) and their 6-digit tails', () => {
    for (const [t, code] of RFC) {
      expect(totp.codeAt(RFC_SECRET, t * 1000, { digits: 8 }), `T=${t}`).toBe(code);
      expect(totp.codeAt(RFC_SECRET, t * 1000), `T=${t}`).toBe(code.slice(2));
    }
  });

  it('base32 round-trips and tolerates spaces, lower case and padding', () => {
    const s = totp.newSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/); // 20 random bytes
    expect(totp.isValidSecret(s.toLowerCase().replace(/(.{4})/g, '$1 ') + '====')).toBe(true);
    expect(totp.codeAt(s.toLowerCase(), 0)).toBe(totp.codeAt(s, 0));
  });

  it('rejects malformed or short secrets', () => {
    for (const bad of ['', 'not base32!', 'ABC', null, undefined, 'A1B8C9']) expect(totp.isValidSecret(bad), String(bad)).toBe(false);
  });

  it('accepts the previous, current and next 30 s step only', () => {
    const now = 1_700_000_000_000;
    const v = totp.verifier();
    expect(v.check(RFC_SECRET, totp.codeAt(RFC_SECRET, now - 30_000), now)).toBe(true);
    const w = totp.verifier();
    expect(w.check(RFC_SECRET, totp.codeAt(RFC_SECRET, now + 30_000), now)).toBe(true);
    const x = totp.verifier();
    expect(x.check(RFC_SECRET, totp.codeAt(RFC_SECRET, now - 90_000), now)).toBe(false);
    expect(x.check(RFC_SECRET, '000000x', now)).toBe(false);
    expect(x.check(RFC_SECRET, '', now)).toBe(false);
  });

  it('a code is single use: the same step, or any older one, is refused after a success', () => {
    const now = 1_700_000_000_000;
    const v = totp.verifier();
    const code = totp.codeAt(RFC_SECRET, now);
    expect(v.check(RFC_SECRET, code, now)).toBe(true);
    expect(v.check(RFC_SECRET, code, now + 5_000)).toBe(false);
    expect(v.check(RFC_SECRET, totp.codeAt(RFC_SECRET, now - 30_000), now + 5_000)).toBe(false);
    expect(v.check(RFC_SECRET, totp.codeAt(RFC_SECRET, now + 30_000), now + 30_000)).toBe(true);
  });

  it('accepts codes typed with spaces ("123 456")', () => {
    const now = 1_700_000_000_000;
    const c = totp.codeAt(RFC_SECRET, now);
    expect(totp.verifier().check(RFC_SECRET, `${c.slice(0, 3)} ${c.slice(3)}`, now)).toBe(true);
  });

  it('builds an otpauth URI authenticator apps understand', () => {
    const uri = totp.otpauthUri(RFC_SECRET, { account: 'admin@box', issuer: 'Gantry' });
    expect(uri).toBe(`otpauth://totp/Gantry:admin%40box?secret=${RFC_SECRET}&issuer=Gantry&algorithm=SHA1&digits=6&period=30`);
  });
});
