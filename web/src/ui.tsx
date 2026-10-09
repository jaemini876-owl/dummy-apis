import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Toast = { id: number; text: string; error?: boolean };
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, error?: boolean) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6000 : 2200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}

// 모달이 겹쳐 열려도(편집기 위의 프리셋 선택 등) Esc는 가장 위의 모달만 닫는다
const modalStack: symbol[] = [];

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = Symbol('modal');
    modalStack.push(id);
    const h = (e: KeyboardEvent) => e.key === 'Escape' && modalStack[modalStack.length - 1] === id && closeRef.current();
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('keydown', h);
      modalStack.splice(modalStack.indexOf(id), 1);
    };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const copy = async (text: string, toast: (t: string) => void) => {
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했습니다');
  } catch {
    toast('복사 실패 — 직접 선택해 복사하세요');
  }
};

export function downloadJson(fileName: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const statusClass = (s: number | null) => (s === null ? 's-x' : s < 300 ? 's-ok' : s < 400 ? 's-redir' : s < 500 ? 's-4xx' : 's-5xx');
