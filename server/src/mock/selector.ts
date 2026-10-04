import type { ResponseDef, Rule } from '../types.js';
import { evalConditions, type MatchContext } from './conditions.js';

export function selectResponse(
  rule: Rule,
  ctx: MatchContext,
  counters: Map<string, number>,
  loop: boolean,
  rand: () => number = Math.random,
): ResponseDef | null {
  const rs = rule.responses;
  if (!rs.length) return null;
  switch (rule.selectMode) {
    case 'fixed':
      return rs[0];
    case 'sequential': {
      const n = counters.get(rule.id) ?? 0;
      counters.set(rule.id, n + 1);
      return rs[loop ? n % rs.length : Math.min(n, rs.length - 1)];
    }
    case 'weighted': {
      const total = rs.reduce((s, r) => s + Math.max(0, r.weight), 0);
      if (total <= 0) return rs[0];
      let x = rand() * total;
      for (const r of rs) {
        x -= Math.max(0, r.weight);
        if (x < 0) return r;
      }
      return rs[rs.length - 1];
    }
    case 'conditional':
      return (
        rs.find((r) => r.conditions.length > 0 && evalConditions(r.conditions, ctx)) ??
        rs.find((r) => r.conditions.length === 0) ??
        null
      );
  }
}
