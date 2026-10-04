import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ConflictError } from '../errors.js';
import { DEFAULT_SETTINGS, type LogEntry, type Project, type ProjectSettings, type ResponseDef, type Rule, type RuleInput } from '../types.js';
import type { LogQuery, Repo } from './repo.js';

type Row = Record<string, any>;

function unwrap<T>(res: { data: T | null; error: { code?: string; message: string } | null }): T {
  if (res.error) {
    if (res.error.code === '23505') throw new ConflictError(res.error.message);
    throw new Error(res.error.message);
  }
  return res.data as T;
}

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
