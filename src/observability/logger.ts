import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'card.number',
      'card.cvv',
      'body.card.number',
      'body.card.cvv',
      'req.body.card.number',
      'req.body.card.cvv',
      'req.headers.authorization',
      'cardNumber',
      'cvv',
    ],
    censor: '[REDACTED_PCI_PII]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});
