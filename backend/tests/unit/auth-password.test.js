const pw = require('../../src/auth/password');

describe('password hashing', () => {
  it('round-trips and rejects the wrong password', async () => {
    const h = await pw.hashPassword('correct horse');
    expect(await pw.verifyPassword('correct horse', h)).toBe(true);
    expect(await pw.verifyPassword('correct horsf', h)).toBe(false);
  });

  // `$` in a .env value is interpolated by docker compose unless quoted; the
  // format avoids it entirely so a pasted hash always survives.
  it('uses a self-describing format with no $ characters', async () => {
    const h = await pw.hashPassword('correct horse');
    expect(h).toMatch(/^scrypt:32768:8:1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(h).not.toContain('$');
  });

  it('salts: the same password hashes differently each time', async () => {
    expect(await pw.hashPassword('same')).not.toBe(await pw.hashPassword('same'));
  });

  it('treats malformed or weak hashes as never matching', async () => {
    for (const bad of ['', 'nope', 'scrypt:1024:8:1:AAAA:BBBB', 'bcrypt:1:2:3:4:5', null, undefined]) {
      expect(pw.isValidHash(bad)).toBe(false);
      expect(await pw.verifyPassword('x', bad)).toBe(false);
    }
  });
});

describe('failed-login throttle', () => {
  beforeEach(() => pw.resetAttempts());

  it('locks after 5 failures within 5 minutes and reports the wait', () => {
    for (let i = 0; i < 4; i++) pw.recordFailure(1000);
    expect(pw.lockedFor(1000)).toBe(0);
    pw.recordFailure(1000);
    expect(pw.lockedFor(1000)).toBe(301);
    expect(pw.lockedFor(1000 + 299_000)).toBe(2);
  });

  it('unlocks once the oldest failure leaves the window, and on reset', () => {
    for (let i = 0; i < 5; i++) pw.recordFailure(1000);
    expect(pw.lockedFor(1000 + 300_000)).toBe(0);
    for (let i = 0; i < 5; i++) pw.recordFailure(2000);
    pw.resetAttempts();
    expect(pw.lockedFor(2000)).toBe(0);
  });
});
