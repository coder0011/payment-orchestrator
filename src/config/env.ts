import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DEFAULT_HEALTH_FLOOR: z.coerce.number().min(0).max(1).default(0.85),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEFAULT_MERCHANT_COUNTRY: z.string().default('US'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const env: EnvConfig = envSchema.parse({
  PORT: process.env['PORT'],
  HOST: process.env['HOST'],
  NODE_ENV: process.env['NODE_ENV'],
  DEFAULT_HEALTH_FLOOR: process.env['DEFAULT_HEALTH_FLOOR'],
  LOG_LEVEL: process.env['LOG_LEVEL'],
  DEFAULT_MERCHANT_COUNTRY: process.env['DEFAULT_MERCHANT_COUNTRY'],
});
