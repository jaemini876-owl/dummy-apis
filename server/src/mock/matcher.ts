export type Seg = { t: 's'; v: string } | { t: 'p'; n: string } | { t: 'w' };

export interface CompiledPath {
  segs: Seg[];
  /** 세그먼트별 구체성 (정적 3 / 파라미터 2 / 와일드카드 1) */
  score: number[];
}

const PARAM = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const splitPath = (p: string) => p.split('/').filter(Boolean);

/** 유효하면 null, 아니면 오류 메시지 */
export function validatePattern(pattern: string): string | null {
  if (!pattern.startsWith('/')) return 'path는 /로 시작해야 합니다';
  const parts = splitPath(pattern);
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i];
    if (s === '*') {
      if (i !== parts.length - 1) return '*는 마지막 세그먼트에만 쓸 수 있습니다';
    } else if (s.startsWith(':') && !PARAM.test(s.slice(1))) {
      return `잘못된 파라미터 이름: ${s}`;
    }
  }
  return null;
}

export function compilePath(pattern: string): CompiledPath {
  const segs: Seg[] = splitPath(pattern).map((s) =>
    s === '*' ? { t: 'w' } : s.startsWith(':') ? { t: 'p', n: s.slice(1) } : { t: 's', v: s },
  );
  return { segs, score: segs.map((s) => (s.t === 's' ? 3 : s.t === 'p' ? 2 : 1)) };
}

const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function matchPath(c: CompiledPath, path: string): Record<string, string> | null {
  const parts = splitPath(path);
  const params: Record<string, string> = {};
  for (let i = 0; i < c.segs.length; i++) {
    const seg = c.segs[i];
    if (seg.t === 'w') {
      const rest = parts.slice(i);
      if (!rest.length) return null;
      params['*'] = rest.map(dec).join('/');
      return params;
    }
    if (i >= parts.length) return null;
    if (seg.t === 's') {
      if (dec(parts[i]) !== seg.v) return null;
    } else {
      params[seg.n] = dec(parts[i]);
    }
  }
  return parts.length === c.segs.length ? params : null;
}

/** 음수: a가 먼저(더 구체적) */
export function compareScores(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (b[i] ?? 0) - (a[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
