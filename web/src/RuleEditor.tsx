import { useEffect, useRef, useState } from 'react';
import { api, emptyResponse, METHODS, STATUS_PRESETS, type Condition, type Project, type ResponseDef, type Rule, type RuleInput } from './api';
import { ContentFields } from './ContentFields';
import { useMockUrl } from './mockUrl';
import { PresetPicker, SavePresetModal } from './PresetModals';
import { copy, Modal, statusClass, useToast } from './ui';

function ConditionsEditor({ value, onChange }: { value: Condition[]; onChange: (c: Condition[]) => void }) {
  const set = (i: number, patch: Partial<Condition>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="conds">
      {value.map((c, i) => (
        <div className="row" key={i}>
          <select value={c.source} onChange={(e) => set(i, { source: e.target.value as Condition['source'] })}>
            <option value="query">query</option><option value="header">header</option>
            <option value="body">body(JSON path)</option><option value="path">path param</option>
          </select>
          <input placeholder="key" value={c.key} onChange={(e) => set(i, { key: e.target.value })} />
          <select value={c.op} onChange={(e) => set(i, { op: e.target.value as Condition['op'] })}>
            <option value="eq">=</option><option value="neq">≠</option><option value="contains">포함</option>
            <option value="regex">정규식</option><option value="exists">존재</option>
          </select>
          {c.op !== 'exists' && <input placeholder="value" value={c.value ?? ''} onChange={(e) => set(i, { value: e.target.value })} />}
          <button className="ghost small" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button className="ghost small" onClick={() => onChange([...value, { source: 'query', key: '', op: 'eq', value: '' }])}>+ 조건 추가</button>
    </div>
  );
}

function ResponseCard({
  r, index, total, mode, onChange, onMove, onRemove,
}: {
  r: ResponseDef; index: number; total: number; mode: RuleInput['selectMode'];
  onChange: (r: ResponseDef) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  // 프리셋을 적용하면 내용 입력부(headers 텍스트 상태 포함)를 새 값으로 다시 마운트한다
  const [applied, setApplied] = useState(0);
  const set = (patch: Partial<ResponseDef>) => onChange({ ...r, ...patch });
  const preset = STATUS_PRESETS.find((p) => p[0] === r.status);
  return (
    <div className="resp">
      <div className="row between">
        <strong>응답 #{index + 1}{mode === 'sequential' ? ` (${index + 1}번째 호출)` : ''}</strong>
        <div className="row">
          <button className="ghost small" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
          <button className="ghost small" disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
          <button className="ghost small" disabled={total === 1} onClick={onRemove}>삭제</button>
        </div>
      </div>
      <div className="grid">
        <label>Status
          <div className="row">
            <input type="number" min={200} max={599} value={r.status} onChange={(e) => set({ status: Number(e.target.value) })} style={{ width: 90 }} />
            <select value={preset ? r.status : ''} onChange={(e) => e.target.value && set({ status: Number(e.target.value) })}>
              <option value="">직접 입력</option>
              {STATUS_PRESETS.map(([c, t]) => <option key={c} value={c}>{c} {t}</option>)}
            </select>
          </div>
        </label>
        <label>지연 (ms, 최소~최대)
          <div className="row">
            <input type="number" min={0} value={r.delayMinMs} onChange={(e) => set({ delayMinMs: Number(e.target.value) })} />
            <span>~</span>
            <input type="number" min={0} value={r.delayMaxMs} onChange={(e) => set({ delayMaxMs: Number(e.target.value) })} />
          </div>
        </label>
        <label>장애 시뮬레이션
          <select value={r.fault ?? ''} onChange={(e) => set({ fault: (e.target.value || null) as ResponseDef['fault'] })}>
            <option value="">없음</option>
            <option value="timeout">timeout (응답 안 줌)</option>
            <option value="reset">연결 끊김 (reset)</option>
            <option value="truncate">응답 잘림 (truncate)</option>
            <option value="invalid_json">깨진 JSON</option>
          </select>
        </label>
        {mode === 'weighted' && (
          <label>가중치<input type="number" min={0} value={r.weight} onChange={(e) => set({ weight: Number(e.target.value) })} /></label>
        )}
      </div>
      <div className="row wrap">
        <button className="ghost small" onClick={() => setPicking(true)}>프리셋 불러오기</button>
        <button className="ghost small" onClick={() => setSaving(true)}>프리셋으로 저장</button>
        <span className="muted">Content-Type · Headers · Body를 저장해 두고 다른 규칙/프로젝트에서 재사용</span>
      </div>
      <ContentFields key={applied} value={r} onChange={set} />
      {picking && (
        <PresetPicker
          current={r}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            set({ contentType: p.contentType, headers: { ...p.headers }, body: p.bodyBase64 ? null : p.body ?? '', bodyBase64: p.bodyBase64 });
            setApplied((n) => n + 1);
            setPicking(false);
          }}
        />
      )}
      {saving && <SavePresetModal value={r} onClose={() => setSaving(false)} />}
      {mode === 'conditional' && (
        <div>
          <strong>이 응답이 선택되는 조건</strong> <span className="muted">(비우면 기본 응답, 위에서부터 첫 일치)</span>
          <ConditionsEditor value={r.conditions} onChange={(c) => set({ conditions: c })} />
        </div>
      )}
    </div>
  );
}

function TryIt({ project, rule }: { project: Project; rule: Rule }) {
  const toast = useToast();
  const base = `${location.origin}/m/${project.slug}`;
  const [method, setMethod] = useState(rule.method === 'ANY' ? 'GET' : rule.method);
  const [path, setPath] = useState(rule.pathPattern.replace(/:([A-Za-z_]\w*)/g, '1').replace('*', 'x'));
  const [body, setBody] = useState('');
  const [out, setOut] = useState<{ status: number; ms: number; text: string; headers: string } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const t0 = performance.now();
    try {
      const res = await fetch(base + path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body && !['GET', 'HEAD'].includes(method) ? body : undefined,
      });
      const text = await res.text();
      setOut({ status: res.status, ms: Math.round(performance.now() - t0), text, headers: [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n') });
    } catch (e: any) {
      setOut({ error: e.message });
    } finally {
      setBusy(false);
    }
  };
  const curl = `curl -i -X ${method} '${base}${path}'${body ? ` -H 'Content-Type: application/json' -d '${body}'` : ''}`;
  return (
    <div className="tryit">
      <h3>Try it</h3>
      <div className="row">
        <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
          {METHODS.filter((m) => m !== 'ANY').map((m) => <option key={m}>{m}</option>)}
        </select>
        <input className="grow" value={path} onChange={(e) => setPath(e.target.value)} />
        <button className="primary" onClick={send} disabled={busy}>{busy ? '…' : '호출'}</button>
        <button className="ghost" onClick={() => copy(curl, toast)}>cURL 복사</button>
      </div>
      {!['GET', 'HEAD'].includes(method) && <textarea className="mono" rows={3} placeholder="요청 바디 (JSON)" value={body} onChange={(e) => setBody(e.target.value)} />}
      {out && ('error' in out ? (
        <div className="banner err">{out.error}</div>
      ) : (
        <div>
          <p><span className={`badge ${statusClass(out.status)}`}>{out.status}</span> <span className="muted">{out.ms} ms</span></p>
          <pre>{out.text || '(빈 바디)'}</pre>
          <details><summary>응답 헤더</summary><pre>{out.headers}</pre></details>
        </div>
      ))}
    </div>
  );
}

export function RuleEditor({ project, rule, onClose, onSaved }: { project: Project; rule: Rule | RuleInput; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const mockUrl = useMockUrl(project);
  const [saved, setSaved] = useState<Rule | null>('id' in rule ? (rule as Rule) : null);
  const [d, setD] = useState<RuleInput>(() => JSON.parse(JSON.stringify(rule)));
  // 응답 카드의 안정적인 key (이동/삭제 시 카드 내부 state가 엉키지 않게)
  const nextKey = useRef(0);
  const [keys, setKeys] = useState<number[]>(() => d.responses.map(() => nextKey.current++));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<RuleInput>) => setD((x) => ({ ...x, ...patch }));
  const setResp = (i: number, r: ResponseDef) => set({ responses: d.responses.map((x, j) => (j === i ? r : x)) });

  // 미저장 변경 감지: 마지막 저장(또는 최초 로드) 시점 스냅샷과 비교
  const snap = (x: RuleInput) => JSON.stringify({ ...x, responses: x.responses.map((r, i) => ({ ...r, position: i })) });
  const baseline = useRef(snap(d));
  const dirty = snap(d) !== baseline.current;
  const guardedClose = () => {
    if (dirty && !window.confirm('저장하지 않은 변경 사항이 있습니다. 닫으면 변경 내용이 사라집니다. 닫을까요?')) return;
    onClose();
  };
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = async () => {
    setBusy(true);
    try {
      const payload = { ...d, responses: d.responses.map((r, i) => ({ ...r, position: i })) };
      const r = saved ? await api.saveRule(project.id, saved.id, payload) : await api.createRule(project.id, payload);
      baseline.current = snap(d);
      setSaved(r);
      toast('저장했습니다 — 즉시 반영됨');
      onSaved();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  return (
    <Modal title={saved ? '규칙 편집' : '새 규칙'} onClose={guardedClose} wide>
      <div className="grid">
        <label>Method
          <select value={d.method} onChange={(e) => set({ method: e.target.value as RuleInput['method'] })}>
            {METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <label className="span2">Path <span className="muted">(<code>/v2/orders/:id</code>, <code>/files/*</code>)</span>
          <input className="mono" value={d.pathPattern} onChange={(e) => set({ pathPattern: e.target.value })} placeholder="/v2/orders/:id" />
        </label>
        <label>이름 (선택)<input value={d.name ?? ''} onChange={(e) => set({ name: e.target.value || null })} /></label>
        <label>응답 선택 방식
          <select value={d.selectMode} onChange={(e) => set({ selectMode: e.target.value as RuleInput['selectMode'] })}>
            <option value="fixed">고정 (첫 번째)</option>
            <option value="sequential">순차 (호출 순서대로)</option>
            <option value="weighted">가중치 랜덤</option>
            <option value="conditional">조건별</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={d.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> 활성화</label>
      </div>
      <details>
        <summary>규칙 매칭 조건 ({d.conditions.length}) — 모두 만족해야 이 규칙이 사용됩니다</summary>
        <ConditionsEditor value={d.conditions} onChange={(c) => set({ conditions: c })} />
      </details>
      {d.responses.map((r, i) => (
        <ResponseCard
          key={keys[i]} r={r} index={i} total={d.responses.length} mode={d.selectMode}
          onChange={(x) => setResp(i, x)}
          onRemove={() => (setKeys(keys.filter((_, j) => j !== i)), set({ responses: d.responses.filter((_, j) => j !== i) }))}
          onMove={(dir) => {
            const a = [...d.responses];
            [a[i], a[i + dir]] = [a[i + dir], a[i]];
            const k = [...keys];
            [k[i], k[i + dir]] = [k[i + dir], k[i]];
            setKeys(k);
            set({ responses: a });
          }}
        />
      ))}
      <div className="row between">
        <button className="ghost" onClick={() => (setKeys([...keys, nextKey.current++]), set({ responses: [...d.responses, { ...emptyResponse(), position: d.responses.length }] }))}>+ 응답 추가</button>
        <div className="row">
          {saved && d.selectMode === 'sequential' && (
            <button className="ghost" onClick={() => api.resetCounter(project.id, saved.id).then(() => toast('순차 카운터를 초기화했습니다'))}>카운터 리셋</button>
          )}
          <button className="ghost" title={mockUrl(d.pathPattern)} onClick={() => copy(mockUrl(d.pathPattern), toast)}>URL 복사</button>
          <button className="ghost" onClick={guardedClose}>닫기</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? '저장 중…' : '저장 (Ctrl+S)'}</button>
        </div>
      </div>
      {saved ? <TryIt project={project} rule={saved} /> : <p className="muted">저장하면 “Try it”로 바로 호출해 볼 수 있습니다.</p>}
    </Modal>
  );
}
