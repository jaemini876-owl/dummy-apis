import { useEffect, useState } from 'react';
import type { ImportDone, ImportMode, ImportReport } from './api';
import { Modal, useToast } from './ui';

/**
 * 규칙/프리셋 공용 가져오기 창. 열리면 검증 미리보기(dryRun)를 보여주고,
 * 문제가 없을 때만 [가져오기]가 활성화된다. 문제가 있으면 서버는 아무것도 바꾸지 않는다.
 */
export function ImportModal({
  noun, fileName, existingCount, preview, run, onClose, onDone,
}: {
  noun: string;
  fileName: string;
  existingCount?: number;
  preview: (mode: ImportMode) => Promise<ImportReport>;
  run: (mode: ImportMode) => Promise<ImportDone>;
  onClose: () => void;
  onDone: (r: ImportDone) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<ImportMode>('merge');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setReport(null);
    setError(null);
    preview(mode)
      .then((r) => alive && setReport(r))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const submit = async () => {
    setBusy(true);
    try {
      onDone(await run(mode));
    } catch (e: any) {
      toast(`가져오기 실패: ${e.message}`, true);
      setBusy(false);
    }
  };

  const s = report?.summary;
  return (
    <Modal title={`${noun} 가져오기`} onClose={onClose} wide>
      <p className="muted">파일: <code>{fileName}</code></p>
      <div className="import-modes">
        <label className="radio"><input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
          병합 <span className="muted">— 같은 {noun === '규칙' ? 'method+path' : '이름'}는 파일 내용으로 덮어쓰고, 나머지는 유지</span></label>
        <label className="radio"><input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
          교체 <span className="muted">— 기존 {noun}을(를) 모두 삭제하고 파일 내용으로 대체</span></label>
      </div>
      {error && <div className="banner err">{error}</div>}
      {!report && !error && <p className="muted">검증 중…</p>}
      {report && s && (
        <>
          <p className="import-summary">
            <strong>신규 {s.create}</strong> · <strong>덮어쓰기 {s.update}</strong> · <strong className={s.delete ? 'danger' : ''}>삭제 {s.delete}</strong>
            {mode === 'replace' && existingCount !== undefined && existingCount > 0 && <span className="muted"> (현재 {noun} {existingCount}개)</span>}
          </p>
          {report.issues.length > 0 && (
            <div className="banner err">
              <strong>가져올 수 없는 항목이 {report.issues.length}개 있습니다. 파일을 고친 뒤 다시 시도하세요. (아무것도 변경되지 않습니다)</strong>
              <ul className="issues">
                {report.issues.slice(0, 50).map((i, n) => (
                  <li key={n}>
                    {i.index > 0 ? <code>#{i.index}{i.label ? ` ${i.label}` : ''}</code> : <code>파일</code>} · <code>{i.path}</code> — {i.message}
                  </li>
                ))}
              </ul>
              {report.issues.length > 50 && <p className="muted">…외 {report.issues.length - 50}개</p>}
            </div>
          )}
        </>
      )}
      <div className="row end">
        <button className="ghost" onClick={onClose}>취소</button>
        <button className={mode === 'replace' ? 'primary danger-btn' : 'primary'} disabled={!report?.ok || busy} onClick={submit}>
          {busy ? '가져오는 중…' : mode === 'replace' ? '교체해서 가져오기' : '가져오기'}
        </button>
      </div>
    </Modal>
  );
}
