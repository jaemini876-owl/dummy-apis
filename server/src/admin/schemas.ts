import { z } from 'zod';
import { validatePattern } from '../mock/matcher.js';
import { DEFAULT_SETTINGS, type RuleInput } from '../types.js';

export const conditionSchema = z.object({
  source: z.enum(['query', 'header', 'body', 'path']),
  key: z.string().min(1),
  op: z.enum(['eq', 'neq', 'contains', 'regex', 'exists']),
  value: z.string().optional(),
});

export const responseSchema = z.object({
  id: z.string().optional(),
  position: z.number().int().default(0),
  weight: z.number().int().min(0).default(1),
  conditions: z.array(conditionSchema).default([]),
  status: z.number().int().min(200).max(599).default(200),
  headers: z.record(z.string(), z.string()).default({}),
  contentType: z.string().min(1).default('application/json'),
  body: z.string().nullable().default(null),
  bodyBase64: z.string().nullable().default(null),
  delayMinMs: z.number().int().min(0).max(120000).default(0),
  delayMaxMs: z.number().int().min(0).max(120000).default(0),
  fault: z.enum(['timeout', 'reset', 'truncate', 'invalid_json']).nullable().default(null),
});

export const ruleInputSchema = z
  .object({
    name: z.string().nullable().default(null),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY']).default('GET'),
    pathPattern: z.string(),
    enabled: z.boolean().default(true),
    selectMode: z.enum(['fixed', 'sequential', 'weighted', 'conditional']).default('fixed'),
    conditions: z.array(conditionSchema).default([]),
    responses: z.array(responseSchema).default([]),
  })
  .superRefine((v, ctx) => {
    const err = validatePattern(v.pathPattern);
    if (err) ctx.addIssue({ code: 'custom', path: ['pathPattern'], message: err });
  })
  .transform((v): RuleInput => {
    const responses = (v.responses.length ? v.responses : [responseSchema.parse({ body: '{}' })]).map((r, i) => ({
      ...r,
      position: i,
      delayMaxMs: Math.max(r.delayMaxMs, r.delayMinMs),
    }));
    return { ...v, responses };
  });

export const settingsSchema = z
  .object({
    extraDelayMs: z.number().int().min(0).max(120000),
    errorRate: z.number().min(0).max(100),
    errorStatus: z.number().int().min(200).max(599),
    loop: z.boolean(),
    cors: z.boolean(),
    unmatchedStatus: z.number().int().min(200).max(599),
  })
  .partial()
  .transform((v) => ({ ...DEFAULT_SETTINGS, ...v }));

export const RESERVED_SLUGS = new Set(['m', '__admin', 'healthz', 'admin', 'api']);

export const projectCreateSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}$/, '영소문자/숫자/하이픈 2~39자')
    .refine((s) => !RESERVED_SLUGS.has(s), '예약된 slug입니다'),
  name: z.string().min(1).max(80),
  settings: settingsSchema.optional(),
});

export const projectPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  settings: settingsSchema.optional(),
});

/** import/export 포맷 (version 1) */
export const importSchema = z.object({
  version: z.literal(1),
  rules: z.array(
    z.object({
      name: z.string().nullable().optional(),
      method: z.string().default('GET'),
      path: z.string(),
      enabled: z.boolean().optional(),
      selectMode: z.string().optional(),
      conditions: z.array(conditionSchema).optional(),
      responses: z
        .array(
          z.object({
            status: z.number().optional(),
            contentType: z.string().optional(),
            headers: z.record(z.string(), z.string()).optional(),
            body: z.string().nullable().optional(),
            bodyBase64: z.string().nullable().optional(),
            delayMs: z.tuple([z.number(), z.number()]).optional(),
            weight: z.number().optional(),
            conditions: z.array(conditionSchema).optional(),
            fault: z.string().nullable().optional(),
          }),
        )
        .optional(),
    }),
  ),
});
