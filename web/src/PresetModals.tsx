import { useState } from 'react';
import { api, type Preset } from './api';
import { isContentEmpty, type ContentValue } from './ContentFields';
import { Modal, useAsync, useToast } from './ui';

const nameKey = (s: string) => s.trim().toLowerCase();
const preview = (p: Preset) => (p.bodyBase64 ? '(바이너리)' : (p.body ?? '').replace(/\s+/g, ' ').slice(0, 70));

/** 규칙 편집기에서 프리셋을 골라 현재 응답의 Content-Type/Headers/Body로 복사한다 */
export function PresetPicker({ current, onPick, onClose }: { current: ContentValue; onPick: (p: Preset) => void; onClose: () => void }) {
  const { data, error } = useAsync(api.presets, []);
  const [q, setQ] = useState('');
  const shown = data?.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const pick = (p: Preset) => {
    if (!isContentEmpty(current) && !confirm(`현재 Content-Type / Headers / Body를 "${p.name}" 프리셋 내용으로 덮어쓸까요?`)) return;
    onPick(p);
  };
  return (
    <Modal title="프리셋 불러오기" onClose={onClose} wide>
      <input autoFocus placeholder="이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <div className="banner err">{error}</div>}
      {data?.length === 0 && (
        <div className="empty">저장된 프리셋이 없습니다. 응답을 작성한 뒤 “프리셋으로 저장”을 누르거나, 상단 “프리셋” 화면에서 파일을 가져오세요.</div>
      )}
      {shown && shown.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>이름</th><th>Content-Type</th><th>내용</th><th></th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td><code>{p.contentType}</code></td>
                  <td className="muted"><code>{preview(p)}</code>{Object.keys(p.headers).length > 0 && <span> · 헤더 {Object.keys(p.headers).length}</span>}</td>
                  <td><button className="primary small" onClick={() => pick(p)}>적용</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** 현재 편집 중인 응답의 내용을 이름 붙여 프리셋으로 저장 (같은 이름이면 덮어쓰기 확인) */
export function SavePresetModal({ value, onClose }: { value: ContentValue; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const input = { name: name.trim(), contentType: value.contentType, headers: value.headers, body: value.bodyBase64 ? null : value.body, bodyBase64: value.bodyBase64 };
      const same = (await api.presets()).find((p) => nameKey(p.name) === nameKey(input.name));
      if (same) {
        if (!confirm(`"${same.name}" 프리셋이 이미 있습니다. 덮어쓸까요?`)) return setBusy(false);
        await api.updatePreset(same.id, input);
      } else {
        await api.createPreset(input);
      }
      toast(`프리셋 "${input.name}"을(를) 저장했습니다`);
      onClose();
    } catch (e: any) {
      toast(e.message, true);
      setBusy(false);
    }
  };
  return (
    <Modal title="프리셋으로 저장" onClose={onClose}>
      <label>이름
        <input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && !busy && submit()} placeholder="예: 401 토큰 만료" />
      </label>
      <p className="muted">Content-Type, Headers, Body가 저장되고 모든 프로젝트에서 쓸 수 있습니다. Status·지연·장애 설정은 포함되지 않습니다.</p>
      <div className="row end">
        <button className="ghost" onClick={onClose}>취소</button>
        <button className="primary" disabled={!name.trim() || busy} onClick={submit}>저장</button>
      </div>
    </Modal>
  );
}
