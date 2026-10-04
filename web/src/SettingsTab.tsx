import { useState } from 'react';
import { api, type Project, type Settings } from './api';
import { useToast } from './ui';

export function SettingsTab({ project, onChanged }: { project: Project; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(project.name);
  const [s, setS] = useState<Settings>(project.settings);
  const set = (patch: Partial<Settings>) => setS((x) => ({ ...x, ...patch }));
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: Number(e.target.value) } as Partial<Settings>);

  const save = async () => {
    try {
      await api.patchProject(project.id, { name, settings: s });
      toast('저장했습니다');
      onChanged();
    } catch (e: any) {
      toast(e.message, true);
    }
  };
  const remove = async () => {
    if (prompt(`프로젝트를 삭제하면 규칙과 로그가 모두 사라집니다.\n계속하려면 slug "${project.slug}" 를 입력하세요.`) !== project.slug) return;
    await api.deleteProject(project.id);
    location.hash = '#/';
  };

  return (
    <section className="settings">
      <label>프로젝트 이름<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <h3>전역 동작</h3>
      <div className="grid">
        <label>모든 응답에 추가 지연 (ms)<input type="number" min={0} value={s.extraDelayMs} onChange={num('extraDelayMs')} /></label>
        <label>에러 주입 확률 (%)<input type="number" min={0} max={100} value={s.errorRate} onChange={num('errorRate')} /></label>
        <label>주입할 에러 상태 코드<input type="number" min={200} max={599} value={s.errorStatus} onChange={num('errorStatus')} /></label>
        <label>미등록 요청 상태 코드<input type="number" min={200} max={599} value={s.unmatchedStatus} onChange={num('unmatchedStatus')} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={s.loop} onChange={(e) => set({ loop: e.target.checked })} /> 순차 응답을 끝까지 소진하면 처음부터 반복 (끄면 마지막 응답 유지)</label>
      <label className="check"><input type="checkbox" checked={s.cors} onChange={(e) => set({ cors: e.target.checked })} /> CORS 허용 (웹뷰/브라우저 테스트용)</label>
      <div className="row"><button className="primary" onClick={save}>저장</button></div>
      <hr />
      <h3>위험 구역</h3>
      <button className="ghost danger" onClick={remove}>프로젝트 삭제</button>
    </section>
  );
}
