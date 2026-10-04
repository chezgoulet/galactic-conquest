// Environment config, validated with zod. Every variable has a sensible default
// for dev; production-required values are only enforced when NODE_ENV=production.
import { z } from 'zod';

const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8787),
  HOST: z.string().default('0.0.0.0'),
  SECRET_KEY: z.string().min(16).default('dev-secret-change-me-0123456789'),
  // Database: when DATABASE_URL is set we use Postgres, else an in-memory PGlite.
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().optional(),
  // TURN (coturn use-auth-secret). Required in production, optional in dev.
  TURN_SECRET: z.string().optional(),
  TURN_URLS: z.string().default('turn:turn.example:3478?transport=udp'),
  TURN_DOMAIN: z.string().default('turn.example'),
  // Public base URL of the service (used in hand-off links, etc.)
  PUBLIC_URL: z.string().default('http://localhost:8787'),
  DOMAIN: z.string().default('localhost'),
  // Rate limiting
  RATE_LIMIT: z.coerce.number().int().default(120),
  // Membership (present but OFF by default, per the locked decision)
  MEMBERSHIP_ENABLED: z.enum(['0', '1']).default('0'),
  TRUST_PROXY: z.enum(['0', '1']).default('0'),
  APP_VERSION: z.string().optional(),
});

export function loadConfig(env = process.env) {
  const p = base.parse(env);
  const isProd = p.NODE_ENV === 'production';
  if (isProd) {
    if (!p.DATABASE_URL) throw new Error('production requires DATABASE_URL');
    if (!p.TURN_SECRET) throw new Error('production requires TURN_SECRET');
    if (p.SECRET_KEY.startsWith('dev-secret')) throw new Error('production requires a real SECRET_KEY');
  }
  return {
    ...p,
    isProd,
    isTest: p.NODE_ENV === 'test',
    dbMode: p.DATABASE_URL ? 'postgres' : 'pglite',
    version: p.APP_VERSION || '0.1.0',
  };
}
