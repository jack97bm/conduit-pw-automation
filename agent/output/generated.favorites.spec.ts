import { describe, it, expect, beforeAll } from "vitest";

const API_URL = process.env.API_URL ?? "http://localhost:3001/api";

// Unique suffix per run so users/articles never collide with previous runs.
const RUN_ID = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

interface ApiUser {
  token: string;
  username: string;
  email: string;
}

interface ApiArticle {
  slug: string;
  title: string;
  favorited: boolean;
  favoritesCount: number;
  tagList: string[];
  author: { username: string; bio: string | null; image: string | null };
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; rawAuth?: string; body?: unknown } = {},
): Promise<{ status: number; ok: boolean; json: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Token ${opts.token}`;
  if (opts.rawAuth) headers["Authorization"] = opts.rawAuth;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON error bodies are fine; assertions use status in that case
  }
  return { status: res.status, ok: res.ok, json };
}

async function registerUser(label: string): Promise<ApiUser> {
  const username = `fav_${label}_${RUN_ID}`;
  const email = `fav_${label}_${RUN_ID}@example.com`;
  const password = "Password123!";
  const res = await api("POST", "/users", {
    body: { user: { username, email, password } },
  });
  if (!res.ok || !res.json?.user?.token) {
    throw new Error(
      `Failed to register user ${username}: status=${res.status} body=${JSON.stringify(res.json)}`,
    );
  }
  return res.json.user as ApiUser;
}

async function createArticle(token: string, label: string): Promise<ApiArticle> {
  const res = await api("POST", "/articles", {
    token,
    body: {
      article: {
        title: `Favorite test ${label} ${RUN_ID}`,
        description: `Article for scenario ${label}`,
        body: "Body content for favorites testing.",
        tagList: ["favorites-suite"],
      },
    },
  });
  if (!res.ok || !res.json?.article?.slug) {
    throw new Error(
      `Failed to create article for ${label}: status=${res.status} body=${JSON.stringify(res.json)}`,
    );
  }
  return res.json.article as ApiArticle;
}

async function getArticle(slug: string, token?: string): Promise<ApiArticle> {
  const res = await api("GET", `/articles/${slug}`, { token });
  if (!res.ok || !res.json?.article) {
    throw new Error(
      `Failed to fetch article ${slug}: status=${res.status} body=${JSON.stringify(res.json)}`,
    );
  }
  return res.json.article as ApiArticle;
}

describe("POST/DELETE /articles/:slug/favorite (favoriteToggler)", () => {
  let userOne: ApiUser;
  let userTwo: ApiUser;

  beforeAll(async () => {
    userOne = await registerUser("u1");
    userTwo = await registerUser("u2");
  });

  // scenario: favorite-article-success
  it("adds an existing article to the authenticated user's favorites", async () => {
    const article = await createArticle(userOne.token, "success");
    const before = await getArticle(article.slug, userOne.token);
    expect(before.favorited).toBe(false);

    const res = await api("POST", `/articles/${article.slug}/favorite`, {
      token: userOne.token,
    });

    expect(res.status).toBe(200);
    expect(res.json.article).toBeDefined();
    expect(res.json.article.favorited).toBe(true);
    expect(res.json.article.favoritesCount).toBe(before.favoritesCount + 1);
    expect(res.json.article.author).toBeDefined();
    expect(res.json.article.author.username).toBe(userOne.username);
    expect(res.json.article.tagList).toContain("favorites-suite");

    // Join row persisted: a fresh read (separate request → separate query) still sees it.
    const after = await getArticle(article.slug, userOne.token);
    expect(after.favorited).toBe(true);
    expect(after.favoritesCount).toBe(before.favoritesCount + 1);
  });

  // scenario: unfavorite-article-success
  it("removes a previously favorited article from the user's favorites", async () => {
    const article = await createArticle(userOne.token, "unfavorite");

    const favRes = await api("POST", `/articles/${article.slug}/favorite`, {
      token: userOne.token,
    });
    expect(favRes.status).toBe(200);
    const favoritedCount: number = favRes.json.article.favoritesCount;
    expect(favRes.json.article.favorited).toBe(true);

    const res = await api("DELETE", `/articles/${article.slug}/favorite`, {
      token: userOne.token,
    });

    expect(res.status).toBe(200);
    expect(res.json.article).toBeDefined();
    expect(res.json.article.favorited).toBe(false);
    expect(res.json.article.favoritesCount).toBe(favoritedCount - 1);
  });

  // scenario: favorite-twice-idempotent
  it("does not duplicate the favorite when the same user favorites twice", async () => {
    const article = await createArticle(userOne.token, "idempotent");

    const first = await api("POST", `/articles/${article.slug}/favorite`, {
      token: userOne.token,
    });
    expect(first.status).toBe(200);
    expect(first.json.article.favorited).toBe(true);
    expect(first.json.article.favoritesCount).toBe(1);

    const second = await api("POST", `/articles/${article.slug}/favorite`, {
      token: userOne.token,
    });
    expect(second.status).toBe(200);
    expect(second.json.article.favorited).toBe(true);
    expect(second.json.article.favoritesCount).toBe(1);
  });

  // scenario: favorite-no-auth-header
  it("rejects with 401 when no Authorization header is sent and leaves state unchanged", async () => {
    const article = await createArticle(userOne.token, "noauth");

    const res = await api("POST", `/articles/${article.slug}/favorite`);

    expect(res.status).toBe(401);
    expect(res.json?.article).toBeUndefined();

    const after = await getArticle(article.slug, userOne.token);
    expect(after.favorited).toBe(false);
    expect(after.favoritesCount).toBe(0);
  });

  // scenario: favorite-nonexistent-slug
  it("returns 404 when the slug matches no article", async () => {
    const res = await api(
      "POST",
      `/articles/no-such-article-${RUN_ID}/favorite`,
      { token: userOne.token },
    );

    expect(res.status).toBe(404);
    expect(res.json?.article).toBeUndefined();
  });

  // scenario: favorite-malformed-auth-header
  it("fails with a non-2xx error when the Authorization header has no token after the scheme", async () => {
    const article = await createArticle(userOne.token, "malformed");

    const res = await api("POST", `/articles/${article.slug}/favorite`, {
      rawAuth: "Token",
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.json?.article).toBeUndefined();

    // Controller was never reached: no favorite was created.
    const after = await getArticle(article.slug, userOne.token);
    expect(after.favorited).toBe(false);
    expect(after.favoritesCount).toBe(0);
  });

  // scenario: favorite-invalid-token
  it("fails with a non-2xx error when the token does not verify", async () => {
    const article = await createArticle(userOne.token, "invalidtoken");

    const res = await api("POST", `/articles/${article.slug}/favorite`, {
      rawAuth: "Token not.a.real-jwt-token",
    });

    expect(res.ok).toBe(false);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.json?.article).toBeUndefined();

    const after = await getArticle(article.slug, userOne.token);
    expect(after.favorited).toBe(false);
    expect(after.favoritesCount).toBe(0);
  });

  // scenario: favorites-count-reflects-all-users
  it("reports the total count across all users while favorited reflects only the requester", async () => {
    const article = await createArticle(userOne.token, "multiuser");

    const first = await api("POST", `/articles/${article.slug}/favorite`, {
      token: userOne.token,
    });
    expect(first.status).toBe(200);
    expect(first.json.article.favoritesCount).toBe(1);

    const second = await api("POST", `/articles/${article.slug}/favorite`, {
      token: userTwo.token,
    });
    expect(second.status).toBe(200);
    expect(second.json.article.favorited).toBe(true);
    expect(second.json.article.favoritesCount).toBe(2);

    const removal = await api("DELETE", `/articles/${article.slug}/favorite`, {
      token: userOne.token,
    });
    expect(removal.status).toBe(200);
    expect(removal.json.article.favorited).toBe(false);
    expect(removal.json.article.favoritesCount).toBe(1);
  });
});