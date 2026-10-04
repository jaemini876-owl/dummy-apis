import type { FastifyRequest } from 'fastify';

export interface CurrentUser {
  id: string | null;
  anonymous: boolean;
}

/**
 * 관리 API의 단일 인증 진입점. 현재는 모두 anonymous.
 * 유저 기반 전환 시 Supabase JWT 검증으로 교체하고 project_members/RLS와 연결한다.
 */
export async function getCurrentUser(_req: FastifyRequest): Promise<CurrentUser> {
  return { id: null, anonymous: true };
}
