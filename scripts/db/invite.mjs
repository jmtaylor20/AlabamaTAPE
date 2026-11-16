// Create an invitation (and approve its domain) directly in the database.
// For bootstrapping the first State Admin; everything after that happens in the app.
//   DATABASE_URL=... node scripts/db/invite.mjs --email you@example.gov --role state_admin [--name "Your Name"]
//   node scripts/db/invite.mjs --email ... --role ... --print-sql
import pg from "pg";

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true] : [])).filter((x) => x.length));
const email = String(args.email ?? "").toLowerCase();
const role = String(args.role ?? "");
const name = args.name ? String(args.name) : null;
const roles = ["state_admin", "cluster_admin", "reviewer", "leadership", "developer"];
if (!email.includes("@") || !roles.includes(role)) {
  console.error(`usage: --email <email> --role <${roles.join("|")}> [--name "Display Name"] [--print-sql]`);
  process.exit(1);
}
const domain = email.split("@")[1];
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const sql = [
  `insert into public.approved_domains (lea_id, domain) values (null, ${q(domain)}) on conflict do nothing`,
  `insert into public.invitations (email, display_name, role, expires_at) values (${q(email)}, ${name ? q(name) : "null"}, ${q(role)}, now() + interval '30 days')`,
];
if (args["print-sql"]) {
  console.log(sql.join(";\n") + ";");
} else {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  for (const s of sql) await client.query(s);
  await client.end();
  console.log(`invited ${email} as ${role}; domain ${domain} approved for staff sign-in`);
}
