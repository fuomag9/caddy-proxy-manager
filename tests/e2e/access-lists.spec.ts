/**
 * E2E tests: Access Lists page (redesigned split layout).
 *
 * Covers: page load, rail navigation, search, sort, create dialog,
 * members tab (add/remove/bulk/regenerate), settings tab (edit/delete with confirmation),
 * used-by tab, keyboard shortcuts, and empty states.
 *
 * Runs as admin (testadmin) — the page requires admin role.
 */
import { test, expect, type Page } from '@playwright/test';

const API = 'http://localhost:3000/api/v1/access-lists';

/** Helper: create an access list via the REST API and return its data. */
async function apiCreateList(
  page: Page,
  name: string,
  opts?: { description?: string; users?: { username: string; password: string }[] }
) {
  const res = await page.request.post(API, {
    headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
    data: {
      name,
      description: opts?.description ?? null,
      users: opts?.users ?? [],
    },
  });
  expect(res.ok(), `API create list "${name}" failed: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return body as { id: number; name: string; entries: { id: number; username: string }[] };
}

/** Helper: delete an access list via the REST API (silent on 404). */
async function apiDeleteList(page: Page, id: number) {
  if (id < 0) return;
  await page.request.delete(`${API}/${id}`, {
    headers: { 'Origin': 'http://localhost:3000' },
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Page load / structure
// ---------------------------------------------------------------------------

test.describe('Access Lists — page load', () => {
  test('page loads without redirecting to login', async ({ page }) => {
    await page.goto('/access-lists');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('shows the left rail with "Access Lists" heading', async ({ page }) => {
    await page.goto('/access-lists');
    await expect(page.getByRole('heading', { name: 'Access Lists' })).toBeVisible();
    await expect(page.getByText('HTTP basic auth')).toBeVisible();
  });

  test('shows a "New" button in the rail', async ({ page }) => {
    await page.goto('/access-lists');
    await expect(page.getByRole('button', { name: /^new$/i }).first()).toBeVisible();
  });

  test('shows search input with Cmd+K hint', async ({ page }) => {
    await page.goto('/access-lists');
    await expect(page.getByPlaceholder(/search lists or members/i)).toBeVisible();
  });

  test('shows sort buttons (Recent, Name, Members, Usage)', async ({ page }) => {
    await page.goto('/access-lists');
    for (const label of ['Recent', 'Name', 'Members', 'Usage']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

test.describe('Access Lists — empty state', () => {
  test('shows "Select an access list" when no list is selected', async ({ page }) => {
    // Delete all lists first to ensure empty state
    const res = await page.request.get(API);
    const lists = await res.json() as { id: number }[];
    for (const l of lists) {
      await apiDeleteList(page, l.id);
    }

    await page.goto('/access-lists');
    await expect(page.getByText('Select an access list')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

test.describe('Access Lists — create dialog', () => {
  test('clicking New opens the create dialog', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByRole('button', { name: /^new$/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('New access list')).toBeVisible();
  });

  test('create dialog has Name, Description, and Seed members fields', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByRole('button', { name: /^new$/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByPlaceholder(/internal.*engineering/i)).toBeVisible();
    await expect(dialog.getByPlaceholder(/what is this list for/i)).toBeVisible();
    await expect(dialog.getByPlaceholder('username')).toBeVisible();
    await expect(dialog.getByPlaceholder('password')).toBeVisible();
  });

  test('Create button is disabled when name is empty', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByRole('button', { name: /^new$/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: /create list/i })).toBeDisabled();
  });

  test('create list with name only — appears in rail', async ({ page }) => {
    const listName = `E2E Create ${Date.now()}`;
    await page.goto('/access-lists');
    await page.getByRole('button', { name: /^new$/i }).first().click();
    const dialog = page.getByRole('dialog');

    await dialog.getByPlaceholder(/internal.*engineering/i).fill(listName);
    await dialog.getByRole('button', { name: /create list/i }).click();

    // Dialog closes
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    // Name appears as heading in detail pane
    await expect(page.getByRole('heading', { name: listName })).toBeVisible({ timeout: 10_000 });

    // Cleanup
    const res = await page.request.get(API);
    const lists = await res.json() as { id: number; name: string }[];
    const created = lists.find((l) => l.name === listName);
    if (created) await apiDeleteList(page, created.id);
  });

  test('create list with description — description shows in detail pane', async ({ page }) => {
    const listName = `E2E Desc ${Date.now()}`;
    await page.goto('/access-lists');
    await page.getByRole('button', { name: /^new$/i }).first().click();
    const dialog = page.getByRole('dialog');

    await dialog.getByPlaceholder(/internal.*engineering/i).fill(listName);
    await dialog.getByPlaceholder(/what is this list for/i).fill('Test description');
    await dialog.getByRole('button', { name: /create list/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Test description')).toBeVisible({ timeout: 10_000 });

    // Cleanup
    const res = await page.request.get(API);
    const lists = await res.json() as { id: number; name: string }[];
    const created = lists.find((l) => l.name === listName);
    if (created) await apiDeleteList(page, created.id);
  });

  test('create list with seed members — members count shows', async ({ page }) => {
    const listName = `E2E Seed ${Date.now()}`;
    await page.goto('/access-lists');
    await page.getByRole('button', { name: /^new$/i }).first().click();
    const dialog = page.getByRole('dialog');

    await dialog.getByPlaceholder(/internal.*engineering/i).fill(listName);
    await dialog.getByPlaceholder('username').first().fill('seeduser');
    await dialog.getByPlaceholder('password').first().fill('SeedPassword!123');
    await dialog.getByRole('button', { name: /create list/i }).click();

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    // Detail header should show "1 member" badge
    await expect(page.getByText('1 member', { exact: false }).first()).toBeVisible({ timeout: 10_000 });

    // Cleanup
    const res = await page.request.get(API);
    const lists = await res.json() as { id: number; name: string }[];
    const created = lists.find((l) => l.name === listName);
    if (created) await apiDeleteList(page, created.id);
  });

  test('add another member link adds a second seed row', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByRole('button', { name: /^new$/i }).first().click();
    const dialog = page.getByRole('dialog');

    await expect(dialog.getByPlaceholder('username')).toHaveCount(1);
    await dialog.getByText('+ Add another member').click();
    await expect(dialog.getByPlaceholder('username')).toHaveCount(2);
  });

  test('generate password button fills password in seed row', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByRole('button', { name: /^new$/i }).first().click();
    const dialog = page.getByRole('dialog');

    const pwInput = dialog.getByPlaceholder('password').first();
    await expect(pwInput).toHaveValue('');

    await dialog.getByTitle('Generate password').click();
    const val = await pwInput.inputValue();
    expect(val.length).toBeGreaterThanOrEqual(16);
  });

  test('Cancel closes the create dialog', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByRole('button', { name: /^new$/i }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Rail — selection, search, sort
// ---------------------------------------------------------------------------

test.describe('Access Lists — rail interaction', () => {
  let listA: { id: number; name: string };
  let listB: { id: number; name: string };

  test.beforeEach(async ({ page }) => {
    listA = await apiCreateList(page, `E2E Alpha ${Date.now()}`, {
      description: 'First list',
      users: [{ username: 'alice', password: 'Pass1234!abc' }],
    });
    listB = await apiCreateList(page, `E2E Beta ${Date.now()}`, {
      description: 'Second list',
      users: [
        { username: 'bob', password: 'Pass1234!abc' },
        { username: 'carol', password: 'Pass1234!abc' },
      ],
    });
  });

  test.afterEach(async ({ page }) => {
    await apiDeleteList(page, listA.id);
    await apiDeleteList(page, listB.id);
  });

  test('clicking a list in the rail selects it and shows detail', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByText(listA.name).first().click();
    await expect(page.getByRole('heading', { name: listA.name })).toBeVisible({ timeout: 5_000 });
  });

  test('clicking a different list switches the detail pane', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByText(listA.name).first().click();
    await expect(page.getByRole('heading', { name: listA.name })).toBeVisible({ timeout: 5_000 });

    await page.getByText(listB.name).first().click();
    await expect(page.getByRole('heading', { name: listB.name })).toBeVisible({ timeout: 5_000 });
  });

  test('search filters lists in the rail', async ({ page }) => {
    await page.goto('/access-lists');
    const search = page.getByPlaceholder(/search lists or members/i);
    const rail = page.locator('ul');
    await search.fill('Alpha');

    await expect(rail.getByText(listA.name)).toBeVisible();
    await expect(rail.getByText(listB.name)).not.toBeVisible({ timeout: 3_000 });
  });

  test('search by member username filters correctly', async ({ page }) => {
    await page.goto('/access-lists');
    const search = page.getByPlaceholder(/search lists or members/i);
    const rail = page.locator('ul');
    await search.fill('carol');

    await expect(rail.getByText(listB.name)).toBeVisible();
    await expect(rail.getByText(listA.name)).not.toBeVisible({ timeout: 3_000 });
  });

  test('no-match search shows "No lists match" message', async ({ page }) => {
    await page.goto('/access-lists');
    const search = page.getByPlaceholder(/search lists or members/i);
    await search.fill('zzz-nonexistent-zzz');

    await expect(page.getByText(/no lists match/i)).toBeVisible();
  });

  test('clear search link resets the filter', async ({ page }) => {
    await page.goto('/access-lists');
    const search = page.getByPlaceholder(/search lists or members/i);
    const rail = page.locator('ul');
    await search.fill('zzz-nonexistent-zzz');
    await expect(page.getByText(/no lists match/i)).toBeVisible();

    await page.getByText('Clear search').click();
    await expect(search).toHaveValue('');
    await expect(rail.getByText(listA.name)).toBeVisible();
    await expect(rail.getByText(listB.name)).toBeVisible();
  });

  test('sort by Name reorders lists alphabetically', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByRole('button', { name: 'Name' }).click();

    const items = page.locator('ul > li');
    const count = await items.count();
    const names: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent();
      if (text) names.push(text);
    }
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  test('sort by Members reorders by member count (descending)', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByRole('button', { name: 'Members', exact: true }).click();

    // listB has 2 members, listA has 1 — listB should appear before listA
    const items = page.locator('ul > li');
    const count = await items.count();
    const texts: string[] = [];
    for (let i = 0; i < count; i++) {
      texts.push((await items.nth(i).textContent()) ?? '');
    }
    const indexA = texts.findIndex((t) => t.includes(listA.name));
    const indexB = texts.findIndex((t) => t.includes(listB.name));
    expect(indexB).toBeGreaterThanOrEqual(0);
    expect(indexA).toBeGreaterThanOrEqual(0);
    expect(indexB).toBeLessThan(indexA);
  });
});

// ---------------------------------------------------------------------------
// Detail pane — tabs
// ---------------------------------------------------------------------------

test.describe('Access Lists — detail pane tabs', () => {
  let list: { id: number; name: string };

  test.beforeEach(async ({ page }) => {
    list = await apiCreateList(page, `E2E Detail ${Date.now()}`, {
      description: 'Detail pane test',
      users: [
        { username: 'detailuser1', password: 'Pass1234!xyz' },
        { username: 'detailuser2', password: 'Pass5678!xyz' },
      ],
    });
  });

  test.afterEach(async ({ page }) => {
    await apiDeleteList(page, list.id);
  });

  test('detail pane shows Members, Used by, and Settings tabs', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByText(list.name).first().click();
    await expect(page.getByRole('heading', { name: list.name })).toBeVisible({ timeout: 5_000 });

    await expect(page.getByRole('tab', { name: /members/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /used by/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /settings/i })).toBeVisible();
  });

  test('detail header shows badges (members count, hosts count, updated)', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByText(list.name).first().click();
    await expect(page.getByRole('heading', { name: list.name })).toBeVisible({ timeout: 5_000 });

    await expect(page.getByText('2 members').first()).toBeVisible();
    await expect(page.getByText(/0 hosts/).first()).toBeVisible();
    await expect(page.getByText(/updated/).first()).toBeVisible();
  });

  test('detail header shows "unused" badge when no proxy hosts use the list', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByText(list.name).first().click();
    await expect(page.getByRole('heading', { name: list.name })).toBeVisible({ timeout: 5_000 });

    await expect(page.getByText('unused').first()).toBeVisible();
  });

  test('detail header shows description', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByText(list.name).first().click();
    await expect(page.getByText('Detail pane test')).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Members tab
// ---------------------------------------------------------------------------

test.describe('Access Lists — members tab', () => {
  let list: { id: number; name: string; entries: { id: number; username: string }[] };

  test.beforeEach(async ({ page }) => {
    list = await apiCreateList(page, `E2E Members ${Date.now()}`, {
      users: [
        { username: 'memuser1', password: 'Pass1234!mem1' },
        { username: 'memuser2', password: 'Pass1234!mem2' },
      ],
    });
    await page.goto('/access-lists');
    await page.getByText(list.name).first().click();
    await expect(page.getByRole('heading', { name: list.name })).toBeVisible({ timeout: 5_000 });
  });

  test.afterEach(async ({ page }) => {
    await apiDeleteList(page, list.id);
  });

  test('members table shows usernames', async ({ page }) => {
    await expect(page.getByText('memuser1')).toBeVisible();
    await expect(page.getByText('memuser2')).toBeVisible();
  });

  test('members table shows member count', async ({ page }) => {
    await expect(page.getByText('2 members').first()).toBeVisible();
  });

  test('Add member button shows the add form', async ({ page }) => {
    await page.getByRole('button', { name: /add member/i }).click();
    await expect(page.getByPlaceholder('alice.chen')).toBeVisible();
    await expect(page.getByPlaceholder(/auto-generate or paste/i)).toBeVisible();
  });

  test('add a new member — appears in the table', async ({ page }) => {
    await page.getByRole('button', { name: /add member/i }).click();
    await page.getByPlaceholder('alice.chen').fill('newmember');
    await page.getByPlaceholder(/auto-generate or paste/i).fill('NewPassword!123');

    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByText('newmember').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('3 members').first()).toBeVisible({ timeout: 10_000 });
  });

  test('add member — duplicate username shows error toast', async ({ page }) => {
    await page.getByRole('button', { name: /add member/i }).click();
    await page.getByPlaceholder('alice.chen').fill('memuser1');
    await page.getByPlaceholder(/auto-generate or paste/i).fill('SomePass!123');

    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(page.getByText(/username already exists/i)).toBeVisible({ timeout: 5_000 });
  });

  test('add member — generate password button fills the field', async ({ page }) => {
    await page.getByRole('button', { name: /add member/i }).click();

    const pwInput = page.getByPlaceholder(/auto-generate or paste/i);
    await expect(pwInput).toHaveValue('');

    await page.getByTitle('Generate strong password').click();

    const val = await pwInput.inputValue();
    expect(val.length).toBeGreaterThanOrEqual(16);
  });

  test('add member — password strength indicator appears', async ({ page }) => {
    await page.getByRole('button', { name: /add member/i }).click();
    const pwInput = page.getByPlaceholder(/auto-generate or paste/i);

    // 'abcdefgh' = 8 chars, all lowercase → score 1 = "Weak"
    await pwInput.fill('abcdefgh');
    await expect(page.getByText('Weak')).toBeVisible();

    await pwInput.fill('MyStr0ng!Pass#2026xyz');
    await expect(page.getByText(/excellent|strong/i).first()).toBeVisible();
  });

  test('add member — Cancel closes the add form', async ({ page }) => {
    await page.getByRole('button', { name: /add member/i }).click();
    await expect(page.getByPlaceholder('alice.chen')).toBeVisible();

    // The Cancel button inside the add-member form (not tab area)
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByPlaceholder('alice.chen')).not.toBeVisible();
  });

  test('Add button is disabled when username or password is empty', async ({ page }) => {
    await page.getByRole('button', { name: /add member/i }).click();
    const addBtn = page.getByRole('button', { name: 'Add', exact: true });
    await expect(addBtn).toBeDisabled();

    await page.getByPlaceholder('alice.chen').fill('testuser');
    await expect(addBtn).toBeDisabled();

    await page.getByPlaceholder('alice.chen').fill('');
    await page.getByPlaceholder(/auto-generate or paste/i).fill('SomePass!123');
    await expect(addBtn).toBeDisabled();
  });

  test('remove a member via trash icon', async ({ page }) => {
    const firstRow = page.locator('tbody tr').first();
    await firstRow.getByTitle('Remove').click();

    await expect(page.getByText('memuser1')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('1 member').first()).toBeVisible({ timeout: 10_000 });
  });

  test('regenerate password via refresh icon shows success toast', async ({ page }) => {
    const firstRow = page.locator('tbody tr').first();
    await firstRow.getByTitle(/regenerate password/i).click();

    await expect(page.getByText(/new password generated/i)).toBeVisible({ timeout: 10_000 });
  });

  test('checkbox select all toggles all rows', async ({ page }) => {
    const headerCheckbox = page.locator('thead input[type="checkbox"]');
    await headerCheckbox.check();

    await expect(page.getByText('2 selected')).toBeVisible();

    await headerCheckbox.uncheck();
    await expect(page.getByText('2 selected')).not.toBeVisible();
  });

  test('bulk remove selected members', async ({ page }) => {
    const headerCheckbox = page.locator('thead input[type="checkbox"]');
    await headerCheckbox.check();
    await expect(page.getByText('2 selected')).toBeVisible();

    await page.getByRole('button', { name: /remove/i }).first().click();

    await expect(page.getByText('0 members').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('No members yet')).toBeVisible();
  });

  test('cancel bulk selection', async ({ page }) => {
    const headerCheckbox = page.locator('thead input[type="checkbox"]');
    await headerCheckbox.check();
    await expect(page.getByText('2 selected')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('2 selected')).not.toBeVisible();
  });

  test('individual row checkbox toggles selection', async ({ page }) => {
    const firstRow = page.locator('tbody tr').first();
    const checkbox = firstRow.locator('input[type="checkbox"]');
    await checkbox.check();

    await expect(page.getByText('1 selected')).toBeVisible();

    await checkbox.uncheck();
    await expect(page.getByText('1 selected')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Members tab — empty state
// ---------------------------------------------------------------------------

test.describe('Access Lists — members empty state', () => {
  let list: { id: number; name: string };

  test.beforeEach(async ({ page }) => {
    list = await apiCreateList(page, `E2E Empty Members ${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    await apiDeleteList(page, list.id);
  });

  test('empty members shows "No members yet" message', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByText(list.name).first().click();
    await expect(page.getByRole('heading', { name: list.name })).toBeVisible({ timeout: 5_000 });

    await expect(page.getByText('No members yet')).toBeVisible();
    await expect(page.getByText(/add the first credentials/i)).toBeVisible();
  });

  test('empty members has "Add the first member" button', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByText(list.name).first().click();
    await expect(page.getByRole('heading', { name: list.name })).toBeVisible({ timeout: 5_000 });

    await expect(page.getByRole('button', { name: /add the first member/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

test.describe('Access Lists — settings tab', () => {
  let list: { id: number; name: string };

  test.beforeEach(async ({ page }) => {
    list = await apiCreateList(page, `E2E Settings ${Date.now()}`, {
      description: 'Original description',
    });
    await page.goto('/access-lists');
    await page.getByText(list.name).first().click();
    await expect(page.getByRole('heading', { name: list.name })).toBeVisible({ timeout: 5_000 });
    await page.getByRole('tab', { name: /settings/i }).click();
  });

  test.afterEach(async ({ page }) => {
    await apiDeleteList(page, list.id);
  });

  test('settings tab shows name and description fields', async ({ page }) => {
    await expect(page.locator('#s-name')).toBeVisible();
    await expect(page.locator('#s-desc')).toBeVisible();
  });

  test('settings tab shows metadata section (Created, Last updated, List ID)', async ({ page }) => {
    await expect(page.getByText('Created').first()).toBeVisible();
    await expect(page.getByText('Last updated')).toBeVisible();
    await expect(page.getByText('List ID')).toBeVisible();
  });

  test('settings tab shows danger zone', async ({ page }) => {
    await expect(page.getByText('Danger zone')).toBeVisible();
    await expect(page.getByText('Delete this access list')).toBeVisible();
  });

  test('Save changes button is disabled when no edits are made', async ({ page }) => {
    await expect(page.getByRole('button', { name: /save changes/i })).toBeDisabled();
  });

  test('editing name enables Save changes button', async ({ page }) => {
    await page.locator('#s-name').fill('Modified Name');
    await expect(page.getByRole('button', { name: /save changes/i })).toBeEnabled();
  });

  test('Discard button appears when edits are made', async ({ page }) => {
    await page.locator('#s-name').fill('Modified Name');
    await expect(page.getByRole('button', { name: /discard/i })).toBeVisible();
  });

  test('clicking Discard resets fields', async ({ page }) => {
    const originalName = await page.locator('#s-name').inputValue();
    await page.locator('#s-name').fill('Modified Name');
    await page.getByRole('button', { name: /discard/i }).click();
    await expect(page.locator('#s-name')).toHaveValue(originalName);
  });

  test('save changes updates the list name', async ({ page }) => {
    const newName = `E2E Renamed ${Date.now()}`;
    await page.locator('#s-name').fill(newName);
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByText('Saved')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('heading', { name: newName })).toBeVisible({ timeout: 5_000 });
  });

  test('delete button is disabled until confirmation name is typed', async ({ page }) => {
    await expect(page.getByRole('button', { name: /delete list permanently/i })).toBeDisabled();
  });

  test('typing wrong confirmation keeps delete disabled', async ({ page }) => {
    await page.getByPlaceholder(list.name).fill('wrong name');
    await expect(page.getByRole('button', { name: /delete list permanently/i })).toBeDisabled();
  });

  test('delete list with correct confirmation removes it', async ({ page }) => {
    await page.getByPlaceholder(list.name).fill(list.name);
    await expect(page.getByRole('button', { name: /delete list permanently/i })).toBeEnabled();

    await page.getByRole('button', { name: /delete list permanently/i }).click();

    // List should be removed from the rail
    await expect(page.locator('ul').getByText(list.name)).not.toBeVisible({ timeout: 10_000 });
    // Prevent afterEach from trying to delete again
    list = { ...list, id: -1 };
  });
});

// ---------------------------------------------------------------------------
// Used-by tab
// ---------------------------------------------------------------------------

test.describe('Access Lists — used-by tab', () => {
  let list: { id: number; name: string };

  test.beforeEach(async ({ page }) => {
    list = await apiCreateList(page, `E2E Usage ${Date.now()}`);
  });

  test.afterEach(async ({ page }) => {
    await apiDeleteList(page, list.id);
  });

  test('used-by tab shows empty state when no proxy hosts use the list', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByText(list.name).first().click();
    await expect(page.getByRole('heading', { name: list.name })).toBeVisible({ timeout: 5_000 });

    await page.getByRole('tab', { name: /used by/i }).click();
    await expect(page.getByText('Not used by any proxy host')).toBeVisible();
    await expect(page.getByText(/dormant/i)).toBeVisible();
  });

  test('used-by tab shows proxy host when one is assigned', async ({ page }) => {
    const proxyApi = 'http://localhost:3000/api/v1/proxy-hosts';

    const hostRes = await page.request.post(proxyApi, {
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:3000' },
      data: {
        name: 'E2E Usage Host',
        domains: ['usage-test.local'],
        upstreams: ['localhost:9876'],
        accessListId: list.id,
      },
    });
    expect(hostRes.ok()).toBeTruthy();
    const host = await hostRes.json() as { id: number };

    try {
      await page.goto('/access-lists');
      await page.getByText(list.name).first().click();
      await expect(page.getByRole('heading', { name: list.name })).toBeVisible({ timeout: 5_000 });

      await page.getByRole('tab', { name: /used by/i }).click();
      await expect(page.getByText('usage-test.local')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('active')).toBeVisible();
    } finally {
      await page.request.delete(`${proxyApi}/${host.id}`, {
        headers: { 'Origin': 'http://localhost:3000' },
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

test.describe('Access Lists — keyboard shortcuts', () => {
  test('pressing N opens the create dialog', async ({ page }) => {
    await page.goto('/access-lists');
    await page.locator('body').click();
    await page.keyboard.press('n');

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('dialog').getByText('New access list')).toBeVisible();
  });

  test('pressing N does NOT open dialog when focused on an input', async ({ page }) => {
    await page.goto('/access-lists');
    const search = page.getByPlaceholder(/search lists or members/i);
    await search.focus();
    await page.keyboard.press('n');

    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 2_000 });
  });

  test('Cmd+K focuses the search input', async ({ page }) => {
    await page.goto('/access-lists');
    const search = page.getByPlaceholder(/search lists or members/i);

    await page.locator('body').click();
    await page.keyboard.press('Meta+k');

    await expect(search).toBeFocused({ timeout: 3_000 });
  });
});

// ---------------------------------------------------------------------------
// Cross-tab state
// ---------------------------------------------------------------------------

test.describe('Access Lists — cross-tab consistency', () => {
  let list: { id: number; name: string };

  test.beforeEach(async ({ page }) => {
    list = await apiCreateList(page, `E2E CrossTab ${Date.now()}`, {
      users: [{ username: 'crossuser', password: 'Pass1234!cross' }],
    });
  });

  test.afterEach(async ({ page }) => {
    await apiDeleteList(page, list.id);
  });

  test('switching from Members to Settings and back preserves member data', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByText(list.name).first().click();
    await expect(page.getByText('crossuser')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('tab', { name: /settings/i }).click();
    await expect(page.getByText('Danger zone')).toBeVisible();

    await page.getByRole('tab', { name: /members/i }).click();
    await expect(page.getByText('crossuser')).toBeVisible();
  });

  test('switching from Members to Used by shows correct tab content', async ({ page }) => {
    await page.goto('/access-lists');
    await page.getByText(list.name).first().click();
    await expect(page.getByText('crossuser')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('tab', { name: /used by/i }).click();
    await expect(page.getByText('Not used by any proxy host')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated access
// ---------------------------------------------------------------------------

test.describe('Access Lists — unauthenticated', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unauthenticated access to /access-lists redirects to /login', async ({ page }) => {
    await page.goto('/access-lists');
    await expect(page).toHaveURL(/\/login/);
  });
});
