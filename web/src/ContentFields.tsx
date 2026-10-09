import { useState } from 'react';
import { useToast } from './ui';

/** 응답/프리셋이 공유하는 "내용" 필드 */
export interface ContentValue {
  contentType: string;
  headers: Record<string, string>;
  body: string | null;
  bodyBase64: string | null;
}

const headersToText = (h: Record<string, string>) => Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n');
const textToHeaders = (t: string) =>
  Object.fromEntries(
    t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf(':');
      return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );

const MAX_BINARY_BYTES = 2 * 1024 * 1024;
export const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);
const base64Bytes = (b: string) => Math.floor((b.length * 3) / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0);
const readBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(f);
  });

/** 내용이 비어 있는지(기본값 상태인지). 프리셋을 덮어쓰기 전 확인 여부 판단에 사용 */
export const isContentEmpty = (v: ContentValue) =>
  !v.bodyBase64 && !Object.keys(v.headers).length && ['', '{}'].includes((v.body ?? '').trim());

/**
 * Content-Type / Headers / Body(텍스트 또는 바이너리 업로드) 입력부.
 * headers 텍스트는 내부 상태로 들고 있으므로, 값을 바깥에서 통째로 바꿀 때(프리셋 적용)는 부모가 `key`를 바꿔 다시 마운트한다.
 */
export function ContentFields({ value, onChange }: { value: ContentValue; onChange: (patch: Partial<ContentValue>) => void }) {
  const toast = useToast();
  const [headersText, setHeadersText] = useState(headersToText(value.headers));
  return (
    <>
      <label>Content-Type<input value={value.contentType} onChange={(e) => onChange({ contentType: e.target.value })} /></label>
      <label>Headers <span className="muted">(줄마다 <code>Key: Value</code>, {'{{ }}'} 사용 가능)</span>
        <textarea rows={2} value={headersText} onChange={(e) => (setHeadersText(e.target.value), onChange({ headers: textToHeaders(e.target.value) }))} />
      </label>
      {value.bodyBase64 ? (
        <div className="binary">
          <strong>바이너리 응답</strong> <span className="muted">{value.contentType} · {formatBytes(base64Bytes(value.bodyBase64))}</span>
          {value.contentType.startsWith('image/') && (
            <div><img src={`data:${value.contentType};base64,${value.bodyBase64}`} alt="미리보기" style={{ maxWidth: 240, maxHeight: 160, marginTop: 8 }} /></div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="ghost small" onClick={() => onChange({ bodyBase64: null, body: '' })}>제거 (텍스트 바디로 전환)</button>
          </div>
        </div>
      ) : (
        <>
          <label>Body <span className="muted">(<code>{'{{params.id}} {{query.x}} {{body.a.b}} {{uuid}} {{now}} {{random.int(1,9)}} {{faker.name}}'}</code>)</span>
            <textarea className="mono" rows={7} spellCheck={false} value={value.body ?? ''} onChange={(e) => onChange({ body: e.target.value })} />
          </label>
          <label>또는 파일 업로드 <span className="muted">(이미지·PDF 등 바이너리, 최대 {formatBytes(MAX_BINARY_BYTES)} — 업로드하면 텍스트 바디·템플릿은 사용되지 않음)</span>
            <input
              type="file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                if (f.size > MAX_BINARY_BYTES) return toast(`파일이 너무 큽니다 (${formatBytes(f.size)} > ${formatBytes(MAX_BINARY_BYTES)})`, true);
                try {
                  const b64 = await readBase64(f);
                  onChange({ bodyBase64: b64, body: null, contentType: f.type || 'application/octet-stream' });
                } catch {
                  toast('파일을 읽지 못했습니다', true);
                }
              }}
            />
          </label>
        </>
      )}
    </>
  );
}
