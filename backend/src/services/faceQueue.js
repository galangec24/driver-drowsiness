/**
 * Face recognition (face-api.js on TensorFlow WASM) is CPU-heavy and runs on the API's own thread.
 * Many cars identifying their driver at once, or parents enrolling photos, would otherwise run side
 * by side, use a lot of memory and slow every other request, including the 1 Hz ingest readings
 * that alerts depend on. So analyses run FACE_CONCURRENCY at a time (default 1); up to
 * FACE_QUEUE_MAX more wait their turn, and beyond that the caller gets 503 + Retry-After and tries
 * again (the in-car device already retries identify).
 */
const HttpError = require('../utils/httpError');

const MAX_ACTIVE = Math.max(1, Number(process.env.FACE_CONCURRENCY) || 1);
const MAX_WAITING = Math.max(0, Number(process.env.FACE_QUEUE_MAX ?? 8));
const RETRY_AFTER_S = 2;

let active = 0;
const waiting = [];

function next() {
  if (active >= MAX_ACTIVE || !waiting.length) return;
  active += 1;
  const { fn, resolve, reject } = waiting.shift();
  Promise.resolve()
    .then(fn)
    .then(resolve, reject)
    .finally(() => {
      active -= 1;
      next();
    });
}

/** Runs fn (returning a promise) when a slot is free. Rejects with 503 when the queue is full. */
function run(fn) {
  if (active >= MAX_ACTIVE && waiting.length >= MAX_WAITING) {
    return Promise.reject(
      new HttpError(503, 'Face recognition is busy. Try again in a moment.', {
        code: 'FACE_BUSY',
        retryAfterS: RETRY_AFTER_S,
      }),
    );
  }
  return new Promise((resolve, reject) => {
    waiting.push({ fn, resolve, reject });
    next();
  });
}

function stats() {
  return { active, waiting: waiting.length, maxActive: MAX_ACTIVE, maxWaiting: MAX_WAITING };
}

module.exports = { run, stats };
