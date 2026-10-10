const mongoose = require('mongoose');
const logger = require('../config/logger');
const HttpError = require('../utils/httpError');

function notFound(req, _res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.path}`));
}

function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err instanceof mongoose.Error.CastError) {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Payload too large';
  } else if (err.code === 11000) {
    status = 409;
    message = 'Duplicate value';
    details = err.keyValue ? Object.keys(err.keyValue) : undefined;
  }

  if (status >= 500) {
    logger.error({ err, path: req.path }, 'unhandled error');
    message = 'Internal server error';
    details = undefined;
  }

  // Never return stack traces.
  res.status(status).json({ error: message, ...(details && { details }) });
}

module.exports = { notFound, errorHandler, HttpError };
