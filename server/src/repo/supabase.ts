import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ConflictError, MigrationRequiredError } from '../errors.js';
import {
  DEFAULT_SETTINGS,
  type ImportMode,
  type ImportResult,
  type LogEntry,
  type Preset,
  type PresetInput,
  type Project,
  type ProjectSettings,
  type ResponseDef,
  type Rule,
  type RuleInput,
} from '../types.js';
import type { LogQuery, Repo } from './repo.js';

type Row = Record<string, any>;

// PGRST205: PostgREST 스키마 캐시에 테이블 없음, 42P01: undefined_table
const TABLE_MISSING = new Set(['PGRST205', '42P01']);

function unwrap<T>(res: { data: T | null; error: { code?: string; message: string } | null }): T {
  if (res.error) {
    if (res.error.code === '23505') throw new ConflictError(res.error.message);
    if (res.error.code && TABLE_MISSING.has(res.error.code))
      throw new MigrationRequiredError(`DB 마이그레이션이 필요합니다 (supabase/migrations/0003_presets.sql, 0004_import_rules_rpc.sql 적용): ${res.error.message}`);
    throw new Error(res.error.message);
  }
  return res.data as T;
}

const toPreset = (r: Row): Preset => ({
  id: r.id,
  name: r.name,
  contentType: r.content_type,
  headers: r.headers ?? {},
  body: r.body,
  bodyBase64: r.body_base64,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const fromPreset = (p: PresetInput) => ({
  name: p.name,
  content_type: p.contentType,
  headers: p.headers,
  body: p.body,
  body_base64: p.bodyBase64,
});

const toProject = (r: Row): Project => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) },
  ownerId: r.owner_id,
  createdAt: r.created_at,
});

const toResponse = (r: Row): ResponseDef => ({
  id: r.id,
  position: r.position,
  weight: r.weight,
  conditions: r.conditions ?? [],
  status: r.status,
  headers: r.headers ?? {},
  contentType: r.content_type,
  body: r.body,
  bodyBase64: r.body_base64,
  delayMinMs: r.delay_min_ms,
  delayMaxMs: r.delay_max_ms,
  fault: r.fault,
});

const fromResponse = (ruleId: string, r: ResponseDef) => ({
  rule_id: ruleId,
  position: r.position,
  weight: r.weight,
  conditions: r.conditions,
  status: r.status,
  headers: r.headers,
  content_type: r.contentType,
  body: r.body,
  body_base64: r.bodyBase64,
  delay_min_ms: r.delayMinMs,
  delay_max_ms: r.delayMaxMs,
  fault: r.fault,
});

const toRule = (r: Row, responses: Row[]): Rule => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  method: r.method,
  pathPattern: r.path_pattern,
  enabled: r.enabled,
  selectMode: r.select_mode,
  conditions: r.conditions ?? [],
  responses: responses.filter((x) => x.rule_id === r.id).sort((a, b) => a.position - b.position).map(toResponse),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toLog = (r: Row): LogEntry => ({
  id: r.id,
  projectId: r.project_id,
  ruleId: r.rule_id,
  responseId: r.response_id,
  matched: r.matched,
  method: r.method,
  path: r.path,
  query: r.query ?? {},
  reqHeaders: r.req_headers ?? {},
  reqBody: r.req_body,
  status: r.status,
  resBody: r.res_body,
  latencyMs: r.latency_ms,
  createdAt: r.created_at,
});

export class SupabaseRepo implements Repo {
  private db: SupabaseClient;
  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async listProjects() {
    return unwrap(await this.db.from('projects').select('*').order('created_at')).map(toProject);
  }
  async getProject(id: string) {
    const r = unwrap(await this.db.from('projects').select('*').eq('id', id).maybeSingle());
    return r ? toProject(r) : null;
  }
  async getProjectBySlug(slug: string) {
    const r = unwrap(await this.db.from('projects').select('*').eq('slug', slug).maybeSingle());
    return r ? toProject(r) : null;
  }
  async createProject(input: { slug: string; name: string; settings: ProjectSettings }) {
    return toProject(unwrap(await this.db.from('projects').insert(input).select('*').single()));
  }
  async updateProject(id: string, patch: { name?: string; settings?: ProjectSettings }) {
    const r = unwrap(await this.db.from('projects').update(patch).eq('id', id).select('*').maybeSingle());
    return r ? toProject(r) : null;
  }
  async deleteProject(id: string) {
    const r = unwrap(await this.db.from('projects').delete().eq('id', id).select('id'));
    return r.length > 0;
  }

