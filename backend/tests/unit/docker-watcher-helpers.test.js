vi.mock('../../src/db', () => ({
  upsertRoute: vi.fn(),
  getAllRoutes: vi.fn(() => []),
  insertContainerEvent: vi.fn()
}));

const { sanitizeName, pickPort } = require('../../src/docker-watcher');

describe('sanitizeName', () => {
  it('is a function exported from docker-watcher', () => {
    expect(typeof sanitizeName).toBe('function');
  });

  it('strips a single leading slash (Docker container names look like "/myapp")', () => {
    expect(sanitizeName('/myapp')).toBe('myapp');
  });

  it('only strips ONE leading slash, not multiple', () => {
    expect(sanitizeName('//double')).toBe('/double');
  });

  it('does not strip a slash that is not at the start', () => {
    expect(sanitizeName('foo/bar')).toBe('foo/bar');
  });

  it('replaces every underscore with a dash', () => {
    expect(sanitizeName('my_long_name')).toBe('my-long-name');
  });

  it('replaces consecutive underscores with consecutive dashes (no collapse)', () => {
    expect(sanitizeName('a__b')).toBe('a--b');
  });

  it('lowercases the entire result', () => {
    expect(sanitizeName('MixedCase')).toBe('mixedcase');
  });

  it('combines all rules: leading slash + underscore + uppercase', () => {
    expect(sanitizeName('/My_App')).toBe('my-app');
  });

  it('returns an unchanged string for an already-clean lowercase name', () => {
    expect(sanitizeName('clean-name')).toBe('clean-name');
  });

  it('returns empty string for empty string input', () => {
    expect(sanitizeName('')).toBe('');
  });

  it('does NOT strip dots, hyphens, digits, or other special characters', () => {
    expect(sanitizeName('app-1.2.3')).toBe('app-1.2.3');
  });

  it('throws on null input (documented current behavior — not defensive)', () => {
    expect(() => sanitizeName(null)).toThrow();
  });

  it('throws on undefined input (documented current behavior)', () => {
    expect(() => sanitizeName(undefined)).toThrow();
  });
});

describe('pickPort', () => {
  it('is a function exported from docker-watcher', () => {
    expect(typeof pickPort).toBe('function');
  });

  it('returns null when Ports array is empty', () => {
    expect(pickPort({ Ports: [] })).toBeNull();
  });

  it('returns null when Ports is missing entirely (defaults to empty array)', () => {
    expect(pickPort({})).toBeNull();
  });

  it('returns the PublicPort of a single TCP entry', () => {
    expect(pickPort({ Ports: [{ Type: 'tcp', PublicPort: 8080 }] })).toBe(8080);
  });

  it('returns the LOWEST PublicPort across multiple TCP entries', () => {
    const ports = [
      { Type: 'tcp', PublicPort: 9000 },
      { Type: 'tcp', PublicPort: 3000 },
      { Type: 'tcp', PublicPort: 5000 }
    ];
    expect(pickPort({ Ports: ports })).toBe(3000);
  });

  it('ignores UDP entries even when their PublicPort is lower', () => {
    const ports = [
      { Type: 'udp', PublicPort: 53 },
      { Type: 'tcp', PublicPort: 80 }
    ];
    expect(pickPort({ Ports: ports })).toBe(80);
  });

  it('ignores TCP entries that lack a PublicPort (internal-only ports)', () => {
    const ports = [
      { Type: 'tcp', PrivatePort: 5432 },
      { Type: 'tcp', PublicPort: 9090 }
    ];
    expect(pickPort({ Ports: ports })).toBe(9090);
  });

  it('returns null when every entry is UDP', () => {
    const ports = [
      { Type: 'udp', PublicPort: 53 },
      { Type: 'udp', PublicPort: 67 }
    ];
    expect(pickPort({ Ports: ports })).toBeNull();
  });

  it('returns null when every TCP entry lacks PublicPort', () => {
    const ports = [
      { Type: 'tcp', PrivatePort: 5432 },
      { Type: 'tcp', PrivatePort: 6379 }
    ];
    expect(pickPort({ Ports: ports })).toBeNull();
  });

  it('handles mixed TCP+UDP correctly: lowest TCP PublicPort wins, UDP ignored', () => {
    const ports = [
      { Type: 'udp', PublicPort: 1 },
      { Type: 'tcp', PublicPort: 8000 },
      { Type: 'udp', PublicPort: 2 },
      { Type: 'tcp', PublicPort: 4000 }
    ];
    expect(pickPort({ Ports: ports })).toBe(4000);
  });

  it('does NOT mutate the input Ports array', () => {
    const ports = [
      { Type: 'tcp', PublicPort: 9000 },
      { Type: 'tcp', PublicPort: 3000 }
    ];
    const snapshot = JSON.parse(JSON.stringify(ports));
    pickPort({ Ports: ports });
    expect(ports).toEqual(snapshot);
  });
});
