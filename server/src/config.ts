import { z } from 'zod';

for (const f of ['.env', '../.env']) {
  try {
    process.loadEnvFile(f);
    break;
  } catch {
    /* no env file */
  }
}

const blank = (v: unknown) => (v === '' ? undefined : v);

const schema = z.object({
  PORT: z.preprocess(blank, z.coerce.number().default(3000)),
  SUPABASE_URL: z.preprocess(blank, z.string().url().optional()),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess(blank, z.string().optional()),
  PUBLIC_BASE_URL: z.preprocess(blank, z.string().url().optional()),
  LOG_RETENTION_DAYS: z.preprocess(blank, z.coerce.number().default(7)),
  LOG_MAX_PER_PROJECT: z.preprocess(blank, z.coerce.number().default(5000)),
  DATA_FILE: z.preprocess(blank, z.string().default('data/db.json')),
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (): Config => schema.parse(process.env);
