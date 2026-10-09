import { useRef, useState } from 'react';
import { api, type Preset, type PresetInput } from './api';
import { ContentFields } from './ContentFields';
import { ImportModal } from './ImportModal';
import { downloadJson, Modal, useAsync, useToast } from './ui';

const emptyPreset = (): PresetInput => ({ name: '', contentType: 'application/json', headers: {}, body: '{}', bodyBase64: null });
const bodyPreview = (p: Preset) => (p.bodyBase64 ? '(바이너리)' : (p.body ?? '').replace(/\s+/g, ' ').slice(0, 80));

function PresetEditor({ preset, onClose, onSaved }: { preset: Preset | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState<PresetInput>(preset ? { name: preset.name, contentType: preset.contentType, headers: preset.headers, body: preset.body, bodyBase64: preset.bodyBase64 } : emptyPreset());
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const input = { ...v, name: v.name.trim(), body: v.bodyBase64 ? null : v.body ?? '' };
      if (preset) await api.updatePreset(preset.id, input);
      else await api.createPreset(input);
      toast('저장했습니다');
      onSaved();
    } catch (e: any) {
      toast(e.message, true);
      setBusy(false);
    }
  };
  return (
    <Modal title={preset ? '프리셋 편집' : '새 프리셋'} onClose={onClose} wide>
      <label>이름<input autoFocus maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="예: 401 토큰 만료" /></label>
      <ContentFields value={v} onChange={(patch) => setV((cur) => ({ ...cur, ...patch }))} />
      <div className="row end">
        <button className="ghost" onClick={onClose}>취소</button>
        <button className="primary" disabled={!v.name.trim() || busy} onClick={save}>저장</button>
      </div>
    </Modal>
  );
}

/** 전역 프리셋 관리 화면 (#/presets) */
export function PresetsPage() {
  const toast = useToast();
  const { data, error, reload } = useAsync(api.presets, []);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Preset | 'new' | null>(null);
  const [importing, setImporting] = useState<{ fileName: string; data: unknown } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const shown = data?.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const doExport = async () => {
    try {
      downloadJson('presets.json', await api.exportPresets());
    } catch (e: any) {
      toast(e.message, true);
    }
  };
  const pickFile = async (f: File) => {
    try {
      setImporting({ fileName: f.name, data: JSON.parse(await f.text()) });
    } catch {
      toast('JSON 파일을 읽지 못했습니다. 올바른 JSON인지 확인하세요', true);
    }
  };
  const remove = async (p: Preset) => {
    if (!confirm(`"${p.name}" 프리셋을 삭제할까요?\n(이미 규칙에 적용된 내용에는 영향이 없습니다)`)) return;
    try {
      await api.deletePreset(p.id);
      toast('삭제했습니다');
      reload();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  return (
    <main className="page">
      <header className="top">
        <div>
          <a href="#/" className="crumb">← 프로젝트</a>
          <h1>응답 프리셋</h1>
        </div>
      </header>
      <p className="muted">자주 쓰는 Content-Type · Headers · Body를 저장해 두고, 어느 프로젝트의 규칙 편집기에서나 불러올 수 있습니다. 적용하면 값이 응답으로 <strong>복사</strong>되므로 이후 프리셋을 고쳐도 기존 규칙은 바뀌지 않습니다.</p>
      <div className="row between wrap">
        <input className="search" placeholder="이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="row">
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => (e.target.files?.[0] && pickFile(e.target.files[0]), (e.target.value = ''))} />
          <button className="ghost" onClick={() => fileRef.current?.click()}>Import</button>
          <button className="ghost" onClick={doExport}>Export</button>
          <button className="primary" onClick={() => setEditing('new')}>+ 새 프리셋</button>
        </div>
      </div>
      <p className="muted small-note">Export 파일에는 Headers/Body가 그대로 들어갑니다. 토큰 같은 민감한 값이 있다면 공유·커밋 전에 확인하세요.</p>
      {error && <div className="banner err">{error}</div>}
      {data?.length === 0 && <div className="empty">저장된 프리셋이 없습니다. “새 프리셋”을 만들거나 규칙 편집기에서 “프리셋으로 저장”을 누르세요.</div>}
      {shown && shown.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>이름</th><th>Content-Type</th><th>Headers</th><th>Body</th><th></th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td><a href="#" onClick={(e) => (e.preventDefault(), setEditing(p))}><strong>{p.name}</strong></a></td>
                  <td><code>{p.contentType}</code></td>
                  <td className="muted">{Object.keys(p.headers).length}개</td>
                  <td className="muted"><code>{bodyPreview(p)}</code></td>
                  <td>
                    <div className="row">
                      <button className="ghost small" onClick={() => setEditing(p)}>편집</button>
                      <button className="ghost small" onClick={() => remove(p)}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <PresetEditor
          preset={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), reload())}
        />
      )}
      {importing && (
        <ImportModal
          noun="프리셋"
          fileName={importing.fileName}
          existingCount={data?.length}
          preview={(mode) => api.previewImportPresets(importing.data, mode)}
          run={(mode) => api.importPresets(importing.data, mode)}
          onClose={() => setImporting(null)}
          onDone={(r) => {
            toast(`가져오기 완료: 신규 ${r.created}, 덮어쓰기 ${r.updated}${r.deleted ? `, 삭제 ${r.deleted}` : ''}`);
            setImporting(null);
            reload();
          }}
        />
      )}
    </main>
  );
}
