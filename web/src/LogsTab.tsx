import { useEffect, useRef, useState } from 'react';
import { api, type LogEntry, type Project } from './api';
import { Modal, statusClass, useToast } from './ui';

export function LogsTab({ project }: { project: Project }) {
  const toast = useToast();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [onlyMiss, setOnlyMiss] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sel, setSel] = useState<LogEntry | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    let alive = true;
    api.logs(project.id).then((l) => alive && setLogs(l)).catch((e) => toast(e.message, true));
    const es = new EventSource(`/__admin/api/projects/${project.id}/logs/stream`);
    es.onmessage = (m) => {
      if (pausedRef.current) return;
      const e = JSON.parse(m.data) as LogEntry;
      setLogs((l) => [e, ...l].slice(0, 500));
    };
    return () => {
      alive = false;
      es.close();
    };
  }, [project.id]);

  const shown = onlyMiss ? logs.filter((l) => !l.matched) : logs;
  const toRule = async (l: LogEntry) => {
    try {
      await api.logToRule(project.id, l.id);
      toast('규칙을 만들었습니다 (200 {}) — 규칙 탭에서 응답을 수정하세요');
      setSel(null);
      location.hash = `#/p/${project.slug}/rules`;
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  return (
    <section>
      <div className="row between wrap">
        <div className="row">
          <label className="check"><input type="checkbox" checked={onlyMiss} onChange={(e) => setOnlyMiss(e.target.checked)} /> 미등록 요청만</label>
          <span className="muted">실시간 수신 중{paused ? ' (일시정지)' : ''}</span>
        </div>
        <div className="row">
          <button className="ghost" onClick={() => setPaused(!paused)}>{paused ? '재개' : '일시정지'}</button>
          <button className="ghost danger" onClick={() => confirm('로그를 모두 지울까요?') && api.clearLogs(project.id).then(() => setLogs([]))}>비우기</button>
        </div>
      </div>
      {shown.length === 0 && <div className="empty">아직 요청이 없습니다. 앱에서 <code>{location.origin}/m/{project.slug}/...</code> 를 호출해 보세요.</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>시간</th><th>Method</th><th>Path</th><th>상태</th><th>매칭</th><th>ms</th></tr></thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} className="click" onClick={() => setSel(l)}>
                <td className="muted">{new Date(l.createdAt).toLocaleTimeString()}</td>
                <td><span className={`method m-${l.method}`}>{l.method}</span></td>
                <td><code>{l.path}</code></td>
                <td><span className={`badge ${statusClass(l.status)}`}>{l.status ?? '—'}</span></td>
                <td>{l.matched ? '✓' : <span className="miss">미등록</span>}</td>
                <td className="muted">{l.latencyMs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && (
        <Modal title={`${sel.method} ${sel.path}`} onClose={() => setSel(null)} wide>
          <p>
            <span className={`badge ${statusClass(sel.status)}`}>{sel.status ?? '응답 없음(fault)'}</span>{' '}
            <span className="muted">{sel.latencyMs} ms · {sel.matched ? '규칙 매칭' : '미등록 요청'}</span>
          </p>
          {Object.keys(sel.query).length > 0 && <><h3>Query</h3><pre>{JSON.stringify(sel.query, null, 2)}</pre></>}
          <h3>요청 헤더</h3><pre>{JSON.stringify(sel.reqHeaders, null, 2)}</pre>
          <h3>요청 바디</h3><pre>{sel.reqBody ?? '(없음)'}</pre>
          <h3>응답 바디</h3><pre>{sel.resBody ?? '(없음)'}</pre>
          {!sel.matched && <div className="row end"><button className="primary" onClick={() => toRule(sel)}>이 요청으로 규칙 만들기</button></div>}
        </Modal>
      )}
    </section>
  );
}
