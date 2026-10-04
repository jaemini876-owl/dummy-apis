import { expect, test, type Page } from '@playwright/test';

// 사전 조건: `npm run build` 완료 (server/dist, web/dist 사용). 파일 저장소 모드로 실행되며 Supabase를 쓰지 않는다.
const stamp = Date.now();
const slug = `e2e-${stamp}`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const modal = (page: Page) => page.locator('.modal');
const closeBtn = (page: Page) => page.locator('button.ghost', { hasText: /^닫기$/ });

test.describe('관리 콘솔 인증', () => {
  test('자격 증명 없이는 관리 API 401, 모의 API·healthz는 열려 있음', async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL, httpCredentials: undefined });
    expect((await anon.get('/__admin/api/projects')).status()).toBe(401);
    expect((await anon.get('/__admin/')).status()).toBe(401);
    expect((await anon.get('/healthz')).status()).toBe(200);
    expect((await anon.get('/m/nope/x')).status()).toBe(404); // project_not_found (인증 오류 아님)
    await anon.dispose();
  });
});

test.describe.serial('관리 콘솔 스모크', () => {
  test('프로젝트 생성 → 규칙 생성 → Try it → 로그 확인', async ({ page }) => {
    await page.goto('/__admin/');
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click();
    await page.getByLabel('이름').fill(`e2e ${stamp}`);
    await page.getByRole('button', { name: '만들기' }).click();
    await expect(page.getByRole('heading', { name: `e2e ${stamp}` })).toBeVisible();

    await page.getByRole('button', { name: '+ 새 규칙' }).click();
    await page.getByPlaceholder('/v2/orders/:id').fill('/v2/orders/:id');
    await modal(page).locator('textarea.mono').first().fill('{"id":"{{params.id}}"}');
    await page.getByRole('button', { name: /^저장/ }).click();
    await expect(page.getByText('저장했습니다')).toBeVisible();

    // Try it (기본 path는 :id → 1 로 치환됨)
    await page.getByRole('button', { name: '호출' }).click();
    await expect(page.locator('.tryit .badge')).toHaveText('200');
    await expect(page.locator('.tryit pre').first()).toContainText('{"id":"1"}');

    await closeBtn(page).click();
    await page.getByRole('link', { name: '로그' }).click();
    await expect(page.locator('tbody tr', { hasText: '/v2/orders/1' })).toBeVisible();
  });

  test('G3: 미저장 변경이 있을 때만 닫기 경고', async ({ page }) => {
    await page.goto(`/__admin/#/p/${slug}/rules`);
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.type());
      void d.dismiss();
    });

    // 변경 없음 → 경고 없이 닫힘
    await page.getByRole('button', { name: '+ 새 규칙' }).click();
    await closeBtn(page).click();
    await expect(modal(page)).toHaveCount(0);
    expect(dialogs).toHaveLength(0);

    // 변경 있음 → Esc에 confirm, 취소하면 유지
    await page.getByRole('button', { name: '+ 새 규칙' }).click();
    await page.getByPlaceholder('/v2/orders/:id').fill('/g3');
    await page.keyboard.press('Escape');
    await expect.poll(() => dialogs.length).toBe(1);
    await expect(modal(page)).toBeVisible();

    // 확인하면 닫힘
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => void d.accept());
    await closeBtn(page).click();
    await expect(modal(page)).toHaveCount(0);
  });

  test('G5: 바이너리 응답 업로드 → 서빙', async ({ page, request }) => {
    await page.goto(`/__admin/#/p/${slug}/rules`);
    await page.getByRole('button', { name: '+ 새 규칙' }).click();
    await page.getByPlaceholder('/v2/orders/:id').fill('/img.png');
    await modal(page).locator('input[type=file]').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
    await expect(modal(page).getByText('바이너리 응답')).toBeVisible();
    await expect(modal(page).locator('img[alt="미리보기"]')).toBeVisible();
    await page.getByRole('button', { name: /^저장/ }).click();
    await expect(page.getByText('저장했습니다')).toBeVisible();

    const res = await request.get(`/m/${slug}/img.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    expect((await res.body()).equals(PNG)).toBe(true);

    // 제거하면 텍스트 바디 입력으로 복귀
    await modal(page).getByRole('button', { name: /^제거/ }).click();
    await expect(modal(page).locator('textarea.mono').first()).toBeVisible();
  });
});
