import { z } from 'zod';
import { validatePattern } from '../mock/matcher.js';
import { DEFAULT_SETTINGS, type PresetInput, type RuleInput } from '../types.js';

export const conditionSchema = z.object({
  source: z.enum(['query', 'header', 'body', 'path']),
  key: z.string().min(1),
  op: z.enum(['eq', 'neq', 'contains', 'regex', 'exists']),
  value: z.string().optional(),
});

// 바이너리 응답 한도 2MB (base64는 4/3 증가)
const bodyBase64Schema = z
  .string()
  .max(Math.ceil((2 * 1024 * 1024 * 4) / 3) + 4, '바이너리 응답은 2MB 이하여야 합니다')
  .nullable()
  .default(null);

export const responseSchema = z.object({
  id: z.string().optional(),
  position: z.number().int().default(0),
  weight: z.number().int().min(0).default(1),
  conditions: z.array(conditionSchema).default([]),
  status: z.number().int().min(200).max(599).default(200),
  headers: z.record(z.string(), z.string()).default({}),
  contentType: z.string().min(1).default('application/json'),
  body: z.string().nullable().default(null),
  bodyBase64: bodyBase64Schema,
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

/**
 * import/export 포맷 (version 1).
 * 메타 필드(kind, exportedAt, project)는 선택이며 알 수 없는 필드는 무시한다(전방 호환).
 * 규칙 항목은 개별로 검증해 어느 항목의 어느 필드가 문제인지 알려준다(importing.ts).
 */
export const importEnvelopeSchema = z.object({
  version: z.literal(1),
  kind: z.string().optional(),
  rules: z.array(z.unknown()),
});

export const importRuleItemSchema = z.object({
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
});

/** 응답 프리셋: content-type + headers + body(또는 bodyBase64). body와 bodyBase64는 택일(둘 다 있으면 바이너리 우선). */
export const presetInputSchema = z
  .object({
    name: z.string().trim().min(1, '이름을 입력하세요').max(80, '이름은 80자 이하여야 합니다'),
    contentType: z.string().min(1).default('application/json'),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().nullable().default(null),
    bodyBase64: bodyBase64Schema,
  })
  .transform((v): PresetInput => (v.bodyBase64 ? { ...v, body: null } : v));

/** 프리셋 import/export 포맷 (version 1, kind: 'presets') */
export const presetsEnvelopeSchema = z.object({
  version: z.literal(1),
  kind: z.string().optional(),
  presets: z.array(z.unknown()),
});
