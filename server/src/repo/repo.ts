import type { LogEntry, Project, ProjectSettings, Rule, RuleInput } from '../types.js';

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

  insertLogs(logs: LogEntry[]): Promise<void>;
  listLogs(projectId: string, q: LogQuery): Promise<LogEntry[]>;
  getLog(id: string): Promise<LogEntry | null>;
  clearLogs(projectId: string): Promise<void>;
  pruneLogs(retentionDays: number, maxPerProject: number): Promise<void>;
}
