// Load the fabricated seed data set into a database.
//   DATABASE_URL=postgres://... node scripts/db/seed.mjs          (apply)
//   node scripts/db/seed.mjs --print-sql > seed.sql              (print SQL only)
// Safe to run more than once: every statement is idempotent.
import pg from "pg";
import { generate } from "../../supabase/seed/generate.mjs";

const data = generate();
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const statements = [];

statements.push(`insert into public.school_years (label, starts_on, ends_on, is_current) values ('2026-2027', '2026-07-01', '2027-06-30', true) on conflict (label) do nothing`);
for (const c of data.clusters) statements.push(`insert into public.clusters (code, name, sort) values (${q(c.code)}, ${q(c.name)}, ${Number(c.code)}) on conflict (code) do update set name = excluded.name`);
for (const pr of data.programs) statements.push(`insert into public.program_catalog (code, name, cluster_code, is_coop) values (${q(pr.code)}, ${q(pr.name)}, ${q(pr.clusterCode)}, ${pr.isCoop}) on conflict (code) do update set name = excluded.name, cluster_code = excluded.cluster_code`);
statements.push(`insert into public.approved_domains (lea_id, domain) values (null, 'state.example.gov') on conflict do nothing`);
for (const lea of data.leas) {
  statements.push(`insert into public.leas (system_code, name, lea_type) values (${q(lea.code)}, ${q(lea.name)}, ${q(lea.name.endsWith("City") ? "city" : "county")}) on conflict (system_code) do update set name = excluded.name`);
  statements.push(`insert into public.approved_domains (lea_id, domain) select id, ${q(lea.domain)} from public.leas where system_code = ${q(lea.code)} on conflict do nothing`);
  for (const s of lea.schools) {
    statements.push(`insert into public.schools (lea_id, school_code, name, school_type) select id, ${q(s.code)}, ${q(s.name)}, ${q(s.type)} from public.leas where system_code = ${q(lea.code)} on conflict (lea_id, school_code) do update set name = excluded.name`);
  }
  for (const t of lea.teachers) {
    statements.push(`insert into public.teachers (lea_id, display_name, email) select id, ${q(t.name)}, ${q(t.email)} from public.leas where system_code = ${q(lea.code)} and not exists (select 1 from public.teachers x where x.email = ${q(t.email)})`);
    statements.push(`insert into public.teacher_years (teacher_id, school_year_id, contract_type) select t.id, y.id, ${q(t.contractType)} from public.teachers t, public.school_years y where t.email = ${q(t.email)} and y.label = '2026-2027' on conflict (teacher_id, school_year_id) do nothing`);
  }
  statements.push(`insert into public.invitations (email, display_name, role, lea_id) select ${q(lea.director.email)}, ${q(lea.director.name)}, 'cte_director', id from public.leas where system_code = ${q(lea.code)} and not exists (select 1 from public.invitations i where i.email = ${q(lea.director.email)})`);
}
const staffInvite = (person, role, cluster = null) =>
  `insert into public.invitations (email, display_name, role, cluster_code) select ${q(person.email)}, ${q(person.name)}, ${q(role)}, ${cluster ? q(cluster) : "null"} where not exists (select 1 from public.invitations i where i.email = ${q(person.email)})`;
for (const a of data.staff.admins) statements.push(staffInvite(a, "state_admin"));
data.staff.clusterAdmins.forEach((a, i) => statements.push(staffInvite(a, "cluster_admin", data.clusters[i].code)));
for (const r of data.staff.reviewers) statements.push(staffInvite(r, "reviewer"));
for (const l of data.staff.leadership) statements.push(staffInvite(l, "leadership"));

if (process.argv.includes("--print-sql")) {
  console.log("begin;\n" + statements.join(";\n") + ";\ncommit;");
} else {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    for (const s of statements) await client.query(s);
    await client.query("commit");
    console.log(`seeded ${data.leas.length} LEAs, ${data.programs.length} programs, ${data.leas.reduce((n, l) => n + l.teachers.length, 0)} teachers`);
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    await client.end();
  }
}
