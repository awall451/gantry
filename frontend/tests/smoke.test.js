describe('smoke', () => {
  it('vitest runs in jsdom', () => {
    expect(typeof window).toBe('object');
    expect(1 + 1).toBe(2);
  });
});
