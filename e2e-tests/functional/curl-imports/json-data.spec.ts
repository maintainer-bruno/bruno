import { test, expect } from '../../../playwright';

let testCounter = 0;

test.beforeAll(async ({ page, createTmpDir }) => {
  await page.getByLabel('Create Collection').click();
  await page.getByLabel('Name').click();
  await page.getByLabel('Name').fill('test-collection');
  await page.getByLabel('Name').press('Tab');
  await page.getByLabel('Location').fill(await createTmpDir('test-collection'));
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByText('test-collection').click();
  await page.getByLabel('Safe ModeBETA').check();
  await page.getByRole('button', { name: 'Save' }).click();
});

test.beforeEach(async ({ page }) => {
  testCounter++;
  await page.locator('#create-new-tab').getByRole('img').click();
  await page.locator('#from-curl').click();
  await page.locator('#request-name').fill(`test-request-${testCounter}`);
});

test.afterEach(async ({ page }) => {
  await page.waitForTimeout(3000);
});

test('Create new collection and add a simple HTTP request', async ({ page }) => {
  await page.locator('textarea.curl-command').fill(`
  curl --location 'https://httpbin.org/post' \
    --header 'Content-Type: application/json' \
    --data '{
        \"text\": \"som'e long sentence\"
    }'
  `);
  await page.locator('button.submit').click();

  await expect(page.locator('.CodeMirror-lint-marker-error')).toBeVisible();
});


test('Create new collection and add a simple HTTP request with valid JSON', async ({ page }) => {
  await page.locator('textarea.curl-command').fill(`
  curl --location 'https://httpbin.org/post' \
    --header 'Content-Type: application/json' \
    --data '{
        "text": "some long sentence"
    }'
  `);
  await page.locator('button.submit').click();

  await expect(page.locator('.CodeMirror-lint-marker-error')).not.toBeVisible();
});