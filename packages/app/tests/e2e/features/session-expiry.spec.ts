import { DEFAULT_TEST_USER } from '../global-setup-fullstack';
import { expect, test } from '../utils/base-test';

test.describe('Session expiry', { tag: ['@auth', '@full-stack'] }, () => {
  test('returns to a fresh login page after expiry with cached team data', async ({
    page,
    context,
  }) => {
    // Do not invalidate the saved session shared by other specs.
    await context.clearCookies();
    const login = await page.request.post('/api/login/password', {
      data: DEFAULT_TEST_USER,
      maxRedirects: 0,
    });
    expect(login.status()).toBe(303);
    await page.goto('/team?tab=api-agents', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('tab', { name: 'API & Agents' }),
    ).toHaveAttribute('aria-selected', 'true');

    let loginDocuments = 0;
    page.on('request', request => {
      if (
        request.isNavigationRequest() &&
        new URL(request.url()).pathname === '/login'
      )
        loginDocuments++;
    });
    // Clearing cookies alone races with in-flight rolling Set-Cookie responses.
    const logout = await page.request.post('/api/logout', {
      headers: { Origin: new URL(page.url()).origin },
      maxRedirects: 0,
    });
    expect(logout.status()).toBe(303);
    expect((await page.request.get('/api/me')).status()).toBe(401);
    const loginNavigation = page.waitForRequest(
      request =>
        request.isNavigationRequest() &&
        new URL(request.url()).pathname === '/login',
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event('visibilitychange')),
    );
    await loginNavigation;

    await page.waitForURL(/\/login$/, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByText('Welcome back!', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('hdx-login-redirect-url'),
      ),
    ).toBe('/team?tab=api-agents');

    await page
      .getByLabel('Email', { exact: true })
      .fill('expired-session@example.com');
    const unauthorized = page.waitForResponse(
      response =>
        new URL(response.url()).pathname === '/api/team' &&
        response.status() === 401,
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event('visibilitychange')),
    );
    await (await unauthorized).finished();
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
      'expired-session@example.com',
    );
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(loginDocuments).toBe(1);
  });

  for (const status of [403, 500]) {
    test(`does not discard an authenticated session on HTTP ${status}`, async ({
      page,
    }) => {
      await page.goto('/team?tab=api-agents', {
        waitUntil: 'domcontentloaded',
      });
      await expect(
        page.getByRole('tab', { name: 'API & Agents' }),
      ).toHaveAttribute('aria-selected', 'true');
      await page.route('**/api/team', route =>
        route.fulfill({ status, json: { message: 'Test request failure' } }),
      );
      const rejected = page.waitForResponse(
        response =>
          new URL(response.url()).pathname === '/api/team' &&
          response.status() === status,
      );
      await page.evaluate(() =>
        window.dispatchEvent(new Event('visibilitychange')),
      );
      await (await rejected).finished();
      expect((await page.request.get('/api/me')).status()).toBe(200);
      expect(page.url()).toMatch(/\/team\?tab=api-agents$/);
      expect(
        await page.evaluate(() =>
          sessionStorage.getItem('hdx-login-redirect-url'),
        ),
      ).toBeNull();
    });
  }
});
