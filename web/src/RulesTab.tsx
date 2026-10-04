import { useRef, useState } from 'react';
import { api, emptyRule, type Project, type Rule } from './api';
import { RuleEditor } from './RuleEditor';
import { useMockUrl } from './mockUrl';
import { copy, useAsync, useToast } from './ui';

const MODE_LABEL = { fixed: '고정', sequential: '순차', weighted: '가중치', conditional: '조건별' } as const;

export function RulesTab({ project }: { project: Project }) {
  const toast = useToast();
  const { data: rules, error, reload } = useAsync(() => api.rules(project.id), [project.id]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Rule | ReturnType<typeof emptyRule> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mockUrl = useMockUrl(project);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok);
      reload();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const doExport = async () => {
    const data = await api.exportRules(project.id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `${project.slug}-rules.json`;
    a.click();
  };
  const doImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const replace = confirm('기존 규칙을 모두 교체할까요?\n확인 = 교체, 취소 = 병합(같은 method+path는 덮어쓰기)');
      const r = await api.importRules(project.id, data, replace ? 'replace' : 'merge');
      toast(`가져오기 완료: 생성 ${r.created}, 갱신 ${r.updated}`);
      reload();
    } catch (e: any) {
      toast(`가져오기 실패: ${e.message}`, true);
    }
  };

  const shown = rules?.filter((r) => !q || r.pathPattern.toLowerCase().includes(q.toLowerCase()) || (r.name ?? '').toLowerCase().includes(q.toLowerCase()));

  return (
    <section>
      <div className="row between wrap">
        <input className="search" placeholder="path / 이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row">
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          <button className="ghost" onClick={() => fileRef.current?.click()}>Import</button>
          <button className="ghost" onClick={doExport}>Export</button>
          <button className="primary" onClick={() => setEditing(emptyRule())}>+ 새 규칙</button>
        </div>
      </div>
      {error && <div className="banner err">{error}</div>}
      {rules?.length === 0 && (
        <div className="empty">
          등록된 규칙이 없습니다. “새 규칙”을 만들거나, 앱에서 먼저 호출한 뒤 <a href={`#/p/${project.slug}/logs`}>로그</a>에서 미등록 요청을 규칙으로 만들 수 있습니다.
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>활성</th><th>Method</th><th>Path</th><th>응답</th><th></th></tr></thead>
          <tbody>
            {shown?.map((r) => (
              <tr key={r.id} className={r.enabled ? '' : 'off'}>
                <td><input type="checkbox" checked={r.enabled} onChange={(e) => run(() => api.toggleRule(project.id, r.id, e.target.checked))} aria-label="활성" /></td>
                <td><span className={`method m-${r.method}`}>{r.method}</span></td>
                <td>
                  <a href="#" onClick={(e) => (e.preventDefault(), setEditing(r))}><code>{r.pathPattern}</code></a>
                  {r.name && <div className="muted">{r.name}</div>}
                </td>
                <td className="muted">
                  {r.responses.map((x) => x.status).join(' → ')} · {MODE_LABEL[r.selectMode]}
                </td>
                <td className="actions">
                  <button className="ghost small" onClick={() => setEditing(r)}>편집</button>
                  <button className="ghost small" title={mockUrl(r.pathPattern)} onClick={() => copy(mockUrl(r.pathPattern), toast)}>URL 복사</button>
                  <button className="ghost small" onClick={() => run(() => api.duplicateRule(project.id, r.id), '복제했습니다')}>복제</button>
                  <button className="ghost small danger" onClick={() => confirm(`${r.method} ${r.pathPattern} 규칙을 삭제할까요?`) && run(() => api.deleteRule(project.id, r.id), '삭제했습니다')}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <RuleEditor
          key={'id' in editing ? editing.id : 'new'}
          project={project}
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </section>
  );
}
