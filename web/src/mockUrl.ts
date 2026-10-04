import { api, type Project } from './api';
import { useAsync } from './ui';

/** 규칙의 호출 URL(`<베이스>/m/<slug><path>`)을 만든다. 베이스는 연결 가이드 탭과 같은 규칙(PUBLIC_BASE_URL > 현재 접속 origin). */
export function useMockUrl(project: Project) {
  const { data: info } = useAsync(api.serverInfo, []);
  const origin = info?.publicBaseUrl ?? location.origin;
  return (pathPattern: string) => `${origin}/m/${project.slug}${pathPattern}`;
}
