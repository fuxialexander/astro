import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const sql = postgres("postgresql://postgres.sizwiiieeggeyhqvirtl:Transformerisallyouneed1993%40@aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require");
const supabase = createClient(
  "https://sizwiiieeggeyhqvirtl.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpendpaWllZWdnZXlocXZpcnRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU0MzI0OSwiZXhwIjoyMDg3MTE5MjQ5fQ.QKa9Trf8cNe0amE_BNUkz-wIbxO4IT3HqZZelRVERwQ"
);

const KEEP = ["cat@cat.com", "zhuoran@gmail.com"];

const allUsers = await sql`SELECT id, email FROM auth.users`;
const toDelete = allUsers.filter(u => !KEEP.includes(u.email));
const toKeep = allUsers.filter(u => KEEP.includes(u.email));

console.log("Keeping:", toKeep.map(u => u.email));
console.log("Deleting:", toDelete.map(u => u.email));

for (const user of toDelete) {
  await sql`DELETE FROM passkey_credentials WHERE user_id = ${user.id}`;
  await sql`DELETE FROM team_members WHERE user_id = ${user.id}`;
  await sql`DELETE FROM user_profiles WHERE id = ${user.id}`;
  const { error } = await supabase.auth.admin.deleteUser(user.id);
  if (error) console.error("Failed:", user.email, error.message);
  else console.log("  Deleted:", user.email);
}

// Clean orphaned teams
const orphaned = await sql`
  SELECT t.id, t.name FROM teams t
  LEFT JOIN team_members tm ON tm.team_id = t.id
  WHERE tm.team_id IS NULL`;
for (const t of orphaned) {
  await sql`DELETE FROM teams WHERE id = ${t.id}`;
  console.log("  Removed orphan team:", t.name);
}

// Verify
const remaining = await sql`
  SELECT u.email, p.name, t.name as team_name
  FROM auth.users u
  LEFT JOIN user_profiles p ON p.id = u.id
  LEFT JOIN team_members tm ON tm.user_id = u.id
  LEFT JOIN teams t ON t.id = tm.team_id`;
console.log("\nFinal state:");
remaining.forEach(r => console.log(`  ${r.email} (name: ${r.name}, team: ${r.team_name || "NONE"})`));

await sql.end();
