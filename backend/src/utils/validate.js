const HttpError = require('./httpError');

/** Express middleware: parse req[part] with a zod schema, replacing it with the parsed value. */
function validate(schema, part = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(new HttpError(400, 'Invalid request', result.error.flatten()));
    }
    req[part === 'body' ? 'body' : `valid${part[0].toUpperCase()}${part.slice(1)}`] = result.data;
    return next();
  };
}

module.exports = validate;
