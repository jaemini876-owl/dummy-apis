import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ConflictError } from '../errors.js';
import type { ImportMode, ImportResult, LogEntry, Preset, PresetInput, Project, ProjectSettings, Rule, RuleInput } from '../types.js';
import type { LogQuery, Repo } from './repo.js';

const presetKey = (name: string) => name.trim().toLowerCase();

/** 메모리 저장소. filePath가 있으면 projects/rules/presets를 JSON 파일에 영속화(로그 제외). */
export class MemoryRepo implements Repo {
  private projects: Project[] = [];
  private rules: Rule[] = [];
  private presets: Preset[] = [];
  private logs: LogEntry[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private filePath?: string) {
    if (filePath && existsSync(filePath)) {
      const d = JSON.parse(readFileSync(filePath, 'utf8'));
      this.projects = d.projects ?? [];
      this.rules = d.rules ?? [];
      this.presets = d.presets ?? []; // v4 이전 파일에는 없음
    }
  }

  private persist() {
    if (!this.filePath) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      mkdirSync(dirname(this.filePath!), { recursive: true });
      writeFileSync(this.filePath!, JSON.stringify({ projects: this.projects, rules: this.rules, presets: this.presets }, null, 2));
    }, 200);
    this.timer.unref();
  }

  async listProjects() {
    return [...this.projects].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async getProject(id: string) {
    return this.projects.find((p) => p.id === id) ?? null;
  }
  async getProjectBySlug(slug: string) {
    return this.projects.find((p) => p.slug === slug) ?? null;
  }
  async createProject(input: { slug: string; name: string; settings: ProjectSettings }) {
    if (this.projects.some((p) => p.slug === input.slug)) throw new ConflictError('slug already exists');
    const p: Project = { id: randomUUID(), ownerId: null, createdAt: new Date().toISOString(), ...input };
    this.projects.push(p);
    this.persist();
    return p;
  }
  async updateProject(id: string, patch: { name?: string; settings?: ProjectSettings }) {
    const p = this.projects.find((x) => x.id === id);
    if (!p) return null;
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.settings) p.settings = patch.settings;
    this.persist();
    return p;
  }
  async deleteProject(id: string) {
    const n = this.projects.length;
    this.projects = this.projects.filter((p) => p.id !== id);
    this.rules = this.rules.filter((r) => r.projectId !== id);
    this.logs = this.logs.filter((l) => l.projectId !== id);
    this.persist();
    return this.projects.length < n;
  }

  async listRules(projectId: string) {
    return this.rules.filter((r) => r.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async getRule(id: string) {
    return this.rules.find((r) => r.id === id) ?? null;
  }
  private assertUnique(projectId: string, input: RuleInput, selfId?: string) {
    if (this.rules.some((r) => r.projectId === projectId && r.id !== selfId && r.method === input.method && r.pathPattern === input.pathPattern))
      throw new ConflictError('rule with same method and path already exists');
  }
  async createRule(projectId: string, input: RuleInput) {
    this.assertUnique(projectId, input);
    const now = new Date().toISOString();
    const rule: Rule = {
      ...input,
      id: randomUUID(),
      projectId,
      createdAt: now,
      updatedAt: now,
      responses: input.responses.map((r) => ({ ...r, id: randomUUID() })),
    };
    this.rules.push(rule);
    this.persist();
    return rule;
  }
  async replaceRule(id: string, input: RuleInput) {
    const i = this.rules.findIndex((r) => r.id === id);
    if (i < 0) return null;
    const old = this.rules[i];
    this.assertUnique(old.projectId, input, id);
    this.rules[i] = {
      ...input,
      id,
      projectId: old.projectId,
      createdAt: old.createdAt,
      updatedAt: new Date().toISOString(),
      responses: input.responses.map((r) => ({ ...r, id: r.id ?? randomUUID() })),
    };
    this.persist();
    return this.rules[i];
  }
  async patchRuleEnabled(id: string, enabled: boolean) {
    const r = this.rules.find((x) => x.id === id);
    if (!r) return null;
    r.enabled = enabled;
    r.updatedAt = new Date().toISOString();
    this.persist();
    return r;
  }
  async deleteRule(id: string) {
    const n = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    this.persist();
    return this.rules.length < n;
  }

  async importRules(projectId: string, inputs: RuleInput[], mode: ImportMode): Promise<ImportResult> {
    // 사본에서 모두 적용한 뒤 마지막에 한 번에 교체한다 → 중간에 실패해도 기존 데이터는 그대로
    const seen = new Set<string>();
    for (const i of inputs) {
      const k = `${i.method} ${i.pathPattern}`;
      if (seen.has(k)) throw new ConflictError(`duplicate rule in import: ${k}`);
      seen.add(k);
    }
    const others = this.rules.filter((r) => r.projectId !== projectId);
    const mine = this.rules.filter((r) => r.projectId === projectId);
    const next: Rule[] = mode === 'replace' ? [] : [...mine];
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    for (const input of inputs) {
      const responses = input.responses.map((r) => ({ ...r, id: randomUUID() }));
      const i = next.findIndex((r) => r.method === input.method && r.pathPattern === input.pathPattern);
      if (i >= 0) {
        next[i] = { ...input, id: next[i].id, projectId, createdAt: next[i].createdAt, updatedAt: now, responses };
        updated++;
      } else {
        next.push({ ...input, id: randomUUID(), projectId, createdAt: now, updatedAt: now, responses });
        created++;
      }
    }
    this.rules = [...others, ...next];
    this.persist();
    return { created, updated, deleted: mode === 'replace' ? mine.length : 0 };
  }

  async listPresets() {
    return [...this.presets].sort((a, b) => a.name.localeCompare(b.name));
  }
  async getPreset(id: string) {
    return this.presets.find((p) => p.id === id) ?? null;
  }
  private assertPresetName(name: string, selfId?: string) {
    if (this.presets.some((p) => p.id !== selfId && presetKey(p.name) === presetKey(name))) throw new ConflictError('preset with same name already exists');
  }
  async createPreset(input: PresetInput) {
    this.assertPresetName(input.name);
    const now = new Date().toISOString();
    const p: Preset = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.presets.push(p);
    this.persist();
    return p;
  }
  async updatePreset(id: string, input: PresetInput) {
    const i = this.presets.findIndex((p) => p.id === id);
    if (i < 0) return null;
    this.assertPresetName(input.name, id);
    this.presets[i] = { ...input, id, createdAt: this.presets[i].createdAt, updatedAt: new Date().toISOString() };
    this.persist();
    return this.presets[i];
  }
  async deletePreset(id: string) {
    const n = this.presets.length;
    this.presets = this.presets.filter((p) => p.id !== id);
    this.persist();
    return this.presets.length < n;
  }
  async importPresets(inputs: PresetInput[], mode: ImportMode): Promise<ImportResult> {
    const seen = new Set<string>();
    for (const i of inputs) {
      if (seen.has(presetKey(i.name))) throw new ConflictError(`duplicate preset in import: ${i.name}`);
      seen.add(presetKey(i.name));
    }
    const next: Preset[] = mode === 'replace' ? [] : [...this.presets];
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    for (const input of inputs) {
      const i = next.findIndex((p) => presetKey(p.name) === presetKey(input.name));
      if (i >= 0) {
        next[i] = { ...input, id: next[i].id, createdAt: next[i].createdAt, updatedAt: now };
        updated++;
      } else {
        next.push({ ...input, id: randomUUID(), createdAt: now, updatedAt: now });
        created++;
      }
    }
    const deleted = mode === 'replace' ? this.presets.length : 0;
    this.presets = next;
    this.persist();
    return { created, updated, deleted };
  }

  async insertLogs(logs: LogEntry[]) {
    this.logs.push(...logs);
  }
  async listLogs(projectId: string, q: LogQuery) {
    return this.logs
      .filter((l) => l.projectId === projectId)
      .filter((l) => q.matched === undefined || l.matched === q.matched)
      .filter((l) => !q.before || l.createdAt < q.before)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, q.limit);
  }
  async getLog(id: string) {
    return this.logs.find((l) => l.id === id) ?? null;
  }
  async clearLogs(projectId: string) {
    this.logs = this.logs.filter((l) => l.projectId !== projectId);
  }
  async pruneLogs(retentionDays: number, maxPerProject: number) {
    const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString();
    this.logs = this.logs.filter((l) => l.createdAt >= cutoff);
    const byProject = new Map<string, LogEntry[]>();
    for (const l of this.logs) {
      const list = byProject.get(l.projectId) ?? [];
      list.push(l);
      byProject.set(l.projectId, list);
    }
    const keep = new Set<string>();
    for (const list of byProject.values())
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, maxPerProject).forEach((l) => keep.add(l.id));
    this.logs = this.logs.filter((l) => keep.has(l.id));
  }
}
