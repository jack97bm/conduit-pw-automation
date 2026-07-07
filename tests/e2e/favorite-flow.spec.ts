/**
 * E2E: login through the real UI → favorite an article → the UI reflects the change.
 *
 * This is the one thing the API suite cannot prove: that the frontend actually talks
 * to the backend and renders its state. Setup (user + article) happens via the API —
 * fast and reliable; the UI is exercised only for the behavior under test.
 */
import { expect, test } from "@playwright/test";

const API_URL = process.env.API_URL ?? "http://localhost:3001/api";
const RUN_ID = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

const CREDS = {
  username: `e2e_${RUN_ID}`,
  email: `e2e_${RUN_ID}@example.com`,
  password: "Password123!",
};
const ARTICLE_TITLE = `E2E favorite target ${RUN_ID}`;

test.beforeAll(async () => {
  // Arrange via API: our own user and our own article — no seed-data dependence.
  const reg = await fetch(`${API_URL}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: CREDS }),
  });
  if (!reg.ok) throw new Error(`user setup failed: ${reg.status}`);
  const { user } = await reg.json();

  const art = await fetch(`${API_URL}/articles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${user.token}`,
    },
    body: JSON.stringify({
      article: {
        title: ARTICLE_TITLE,
        description: "E2E favorite flow target",
        body: "Created by the E2E suite.",
        tagList: ["e2e-suite"],
      },
    }),
  });
  if (!art.ok) throw new Error(`article setup failed: ${art.status}`);
});

test("user can log in and favorite an article from the feed", async ({ page }) => {
  // Log in through the real form. (The app uses hash routing: /#/login)
  await page.goto("/#/login");
  await page.getByPlaceholder("Email").fill(CREDS.email);
  await page.getByPlaceholder("Password").fill(CREDS.password);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByText("Global Feed")).toBeVisible(); // successful login lands on the feed

  // Global Feed lists all articles, newest first — ours is on page 1.
  await page.getByText("Global Feed").click();
  const card = page.locator(".article-preview", { hasText: ARTICLE_TITLE });
  await expect(card).toBeVisible();

  const favButton = card.getByRole("button");
  await expect(favButton.locator(".counter")).toHaveText(/\(\s*0\s*\)/);

  await favButton.click();

  // The UI reflects the persisted state: count 1 and active styling.
  await expect(favButton.locator(".counter")).toHaveText(/\(\s*1\s*\)/);
  await expect(favButton).toHaveClass(/active/);

  // And it survives a reload — state came from the backend, not local component state.
  await page.reload();
  await page.getByText("Global Feed").click();
  const cardAfter = page.locator(".article-preview", { hasText: ARTICLE_TITLE });
  await expect(cardAfter.getByRole("button").locator(".counter")).toHaveText(/\(\s*1\s*\)/);
});
