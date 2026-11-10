// Create a login. The password is read from the CLINIC_PASSWORD env var so it does not
// land in shell history as an argument.
//   CLINIC_PASSWORD=... pnpm --filter horarium user:create <login> <role> "<Full name>"
import { createUser, ROLES, type Role } from "../src/auth.js";
import { createPool, migrate } from "../src/db.js";

const [loginName, role, name] = process.argv.slice(2);
const password = process.env.CLINIC_PASSWORD ?? "";
if (!loginName || !role || !name || !ROLES.includes(role as Role)) {
  console.error(`usage: CLINIC_PASSWORD=... user:create <login> <${ROLES.join("|")}> "<Full name>"`);
  process.exit(1);
}

const db = createPool();
try {
  await migrate(db);
  const id = await createUser(db, { login: loginName, role: role as Role, name, password });
  console.log(`created user ${loginName} (id ${id}, role ${role})`);
} finally {
  await db.end();
}
