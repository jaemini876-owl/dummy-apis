export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ANY';
export type SelectMode = 'fixed' | 'sequential' | 'weighted' | 'conditional';
export type Fault = 'timeout' | 'reset' | 'truncate' | 'invalid_json' | null;

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
  fault: Fault;
}

export interface Rule {
  id: string;
  projectId: string;
  name: string | null;
  method: Method;
  pathPattern: string;
  enabled: boolean;
  selectMode: SelectMode;
  conditions: Condition[];
  responses: ResponseDef[];
  createdAt: string;
  updatedAt: string;
}

export type RuleInput = Omit<Rule, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>;

export interface ProjectSettings {
  extraDelayMs: number;
  errorRate: number;
  errorStatus: number;
  loop: boolean;
  cors: boolean;
  unmatchedStatus: number;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  extraDelayMs: 0,
  errorRate: 0,
  errorStatus: 500,
  loop: false,
  cors: true,
  unmatchedStatus: 404,
};

export interface Project {
  id: string;
  slug: string;
  name: string;
  settings: ProjectSettings;
  ownerId: string | null;
  createdAt: string;
}

export interface LogEntry {
  id: string;
  projectId: string;
  ruleId: string | null;
  responseId: string | null;
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
