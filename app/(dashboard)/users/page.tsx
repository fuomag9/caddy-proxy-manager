import UsersClient from "./UsersClient";
import { listUsers } from "@/src/lib/models/user";
import { requireAdmin } from "@/src/lib/auth";

export default async function UsersPage() {
  await requireAdmin();
  const allUsers = await listUsers();
  // Strip password hashes before sending to client
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const safeUsers = allUsers.map(({ password_hash, ...rest }) => rest);
  return <UsersClient users={safeUsers} />;
}
