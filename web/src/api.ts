export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ANY';
export const METHODS: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY'];

export interface Condition {
  source: 'query' | 'header' | 'body' | 'path';
  key: string;
  op: 'eq' | 'neq' | 'contains' | 'regex' | 'exists';
  value?: string;
}
export interface ResponseDef {
  id?: string;
  position: number;
  weight: number;
  conditions: Condition[];
  status: number;
  headers: Record<string, string>;
  contentType: string;
  body: string | null;
  bodyBase64: string | null;
  delayMinMs: number;
  delayMaxMs: number;
  fault: 'timeout' | 'reset' | 'truncate' | 'invalid_json' | null;
}
export interface Rule {
  id: string;
  name: string | null;
  method: Method;
  pathPattern: string;
  enabled: boolean;
  selectMode: 'fixed' | 'sequential' | 'weighted' | 'conditional';
  conditions: Condition[];
  responses: ResponseDef[];
}
export type RuleInput = Omit<Rule, 'id'>;
export interface Settings {
  extraDelayMs: number;
  errorRate: number;
  errorStatus: number;
  loop: boolean;
  cors: boolean;
  unmatchedStatus: number;
}
export interface Project {
  id: string;
  slug: string;
  name: string;
  settings: Settings;
}
export interface LogEntry {
  id: string;
  ruleId: string | null;
  matched: boolean;
  method: string;
  path: string;
  query: Record<string, string>;
  reqHeaders: Record<string, string>;
  reqBody: string | null;
  status: number | null;
  resBody: string | null;
  latencyMs: number;
  createdAt: string;
}
/** 응답 내용(content-type/headers/body)만 담은 전역 프리셋. 적용하면 응답으로 복사된다. */
export interface Preset {
  id: string;
  name: string;
  contentType: string;
  headers: Record<string, string>;
  body: string | null;
  bodyBase64: string | null;
  createdAt: string;
  updatedAt: string;
}
export type PresetInput = Omit<Preset, 'id' | 'createdAt' | 'updatedAt'>;

export type ImportMode = 'merge' | 'replace';
export interface ImportIssue {
  index: number; // 0이면 파일 전체 수준
  label: string | null;
  path: string;
  message: string;
}
export interface ImportReport {
  ok: boolean;
  mode: ImportMode;
  summary: { create: number; update: number; delete: number };
  issues: ImportIssue[];
}
export interface ImportDone {
  created: number;
  updated: number;
  deleted: number;
}

export interface ServerInfo {
  version: string;
  port: number;
  publicBaseUrl: string | null;
  requestOrigin: string;
  lanIps: string[];
  storage: 'supabase' | 'file';
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const BASE = '/__admin/api';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.details) ? data.details.map((d: any) => `${d.path?.join('.')}: ${d.message}`).join(', ') : '';
    throw new ApiError(res.status, [data.message ?? res.statusText, detail].filter(Boolean).join(' — '), data.details);
  }
  return data as T;
}

export const api = {
  projects: () => req<Project[]>('GET', '/projects'),
  createProject: (b: { slug: string; name: string }) => req<Project>('POST', '/projects', b),
  patchProject: (pid: string, b: Partial<{ name: string; settings: Settings }>) => req<Project>('PATCH', `/projects/${pid}`, b),
  deleteProject: (pid: string) => req<void>('DELETE', `/projects/${pid}`),
  rules: (pid: string) => req<Rule[]>('GET', `/projects/${pid}/rules`),
  createRule: (pid: string, b: RuleInput) => req<Rule>('POST', `/projects/${pid}/rules`, b),
  saveRule: (pid: string, rid: string, b: RuleInput) => req<Rule>('PUT', `/projects/${pid}/rules/${rid}`, b),
  deleteRule: (pid: string, rid: string) => req<void>('DELETE', `/projects/${pid}/rules/${rid}`),
  duplicateRule: (pid: string, rid: string) => req<Rule>('POST', `/projects/${pid}/rules/${rid}/duplicate`),
  toggleRule: (pid: string, rid: string, enabled: boolean) => req<Rule>('PATCH', `/projects/${pid}/rules/${rid}/enabled`, { enabled }),
  resetCounter: (pid: string, rid: string) => req<void>('POST', `/projects/${pid}/rules/${rid}/reset-counter`),
  exportRules: (pid: string) => req<unknown>('GET', `/projects/${pid}/export`),
  previewImportRules: (pid: string, data: unknown, mode: ImportMode) =>
    req<ImportReport>('POST', `/projects/${pid}/import?mode=${mode}&dryRun=true`, data),
  importRules: (pid: string, data: unknown, mode: ImportMode) => req<ImportDone>('POST', `/projects/${pid}/import?mode=${mode}`, data),
  presets: () => req<Preset[]>('GET', '/presets'),
  createPreset: (b: PresetInput) => req<Preset>('POST', '/presets', b),
  updatePreset: (id: string, b: PresetInput) => req<Preset>('PUT', `/presets/${id}`, b),
  deletePreset: (id: string) => req<void>('DELETE', `/presets/${id}`),
  exportPresets: () => req<unknown>('GET', '/presets/export'),
  previewImportPresets: (data: unknown, mode: ImportMode) => req<ImportReport>('POST', `/presets/import?mode=${mode}&dryRun=true`, data),
  importPresets: (data: unknown, mode: ImportMode) => req<ImportDone>('POST', `/presets/import?mode=${mode}`, data),
  logs: (pid: string, matched?: boolean) => req<LogEntry[]>('GET', `/projects/${pid}/logs?limit=200${matched === undefined ? '' : `&matched=${matched}`}`),
  clearLogs: (pid: string) => req<void>('DELETE', `/projects/${pid}/logs`),
  logToRule: (pid: string, lid: string) => req<Rule>('POST', `/projects/${pid}/logs/${lid}/to-rule`, {}),
  serverInfo: () => req<ServerInfo>('GET', '/server-info'),
};

export const emptyResponse = (): ResponseDef => ({
  position: 0, weight: 1, conditions: [], status: 200, headers: {}, contentType: 'application/json',
  body: '{}', bodyBase64: null, delayMinMs: 0, delayMaxMs: 0, fault: null,
});
export const emptyRule = (): RuleInput => ({
  name: null, method: 'GET', pathPattern: '/', enabled: true, selectMode: 'fixed', conditions: [], responses: [emptyResponse()],
});

export const STATUS_PRESETS: [number, string][] = [
  [200, 'OK'], [201, 'Created'], [204, 'No Content'], [301, 'Moved'], [304, 'Not Modified'],
  [400, 'Bad Request'], [401, 'Unauthorized'], [403, 'Forbidden'], [404, 'Not Found'], [409, 'Conflict'],
  [422, 'Unprocessable'], [429, 'Too Many Requests'], [500, 'Server Error'], [502, 'Bad Gateway'], [503, 'Unavailable'], [504, 'Gateway Timeout'],
];
