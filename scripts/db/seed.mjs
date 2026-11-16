// Prints the fabricated seed data set. Phase 1 adds the loader that writes it
// into the database once the schema exists.
import { generate } from "../../supabase/seed/generate.mjs";

const data = generate();
console.log(JSON.stringify({ seed: data.seed, leas: data.leas.length, programs: data.programs.length, declared: data.leas.reduce((n, l) => n + l.declared.length, 0) }, null, 2));
