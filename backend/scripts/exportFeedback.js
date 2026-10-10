/**
 * Export parent-labelled alerts ("False alarm" / confirmed) for retraining the verifier.
 *   npm run export:feedback            → ../ml/data/feedback/alerts.jsonl
 *   npm run export:feedback -- out.jsonl
 * The admin console's "Train verifier" job does this automatically (src/services/feedbackExport.js).
 */
const path = require('path');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const logger = require('../src/config/logger');
const { exportFeedback } = require('../src/services/feedbackExport');

async function main() {
  const out = path.resolve(
    process.argv[2] || path.join(__dirname, '../../ml/data/feedback/alerts.jsonl'),
  );
  await mongoose.connect(env.mongoUri);
  const result = await exportFeedback(out);
  logger.info(result, 'feedback exported');
  await mongoose.disconnect();
}

main().catch((err) => {
  logger.fatal({ err: err.message }, 'export failed');
  process.exit(1);
});
