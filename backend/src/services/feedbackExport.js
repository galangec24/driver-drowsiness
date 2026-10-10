const fs = require('fs');
const path = require('path');
const Alert = require('../models/Alert');
const Driver = require('../models/Driver');
const { resolveThresholds } = require('./fusionEngine');

/**
 * Write parent-labelled alerts ("False alarm" / confirmed real) as JSONL for ml/scripts/train.py.
 * Each line: { alertId, driverId, type, createdAt, falseAlarm, thresholds, verifier: { score, window } }.
 * `window` holds the raw 30-tick signal window seen at alert time. Only signals and ids, no
 * names or photos. Uses the current mongoose connection.
 * @returns {{ out:string, labelled:number, falseAlarms:number, withWindow:number }}
 */
async function exportFeedback(out) {
  const alerts = await Alert.find({ 'feedback.falseAlarm': { $exists: true } })
    .select('+verifier')
    .sort({ createdAt: 1 })
    .lean();
  const ids = [...new Set(alerts.map((a) => a.driverId.toString()))];
  const drivers = new Map(
    (await Driver.find({ _id: { $in: ids } }).lean()).map((d) => [d._id.toString(), d]),
  );
  const lines = alerts.map((a) =>
    JSON.stringify({
      alertId: a._id.toString(),
      driverId: a.driverId.toString(),
      type: a.type,
      createdAt: a.createdAt,
      falseAlarm: a.feedback.falseAlarm,
      thresholds: resolveThresholds(drivers.get(a.driverId.toString())),
      verifier: a.verifier || null,
    }),
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n') + (lines.length ? '\n' : ''));
  return {
    out,
    labelled: alerts.length,
    falseAlarms: alerts.filter((a) => a.feedback.falseAlarm).length,
    withWindow: alerts.filter((a) => a.verifier && a.verifier.window).length,
  };
}

module.exports = { exportFeedback };
