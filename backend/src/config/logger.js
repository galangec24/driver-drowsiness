const pino = require('pino');
const { env } = require('./env');

const isTest = env.nodeEnv === 'test';
const isDev = env.nodeEnv === 'development';

const logger = pino({
  level: process.env.LOG_LEVEL || (isTest ? 'silent' : 'info'),
  redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
    },
  }),
});

module.exports = logger;
