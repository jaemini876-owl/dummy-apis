import type { ZodIssue } from 'zod';
import type { ImportMode, Preset, PresetInput, Rule, RuleInput } from '../types.js';
import { importEnvelopeSchema, importRuleItemSchema, presetInputSchema, presetsEnvelopeSchema, ruleInputSchema } from './schemas.js';

/** index: 항목 번호(1부터). 0이면 파일 전체 수준의 문제 */
export interface ImportIssue {
  index: number;
  label: string | null;
  path: string;
  message: string;
}

export interface ImportSummary {
  create: number;
  update: number;
  delete: number;
}

const fmtPath = (p: PropertyKey[]) => p.map(String).join('.');
const fileIssue = (path: string, message: string): ImportIssue => ({ index: 0, label: null, path, message });
const zodIssues = (index: number, label: string | null, issues: ZodIssue[]): ImportIssue[] =>
  issues.map((i) => ({ index, label, path: fmtPath(i.path), message: i.message }));

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function envelopeIssues(error: { issues: ZodIssue[] }, listKey: string): ImportIssue[] {
  return error.issues.map((i) => {
    const path = fmtPath(i.path);
    const message = path === 'version' ? '지원하지 않는 형식입니다 (version 1 파일만 가져올 수 있습니다)' : path === listKey ? `"${listKey}" 배열이 필요합니다` : i.message;
    return fileIssue(path || '(파일)', message);
  });
}

export const nameKey = (s: string) => s.trim().toLowerCase();

// ---------- 규칙 ----------

/** 파일 형식(export 포맷) → ruleInputSchema 입력 */
function toRuleInputRaw(r: ReturnType<typeof importRuleItemSchema.parse>) {
  return {
    name: r.name ?? null,
    method: r.method,
    pathPattern: r.path,
    enabled: r.enabled,
    selectMode: r.selectMode,
    conditions: r.conditions,
    responses: (r.responses ?? []).map((x) => ({
      status: x.status,
      contentType: x.contentType,
      headers: x.headers,
      body: x.body,
      bodyBase64: x.bodyBase64,
      delayMinMs: x.delayMs?.[0],
      delayMaxMs: x.delayMs?.[1],
      weight: x.weight,
      conditions: x.conditions,
      fault: x.fault,
    })),
  };
}

/** 규칙 파일 전체를 검증한다. 문제가 하나라도 있으면 issues에 모두 모아 돌려준다(데이터는 건드리지 않음). */
export function parseRulesImport(body: unknown): { inputs: RuleInput[]; issues: ImportIssue[] } {
  const env = importEnvelopeSchema.safeParse(body);
  if (!env.success) {
    const rec = asRecord(body);
    // 프리셋 파일을 규칙 화면에 올린 경우 안내
    if (rec && (rec.kind === 'presets' || (Array.isArray(rec.presets) && rec.rules === undefined)))
      return { inputs: [], issues: [fileIssue('kind', '프리셋 파일입니다. 프리셋 화면에서 가져오세요')] };
    return { inputs: [], issues: envelopeIssues(env.error, 'rules') };
  }
  if (env.data.kind !== undefined && env.data.kind !== 'rules') {
    const msg = env.data.kind === 'presets' ? '프리셋 파일입니다. 프리셋 화면에서 가져오세요' : `지원하지 않는 파일 종류입니다 (kind: ${env.data.kind})`;
    return { inputs: [], issues: [fileIssue('kind', msg)] };
  }

  const inputs: RuleInput[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Map<string, number>();
  env.data.rules.forEach((raw, i) => {
    const index = i + 1;
    const rec = asRecord(raw);
    const label = rec && typeof rec.path === 'string' ? `${typeof rec.method === 'string' ? rec.method : 'GET'} ${rec.path}` : null;
    const item = importRuleItemSchema.safeParse(raw);
    if (!item.success) return void issues.push(...zodIssues(index, label, item.error.issues));
    const input = ruleInputSchema.safeParse(toRuleInputRaw(item.data));
    if (!input.success) return void issues.push(...zodIssues(index, label, input.error.issues));
    const key = `${input.data.method} ${input.data.pathPattern}`;
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push({ index, label: key, path: 'path', message: `#${first}번과 method+path가 같습니다 (한 파일에 중복 불가)` });
      return;
    }
    seen.set(key, index);
    inputs.push(input.data);
  });
  return { inputs, issues };
}

export function planRulesImport(inputs: RuleInput[], existing: Rule[], mode: ImportMode): ImportSummary {
  if (mode === 'replace') return { create: inputs.length, update: 0, delete: existing.length };
  const keys = new Set(existing.map((e) => `${e.method} ${e.pathPattern}`));
  const update = inputs.filter((i) => keys.has(`${i.method} ${i.pathPattern}`)).length;
  return { create: inputs.length - update, update, delete: 0 };
}

// ---------- 프리셋 ----------

export function parsePresetsImport(body: unknown): { inputs: PresetInput[]; issues: ImportIssue[] } {
  const env = presetsEnvelopeSchema.safeParse(body);
  if (!env.success) {
    const rec = asRecord(body);
    // 규칙 파일을 프리셋 화면에 올린 경우 안내
    if (rec && Array.isArray(rec.rules) && rec.kind !== 'presets')
      return { inputs: [], issues: [fileIssue('rules', '규칙 파일입니다. 프로젝트의 규칙 탭에서 가져오세요')] };
    return { inputs: [], issues: envelopeIssues(env.error, 'presets') };
  }
  if (env.data.kind !== undefined && env.data.kind !== 'presets') {
    const msg = env.data.kind === 'rules' ? '규칙 파일입니다. 프로젝트의 규칙 탭에서 가져오세요' : `지원하지 않는 파일 종류입니다 (kind: ${env.data.kind})`;
    return { inputs: [], issues: [fileIssue('kind', msg)] };
  }

  const inputs: PresetInput[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Map<string, number>();
  env.data.presets.forEach((raw, i) => {
    const index = i + 1;
    const rec = asRecord(raw);
    const label = rec && typeof rec.name === 'string' ? rec.name : null;
    const parsed = presetInputSchema.safeParse(raw);
    if (!parsed.success) return void issues.push(...zodIssues(index, label, parsed.error.issues));
    const key = nameKey(parsed.data.name);
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push({ index, label: parsed.data.name, path: 'name', message: `#${first}번과 이름이 같습니다 (대소문자 구분 없음, 한 파일에 중복 불가)` });
      return;
    }
    seen.set(key, index);
    inputs.push(parsed.data);
  });
  return { inputs, issues };
}

export function planPresetsImport(inputs: PresetInput[], existing: Preset[], mode: ImportMode): ImportSummary {
  if (mode === 'replace') return { create: inputs.length, update: 0, delete: existing.length };
  const keys = new Set(existing.map((e) => nameKey(e.name)));
  const update = inputs.filter((i) => keys.has(nameKey(i.name))).length;
  return { create: inputs.length - update, update, delete: 0 };
}
