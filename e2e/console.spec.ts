import { readFileSync } from 'node:fs';
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

  test('G10: 규칙 호출 URL 복사 (목록·편집기)', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const expected = `${baseURL}/m/${slug}/v2/orders/:id`;
    const clip = () => page.evaluate(() => navigator.clipboard.readText());

    await page.goto(`/__admin/#/p/${slug}/rules`);
    const row = page.locator('tbody tr', { hasText: '/v2/orders/:id' });
    await row.getByRole('button', { name: 'URL 복사', exact: true }).click();
    await expect(page.getByText('복사했습니다')).toBeVisible();
    expect(await clip()).toBe(expected);

    // 편집기: path를 바꾸면 복사되는 URL도 현재 입력값을 따른다
    await row.getByRole('button', { name: '편집' }).click();
    await modal(page).getByPlaceholder('/v2/orders/:id').fill('/changed/path');
    await modal(page).getByRole('button', { name: 'URL 복사', exact: true }).click();
    await expect.poll(clip).toBe(`${baseURL}/m/${slug}/changed/path`);

    // 미저장 변경이 있으므로 닫을 때 confirm → 수락
    page.once('dialog', (d) => void d.accept());
    await closeBtn(page).click();
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

// v4: 전역 프리셋 + 가져오기 미리보기/원자성
test.describe.serial('프리셋 / 가져오기 (v4)', () => {
  const presetName = `tok-${stamp}`;
  const slug2 = `e2e2-${stamp}`;
  const lastModal = (page: Page) => page.locator('.modal').last();

  test('규칙 편집기에서 프리셋으로 저장 → 다른 프로젝트에서 불러와 적용', async ({ page, request }) => {
    await page.goto(`/__admin/#/p/${slug}/rules`);
    await page.getByRole('button', { name: '+ 새 규칙' }).click();
    await page.getByPlaceholder('/v2/orders/:id').fill('/preset-src');
    await modal(page).locator('textarea').first().fill('WWW-Authenticate: Bearer');
    await modal(page).locator('textarea.mono').first().fill('{"error":"token_expired"}');
    await modal(page).getByRole('button', { name: '프리셋으로 저장' }).click();
    await lastModal(page).getByPlaceholder('예: 401 토큰 만료').fill(presetName);
    await lastModal(page).getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText(`프리셋 "${presetName}"을(를) 저장했습니다`)).toBeVisible();
    page.once('dialog', (d) => void d.accept()); // 미저장 규칙 닫기 확인
    await closeBtn(page).click();

    // 다른 프로젝트의 새 규칙에서 불러오기 (프리셋은 전역)
    expect((await request.post('/__admin/api/projects', { data: { slug: slug2, name: slug2 } })).status()).toBe(201);
    await page.goto(`/__admin/#/p/${slug2}/rules`);
    await page.reload(); // API로 만든 프로젝트라, 해시만 바꾼 이동으로는 열려 있는 화면의 프로젝트 목록이 갱신되지 않는다
    await page.getByRole('button', { name: '+ 새 규칙' }).click();
    await page.getByPlaceholder('/v2/orders/:id').fill('/preset-dst');
    await modal(page).getByRole('button', { name: '프리셋 불러오기' }).click();
    await lastModal(page).getByPlaceholder('이름 검색').fill(presetName);
    await lastModal(page).locator('tbody tr', { hasText: presetName }).getByRole('button', { name: '적용' }).click();
    await expect(modal(page).locator('textarea').first()).toHaveValue('WWW-Authenticate: Bearer');
    await expect(modal(page).locator('textarea.mono').first()).toHaveValue('{"error":"token_expired"}');
    await page.getByRole('button', { name: /^저장/ }).click();
    await expect(page.getByText('저장했습니다')).toBeVisible();

    const res = await request.get(`/m/${slug2}/preset-dst`);
    expect(res.status()).toBe(200);
    expect(res.headers()['www-authenticate']).toBe('Bearer');
    expect(await res.json()).toEqual({ error: 'token_expired' });
  });

  test('프리셋 Export → 삭제 → Import 로 복원', async ({ page }) => {
    await page.goto('/__admin/#/presets');
    await expect(page.locator('tbody tr', { hasText: presetName })).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
    const file = readFileSync((await dl.path())!);
    const json = JSON.parse(file.toString('utf8'));
    expect(json).toMatchObject({ version: 1, kind: 'presets' });
    expect(json.presets.map((p: any) => p.name)).toContain(presetName);

    page.once('dialog', (d) => void d.accept());
    await page.locator('tbody tr', { hasText: presetName }).getByRole('button', { name: '삭제' }).click();
    await expect(page.locator('tbody tr', { hasText: presetName })).toHaveCount(0);

    await page.locator('input[type=file]').setInputFiles({ name: 'presets.json', mimeType: 'application/json', buffer: file });
    await expect(modal(page).getByText(/신규 \d+/)).toBeVisible();
    await modal(page).getByRole('button', { name: '가져오기', exact: true }).click();
    await expect(page.getByText(/가져오기 완료/)).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: presetName })).toBeVisible();
  });

  test('잘못된 규칙 파일은 오류 위치를 보여주고 아무것도 바꾸지 않음, 올바른 파일은 가져옴', async ({ page, request }) => {
    await page.goto(`/__admin/#/p/${slug}/rules`);
    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    const upload = (obj: unknown) =>
      page.locator('input[type=file]').setInputFiles({ name: 'rules.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) });

    await upload({ version: 1, rules: [{ method: 'GET', path: '/ok-but-blocked' }, { method: 'GET', path: 'no-slash' }] });
    await expect(modal(page).getByText('가져올 수 없는 항목이 1개')).toBeVisible();
    await expect(modal(page).locator('.issues')).toContainText('#2 GET no-slash');
    await expect(modal(page).getByRole('button', { name: '가져오기', exact: true })).toBeDisabled();
    await modal(page).getByRole('button', { name: '취소' }).click();
    await expect(modal(page)).toHaveCount(0);
    expect(await rows.count()).toBe(before);
    expect((await request.get(`/m/${slug}/ok-but-blocked`)).status()).toBe(404);

    // 프리셋 파일을 규칙에 올리면 안내
    await upload({ version: 1, kind: 'presets', presets: [] });
    await expect(modal(page).locator('.issues')).toContainText('프리셋 파일');
    await modal(page).getByRole('button', { name: '취소' }).click();

    await upload({ version: 1, rules: [{ method: 'GET', path: '/imported-v4', responses: [{ status: 200, body: '{"ok":1}' }] }] });
    await expect(modal(page).getByText(/신규 1/)).toBeVisible();
    await modal(page).getByRole('button', { name: '가져오기', exact: true }).click();
    await expect(page.getByText(/가져오기 완료/)).toBeVisible();
    await expect(page.locator('tbody tr', { hasText: '/imported-v4' })).toBeVisible();
    expect(await (await request.get(`/m/${slug}/imported-v4`)).json()).toEqual({ ok: 1 });
  });
});
