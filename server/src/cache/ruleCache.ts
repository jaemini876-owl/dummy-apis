import type { Repo } from '../repo/repo.js';
import type { Project, Rule } from '../types.js';
import { compareScores, compilePath, matchPath, type CompiledPath } from '../mock/matcher.js';
import { evalConditions, type MatchContext } from '../mock/conditions.js';

export interface CompiledRule {
  rule: Rule;
  path: CompiledPath;
}

export interface Entry {
  project: Project;
  rules: CompiledRule[];
}

/** 프로젝트별 규칙을 우선순위 순으로 정렬해 메모리에 보관. 모의 호출은 DB를 읽지 않는다. */
export class RuleCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry | null>>();
  private missing = new Map<string, number>();
  readonly counters = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private repo: Repo) {}

  private async load(slug: string): Promise<Entry | null> {
    const project = await this.repo.getProjectBySlug(slug);
    if (!project) return null;
    const rules = (await this.repo.listRules(project.id)).filter((r) => r.enabled);
    const compiled = rules.map((rule) => ({
      rule: { ...rule, responses: [...rule.responses].sort((a, b) => a.position - b.position) },
      path: compilePath(rule.pathPattern),
    }));
    compiled.sort(
      (a, b) =>
        compareScores(a.path.score, b.path.score) ||
        Number(b.rule.method !== 'ANY') - Number(a.rule.method !== 'ANY') ||
        b.rule.conditions.length - a.rule.conditions.length ||
        a.rule.createdAt.localeCompare(b.rule.createdAt),
    );
    return { project, rules: compiled };
  }

  async get(slug: string): Promise<Entry | null> {
    const hit = this.entries.get(slug);
    if (hit) return hit;
    const missedAt = this.missing.get(slug);
    if (missedAt && Date.now() - missedAt < 5000) return null;
    let p = this.inflight.get(slug);
    if (!p) {
      p = this.load(slug).finally(() => this.inflight.delete(slug));
      this.inflight.set(slug, p);
    }
    const e = await p;
    if (e) {
      this.entries.set(slug, e);
      this.missing.delete(slug);
    } else this.missing.set(slug, Date.now());
    return e;
  }

  invalidate(slug?: string) {
    if (slug) {
      this.entries.delete(slug);
      this.missing.delete(slug);
    } else {
      this.entries.clear();
      this.missing.clear();
    }
  }

  /** 다중 인스턴스 대비: 주기적으로 로드된 프로젝트를 다시 읽는다. */
  startPolling(ms = 30_000) {
    this.timer = setInterval(async () => {
      for (const slug of [...this.entries.keys()]) {
        try {
          const e = await this.load(slug);
          if (e) this.entries.set(slug, e);
          else this.entries.delete(slug);
        } catch {
          /* keep stale cache on DB failure */
        }
      }
    }, ms);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  find(entry: Entry, method: string, path: string, ctx: MatchContext): { cr: CompiledRule; params: Record<string, string> } | null {
    for (const cr of entry.rules) {
      if (cr.rule.method !== 'ANY' && cr.rule.method !== method) continue;
      const params = matchPath(cr.path, path);
      if (!params) continue;
      if (cr.rule.conditions.length && !evalConditions(cr.rule.conditions, { ...ctx, params })) continue;
      return { cr, params };
    }
    return null;
  }
}
