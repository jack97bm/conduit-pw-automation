/**
 * Auth — API baseline suite.
 *
 * Registration → login → authenticated profile round-trip, plus the failure paths.
 * Every run creates its own user (unique suffix) — no seed-data dependence.
 */
import { describe, it, expect } from "vitest";

const API_URL = process.env.API_URL ?? "http://localhost:3001/api";
const RUN_ID = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

const CREDS = {
  username: `auth_${RUN_ID}`,
  email: `auth_${RUN_ID}@example.com`,
  password: "Password123!",
};

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers["Authorization"] = `Token ${opts.token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

describe("auth: register → login → profile round-trip", () => {
  it("registers a new user and returns a JWT", async () => {
    const res = await api("POST", "/users", { body: { user: CREDS } });

    expect(res.status).toBe(201);
    expect(res.json.user.username).toBe(CREDS.username);
    expect(res.json.user.email).toBe(CREDS.email);
    expect(typeof res.json.user.token).toBe("string");
    expect(res.json.user.token.split(".")).toHaveLength(3); // JWT shape: header.payload.signature
  });

  it("logs in with the same credentials and can fetch its own profile with the token", async () => {
    const login = await api("POST", "/users/login", {
      body: { user: { email: CREDS.email, password: CREDS.password } },
    });
    expect(login.status).toBe(200);
    const token = login.json.user.token;
    expect(typeof token).toBe("string");

    // The token actually works: /user returns the same identity it was issued for.
    const me = await api("GET", "/user", { token });
    expect(me.status).toBe(200);
    expect(me.json.user.username).toBe(CREDS.username);
  });

  it("rejects login with a wrong password and issues no token", async () => {
    const res = await api("POST", "/users/login", {
      body: { user: { email: CREDS.email, password: "WrongPassword!" } },
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.json?.user?.token).toBeUndefined();
    expect(res.json?.errors).toBeDefined();
  });
});
