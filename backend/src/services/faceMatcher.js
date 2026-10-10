/**
 * Compares 128-d face descriptors. Euclidean distance < MATCH_DISTANCE is the same person
 * (face-api.js recognition model is trained so ~0.6 separates identities).
 */
const MATCH_DISTANCE = 0.55;

function euclidean(a, b) {
  if (!Array.isArray(a) && !(a instanceof Float32Array)) return Infinity;
  if (!b || a.length !== b.length || a.length === 0) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Map distance to a 0..1 confidence: 0 → 1.0, MATCH_DISTANCE → 0.5, 2×MATCH_DISTANCE → 0. */
function distanceToConfidence(distance) {
  if (!Number.isFinite(distance)) return 0;
  return Math.max(0, Math.min(1, 1 - distance / (2 * MATCH_DISTANCE)));
}

function compare(stored, incoming) {
  const distance = euclidean(stored, incoming);
  return {
    match: distance < MATCH_DISTANCE,
    confidence: Math.round(distanceToConfidence(distance) * 1000) / 1000,
    distance: Number.isFinite(distance) ? Math.round(distance * 1000) / 1000 : null,
  };
}

module.exports = { compare, euclidean, distanceToConfidence, MATCH_DISTANCE };
