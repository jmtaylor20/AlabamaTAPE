// Fails the build if an em dash or en dash appears in user-facing text,
// email templates, documents, or seed data.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOTS = ["app", "lib", "components", "emails", "docs", "supabase", "README.md"];
const EXT = new Set([".ts", ".tsx", ".md", ".sql", ".json", ".mjs", ".html", ".txt", ".csv"]);
const SKIP = new Set(["node_modules", ".next", ".pgdata"]);
const BAD = /[–—]/;

async function* walk(p) {
  let entries;
  try {
    entries = await readdir(p, { withFileTypes: true });
  } catch {
    const ext = path.extname(p);
    if (EXT.has(ext)) yield p;
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(p, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (EXT.has(path.extname(e.name))) yield full;
  }
}

let failures = 0;
for (const root of ROOTS) {
  for await (const file of walk(root)) {
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (BAD.test(line)) {
        failures += 1;
        console.error(`${file}:${i + 1}: em dash or en dash found`);
      }
    });
  }
}
if (failures) {
  console.error(`\n${failures} line(s) contain an em dash or en dash. Replace them with a comma, colon, or hyphen.`);
  process.exit(1);
}
console.log("No em dashes or en dashes found.");
