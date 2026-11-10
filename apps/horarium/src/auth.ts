import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "./db.js";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const SESSION_HOURS = 12;
export const MIN_PASSWORD_LENGTH = 10;

export const ROLES = ["admin", "reception", "doctor"] as const;
export type Role = (typeof ROLES)[number];
export interface User {
  id: number;
  login: string;
  name: string;
  role: Role;
  staffId: number | null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Checked against when the login does not exist, so a wrong login takes as long as a wrong password
// and response times do not reveal which logins exist.
let dummyHash: Promise<string> | undefined;

function toUser(row: Record<string, unknown>): User {
  return {
    id: row.id as number,
    login: row.login as string,
    name: row.name as string,
    role: row.role as Role,
    staffId: (row.staff_id as number | null) ?? null,
  };
}

export async function createUser(
  db: Db,
  input: { login: string; name: string; role: Role; password: string; staffId?: number | null },
): Promise<number> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const { rows } = await db.query<{ id: number }>(
    "INSERT INTO users (login, name, role, password_hash, staff_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [input.login.toLowerCase(), input.name, input.role, await hashPassword(input.password), input.staffId ?? null],
  );
  return rows[0].id;
}

/** Returns a session token, or null for an unknown login or wrong password. */
export async function login(
  db: Db,
  loginName: string,
  password: string,
): Promise<{ token: string; user: User } | null> {
  const { rows } = await db.query(
    "SELECT id, login, name, role, staff_id, password_hash FROM users WHERE login = $1 AND active",
    [loginName.toLowerCase()],
  );
  const row = rows[0];
  if (!row) {
    dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
    await verifyPassword(password, await dummyHash);
    return null;
  }
  if (!(await verifyPassword(password, row.password_hash))) return null;
  await db.query("DELETE FROM sessions WHERE expires_at < now()");
  const token = randomBytes(32).toString("base64url");
  await db.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))",
    [sha256(token), row.id, SESSION_HOURS],
  );
  return { token, user: toUser(row) };
}

export async function userForToken(db: Db, token: string): Promise<User | null> {
  const { rows } = await db.query(
    `SELECT u.id, u.login, u.name, u.role, u.staff_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [sha256(token)],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function logout(db: Db, token: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}