  private async withResponses(rules: Row[]): Promise<Rule[]> {
    if (!rules.length) return [];
    const ids = rules.map((r) => r.id);
    const resp: Row[] = [];
    for (let i = 0; i < ids.length; i += 200)
      resp.push(...unwrap(await this.db.from('responses').select('*').in('rule_id', ids.slice(i, i + 200))));
    return rules.map((r) => toRule(r, resp));
  }
  async listRules(projectId: string) {
    return this.withResponses(unwrap(await this.db.from('rules').select('*').eq('project_id', projectId).order('created_at')));
  }
  async getRule(id: string) {
    const r = unwrap(await this.db.from('rules').select('*').eq('id', id).maybeSingle());
    return r ? (await this.withResponses([r]))[0] : null;
  }
  private ruleRow(input: RuleInput) {
    return {
      name: input.name,
      method: input.method,
      path_pattern: input.pathPattern,
      enabled: input.enabled,
      select_mode: input.selectMode,
      conditions: input.conditions,
    };
  }
  async createRule(projectId: string, input: RuleInput) {
    const row = unwrap(await this.db.from('rules').insert({ project_id: projectId, ...this.ruleRow(input) }).select('*').single()) as Row;
    unwrap(await this.db.from('responses').insert(input.responses.map((r) => fromResponse(row.id, r))));
    return (await this.getRule(row.id))!;
  }
  private rpcMissingWarned = false;
  // 규칙 갱신 + 응답 교체는 replace_rule RPC(0002 마이그레이션)로 원자적으로 수행한다.
  // 함수가 아직 없으면(마이그레이션 미적용) 비원자적 경로로 폴백한다.
  async replaceRule(id: string, input: RuleInput) {
    const { data, error } = await this.db.rpc('replace_rule', {
      p_rule_id: id,
      p_rule: this.ruleRow(input),
      p_responses: input.responses.map((r) => {
        const { rule_id: _ruleId, ...rest } = fromResponse(id, r);
        return rest;
      }),
    });
    if (!error) return data ? this.getRule(id) : null;
    if (error.code !== 'PGRST202') unwrap({ data: null, error });
    if (!this.rpcMissingWarned) {
      this.rpcMissingWarned = true;
      console.warn('[storage] replace_rule RPC 없음 — supabase/migrations/0002_replace_rule_rpc.sql 적용 전까지 비원자적 갱신 사용');
    }
    return this.replaceRuleNonAtomic(id, input);
  }
  private async replaceRuleNonAtomic(id: string, input: RuleInput) {
    const row = unwrap(
      await this.db.from('rules').update({ ...this.ruleRow(input), updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle(),
    );
    if (!row) return null;
    unwrap(await this.db.from('responses').delete().eq('rule_id', id));
    unwrap(await this.db.from('responses').insert(input.responses.map((r) => fromResponse(id, r))));
    return this.getRule(id);
  }
  async patchRuleEnabled(id: string, enabled: boolean) {
    const row = unwrap(await this.db.from('rules').update({ enabled, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle());
    return row ? this.getRule(id) : null;
  }
  async deleteRule(id: string) {
    return unwrap(await this.db.from('rules').delete().eq('id', id).select('id')).length > 0;
  }

  private importRpcMissingWarned = false;
  private warnImportRpcMissing() {
    if (this.importRpcMissingWarned) return;
    this.importRpcMissingWarned = true;
    console.warn('[storage] import_rules/import_presets RPC 없음 — supabase/migrations/0004_import_rules_rpc.sql 적용 전까지 보상(복구 시도) 방식 사용. 완전한 원자성이 보장되지 않습니다');
  }
  // 가져오기는 import_rules RPC(0004)로 단일 트랜잭션 처리한다. 함수가 없으면 보상 방식으로 폴백한다.
  async importRules(projectId: string, inputs: RuleInput[], mode: ImportMode): Promise<ImportResult> {
    const { data, error } = await this.db.rpc('import_rules', {
      p_project_id: projectId,
      p_mode: mode,
      p_rules: inputs.map((i) => ({
        ...this.ruleRow(i),
        responses: i.responses.map((r) => {
          const { rule_id: _ruleId, ...rest } = fromResponse('', r);
          return rest;
        }),
      })),
    });
    if (!error) return data as ImportResult;
    if (error.code !== 'PGRST202') unwrap({ data: null, error });
    this.warnImportRpcMissing();
    return this.importRulesCompensating(projectId, inputs, mode);
  }
  private async importRulesCompensating(projectId: string, inputs: RuleInput[], mode: ImportMode): Promise<ImportResult> {
    const snapshot = await this.listRules(projectId);
    try {
      if (mode === 'replace') for (const r of snapshot) await this.deleteRule(r.id);
      const existing = mode === 'replace' ? [] : snapshot;
      let created = 0;
      let updated = 0;
      for (const input of inputs) {
        const same = existing.find((e) => e.method === input.method && e.pathPattern === input.pathPattern);
        if (same) {
          await this.replaceRule(same.id, input);
          updated++;
        } else {
          await this.createRule(projectId, input);
          created++;
        }
      }
      return { created, updated, deleted: mode === 'replace' ? snapshot.length : 0 };
    } catch (e) {
      try {
        for (const r of await this.listRules(projectId)) await this.deleteRule(r.id);
        for (const r of snapshot) await this.createRule(projectId, r);
      } catch (re) {
        console.error('[storage] import 복구 실패 — 규칙을 Export 파일로 복원하세요:', re);
      }
      throw e;
    }
  }

  async listPresets() {
    return unwrap(await this.db.from('presets').select('*').order('name')).map(toPreset);
  }
  async getPreset(id: string) {
    const r = unwrap(await this.db.from('presets').select('*').eq('id', id).maybeSingle());
    return r ? toPreset(r) : null;
  }
  async createPreset(input: PresetInput) {
    return toPreset(unwrap(await this.db.from('presets').insert(fromPreset(input)).select('*').single()));
  }
  async updatePreset(id: string, input: PresetInput) {
    const r = unwrap(await this.db.from('presets').update({ ...fromPreset(input), updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle());
    return r ? toPreset(r) : null;
  }
  async deletePreset(id: string) {
    return unwrap(await this.db.from('presets').delete().eq('id', id).select('id')).length > 0;
  }
  async importPresets(inputs: PresetInput[], mode: ImportMode): Promise<ImportResult> {
    const { data, error } = await this.db.rpc('import_presets', { p_mode: mode, p_presets: inputs.map(fromPreset) });
    if (!error) return data as ImportResult;
    if (error.code !== 'PGRST202') unwrap({ data: null, error });
    this.warnImportRpcMissing();
    const snapshot = await this.listPresets();
    try {
      if (mode === 'replace') for (const p of snapshot) await this.deletePreset(p.id);
      const existing = mode === 'replace' ? [] : snapshot;
      let created = 0;
      let updated = 0;
      for (const input of inputs) {
        const same = existing.find((e) => e.name.trim().toLowerCase() === input.name.trim().toLowerCase());
        if (same) {
          await this.updatePreset(same.id, input);
          updated++;
        } else {
          await this.createPreset(input);
          created++;
        }
      }
      return { created, updated, deleted: mode === 'replace' ? snapshot.length : 0 };
    } catch (e) {
      try {
        for (const p of await this.listPresets()) await this.deletePreset(p.id);
        for (const p of snapshot) await this.createPreset(p);
      } catch (re) {
        console.error('[storage] 프리셋 import 복구 실패 — Export 파일로 복원하세요:', re);
      }
      throw e;
    }
  }

  async insertLogs(logs: LogEntry[]) {
    if (!logs.length) return;
    unwrap(
      await this.db.from('request_logs').insert(
        logs.map((l) => ({
          id: l.id,
          project_id: l.projectId,
          rule_id: l.ruleId,
          response_id: l.responseId,
          matched: l.matched,
          method: l.method,
          path: l.path,
          query: l.query,
          req_headers: l.reqHeaders,
          req_body: l.reqBody,
          status: l.status,
          res_body: l.resBody,
          latency_ms: l.latencyMs,
          created_at: l.createdAt,
        })),
      ),
    );
  }
  async listLogs(projectId: string, q: LogQuery) {
    let query = this.db.from('request_logs').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(q.limit);
    if (q.matched !== undefined) query = query.eq('matched', q.matched);
    if (q.before) query = query.lt('created_at', q.before);
    return unwrap(await query).map(toLog);
  }
  async getLog(id: string) {
    const r = unwrap(await this.db.from('request_logs').select('*').eq('id', id).maybeSingle());
    return r ? toLog(r) : null;
  }
  async clearLogs(projectId: string) {
    unwrap(await this.db.from('request_logs').delete().eq('project_id', projectId));
  }
  async pruneLogs(retentionDays: number, maxPerProject: number) {
    const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();
    unwrap(await this.db.from('request_logs').delete().lt('created_at', cutoff));
    for (const p of await this.listProjects()) {
      const edge = unwrap(
        await this.db.from('request_logs').select('created_at').eq('project_id', p.id).order('created_at', { ascending: false }).range(maxPerProject, maxPerProject),
      );
      if (edge.length) unwrap(await this.db.from('request_logs').delete().eq('project_id', p.id).lte('created_at', edge[0].created_at));
    }
  }
}
