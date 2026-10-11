/**
 * "Who is driving?" for the in-car device: compare the face in a camera frame with the enrolled
 * drivers of ONE family (the parent account the car belongs to), never with everybody's drivers.
 */
const { compare, euclidean, MATCH_DISTANCE } = require('./faceMatcher');

/** The runner-up must be at least this much further away, or the answer is "not sure" (twins). */
const MIN_MARGIN = 0.06;

/**
 * @param {{_id:any, name:string, faceEmbedding:number[]}[]} drivers enrolled drivers of one family
 * @param {number[]} descriptor 128-d descriptor of the face in the frame
 * @returns {{driverId:string|null, name?:string, confidence:number, reason?:'unknown'|'ambiguous', candidates?:string[]}}
 */
function pickDriver(drivers, descriptor) {
  const ranked = drivers
    .filter((d) => Array.isArray(d.faceEmbedding) && d.faceEmbedding.length)
    .map((d) => ({ d, distance: euclidean(d.faceEmbedding, descriptor) }))
    .sort((a, b) => a.distance - b.distance);
  const [best, second] = ranked;
  if (!best || best.distance >= MATCH_DISTANCE) {
    return { driverId: null, confidence: 0, reason: 'unknown' };
  }
  if (second && second.distance < MATCH_DISTANCE && second.distance - best.distance < MIN_MARGIN) {
    return {
      driverId: null,
      confidence: 0,
      reason: 'ambiguous',
      candidates: [best.d.name, second.d.name],
    };
  }
  const { confidence } = compare(best.d.faceEmbedding, descriptor);
  return { driverId: best.d._id.toString(), name: best.d.name, confidence };
}

module.exports = { pickDriver, MIN_MARGIN };
