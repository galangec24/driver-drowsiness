const { compare, euclidean, distanceToConfidence, MATCH_DISTANCE } = require('./faceMatcher');

const vec = (fill) => new Array(128).fill(fill);

describe('faceMatcher', () => {
  test('identical descriptors → match with confidence 1', () => {
    expect(compare(vec(0.1), vec(0.1))).toEqual({ match: true, confidence: 1, distance: 0 });
  });

  test('distant descriptors → no match', () => {
    const r = compare(vec(0), vec(0.2));
    expect(r.match).toBe(false);
    expect(r.confidence).toBe(0);
  });

  test('confidence is 0.5 at the match boundary and monotonic', () => {
    expect(distanceToConfidence(MATCH_DISTANCE)).toBeCloseTo(0.5);
    expect(distanceToConfidence(0.2)).toBeGreaterThan(distanceToConfidence(0.4));
  });

  test('mismatched or missing vectors never match', () => {
    expect(euclidean([1, 2], [1])).toBe(Infinity);
    expect(compare(undefined, vec(0))).toMatchObject({
      match: false,
      confidence: 0,
      distance: null,
    });
    expect(compare([], [])).toMatchObject({ match: false });
  });
});
