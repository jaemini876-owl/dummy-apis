import { useEffect, useState } from 'react';
import { api, type Project } from './api';
import { GuideTab } from './GuideTab';
import { LogsTab } from './LogsTab';
import { PresetsPage } from './PresetsPage';
import { RulesTab } from './RulesTab';
import { SettingsTab } from './SettingsTab';
import { copy, Modal, ToastProvider, useAsync, useToast } from './ui';

const TABS = [
  ['rules', '규칙'],
  ['logs', '로그'],
  ['settings', '설정'],
  ['guide', '연결 가이드'],
] as const;
type Tab = (typeof TABS)[number][0];

function parseHash(): { slug: string | null; tab: Tab; presets: boolean } {
  const m = /^#\/p\/([^/]+)(?:\/(\w+))?/.exec(location.hash);
  const tab = (TABS.find((t) => t[0] === m?.[2])?.[0] ?? 'rules') as Tab;
  return { slug: m ? decodeURIComponent(m[1]) : null, tab, presets: /^#\/presets\/?$/.test(location.hash) };
}

function useRoute() {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const h = () => setR(parseHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  return r;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 39);

function NewProject({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const submit = async () => {
    try {
      onCreated(await api.createProject({ name, slug: touched ? slug : slugify(name) }));
    } catch (e: any) {
      toast(e.message, true);
    }
  };
  return (
    <Modal title="새 프로젝트" onClose={onClose}>
      <label>이름<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 쇼핑앱 (dev)" /></label>
      <label>
        Slug (URL에 사용)
        <input value={touched ? slug : slugify(name)} onChange={(e) => (setTouched(true), setSlug(e.target.value))} placeholder="shop-dev" />
      </label>
      <p className="muted">앱 베이스 URL: <code>{location.origin}/m/{(touched ? slug : slugify(name)) || 'slug'}</code></p>
      <div className="row end">
        <button className="ghost" onClick={onClose}>취소</button>
        <button className="primary" disabled={!name.trim()} onClick={submit}>만들기</button>
      </div>
    </Modal>
  );
}

function ProjectList() {
  const { data, error, reload } = useAsync(api.projects, []);
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  return (
    <main className="page">
      <header className="top">
        <h1>Dummy API Console</h1>
        <div className="row">
          <a href="#/presets" className="btn-link">응답 프리셋</a>
          <button className="primary" onClick={() => setCreating(true)}>+ 새 프로젝트</button>
        </div>
      </header>
      <p className="muted">프로젝트마다 고유한 베이스 URL이 생기고, 그 아래에서 원하는 path/응답을 등록해 앱에서 호출할 수 있습니다.</p>
      {error && <div className="banner err">{error}</div>}
      {data?.length === 0 && <div className="empty">아직 프로젝트가 없습니다. “새 프로젝트”로 시작하세요.</div>}
      <div className="cards">
        {data?.map((p) => (
          <a key={p.id} className="card" href={`#/p/${p.slug}`}>
            <strong>{p.name}</strong>
            <code>{location.origin}/m/{p.slug}</code>
            <button
              className="ghost small"
              onClick={(e) => (e.preventDefault(), copy(`${location.origin}/m/${p.slug}`, toast))}
            >URL 복사</button>
          </a>
        ))}
      </div>
      {creating && (
        <NewProject
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            reload();
            location.hash = `#/p/${p.slug}`;
          }}
        />
      )}
    </main>
  );
}

function ProjectView({ slug, tab }: { slug: string; tab: Tab }) {
  const { data: projects, error, reload } = useAsync(api.projects, []);
  const project = projects?.find((p) => p.slug === slug);
  return (
    <main className="page">
      <header className="top">
        <div>
          <a href="#/" className="crumb">← 프로젝트</a> <span className="muted">·</span> <a href="#/presets" className="crumb">응답 프리셋</a>
          <h1>{project?.name ?? slug}</h1>
          <code className="muted">/m/{slug}</code>
        </div>
      </header>
      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <a key={k} href={`#/p/${slug}/${k}`} className={tab === k ? 'active' : ''}>{label}</a>
        ))}
      </nav>
      {error && <div className="banner err">{error}</div>}
      {projects && !project && <div className="banner err">프로젝트를 찾을 수 없습니다.</div>}
      {project && tab === 'rules' && <RulesTab project={project} />}
      {project && tab === 'logs' && <LogsTab project={project} />}
      {project && tab === 'settings' && <SettingsTab project={project} onChanged={reload} />}
      {project && tab === 'guide' && <GuideTab project={project} />}
    </main>
  );
}

export function App() {
  const { slug, tab, presets } = useRoute();
  return <ToastProvider>{presets ? <PresetsPage /> : slug ? <ProjectView slug={slug} tab={tab} /> : <ProjectList />}</ToastProvider>;
}
