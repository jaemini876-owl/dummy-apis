import type { ImportMode, ImportResult, LogEntry, Preset, PresetInput, Project, ProjectSettings, Rule, RuleInput } from '../types.js';

export interface LogQuery {
  limit: number;
  before?: string;
  matched?: boolean;
}

export interface Repo {
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  getProjectBySlug(slug: string): Promise<Project | null>;
  createProject(input: { slug: string; name: string; settings: ProjectSettings }): Promise<Project>;
  updateProject(id: string, patch: { name?: string; settings?: ProjectSettings }): Promise<Project | null>;
  deleteProject(id: string): Promise<boolean>;

  listRules(projectId: string): Promise<Rule[]>;
  getRule(id: string): Promise<Rule | null>;
  createRule(projectId: string, input: RuleInput): Promise<Rule>;
  replaceRule(id: string, input: RuleInput): Promise<Rule | null>;
  patchRuleEnabled(id: string, enabled: boolean): Promise<Rule | null>;
  deleteRule(id: string): Promise<boolean>;
  /**
   * 규칙 일괄 가져오기. 전부 반영되거나 하나도 반영되지 않는다(원자적).
   * merge: 같은 method+path는 덮어쓰기, replace: 기존 규칙을 모두 삭제하고 대체.
   * 입력 안에 같은 method+path가 중복되면 ConflictError.
   */
  importRules(projectId: string, inputs: RuleInput[], mode: ImportMode): Promise<ImportResult>;

  /** 전역 응답 프리셋 (이름은 대소문자 무시 유일) */
  listPresets(): Promise<Preset[]>;
  getPreset(id: string): Promise<Preset | null>;
  createPreset(input: PresetInput): Promise<Preset>;
  updatePreset(id: string, input: PresetInput): Promise<Preset | null>;
  deletePreset(id: string): Promise<boolean>;
  /** 프리셋 일괄 가져오기 (원자적). merge 기준은 이름. */
  importPresets(inputs: PresetInput[], mode: ImportMode): Promise<ImportResult>;

  insertLogs(logs: LogEntry[]): Promise<void>;
  listLogs(projectId: string, q: LogQuery): Promise<LogEntry[]>;
  getLog(id: string): Promise<LogEntry | null>;
  clearLogs(projectId: string): Promise<void>;
  pruneLogs(retentionDays: number, maxPerProject: number): Promise<void>;
}
