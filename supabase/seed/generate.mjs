// Deterministic generator for fabricated seed data. No real district staff,
// teachers, or students appear here. LEA and school names are invented;
// clusters and program names are public reference data from the ALSDE catalog.
// Phase 1 loads this output into the database.

export const CLUSTERS = [
  "Advanced Manufacturing", "Agriculture", "Arts, Entertainment, & Design", "Construction", "Digital Technology",
  "Education", "Energy & Natural Resources", "Financial Services", "Healthcare & Human Services",
  "Hospitality, Events, & Tourism", "Management & Entrepreneurship", "Marketing & Sales", "Public Service & Safety",
  "Supply Chain & Transportation", "Work-Based Learning", "CTE Middle School",
];

export const PROGRAMS = [
  ["CTE Engineering", "Advanced Manufacturing"], ["Additive Manufacturing", "Advanced Manufacturing"],
  ["Modern Manufacturing - Center of Excellence", "Advanced Manufacturing"], ["Industrial Maintenance - Electrical & Instrumentation", "Advanced Manufacturing"],
  ["General Agriculture", "Agriculture"], ["Animal Science", "Agriculture"], ["Plant Science", "Agriculture"], ["Industrial Agriculture", "Agriculture"],
  ["Clothing, Textiles, and Interior Design", "Arts, Entertainment, & Design"],
  ["Welding", "Construction"], ["Construction Technology", "Construction"], ["Heating, Ventilation and Air Conditioning", "Construction"],
  ["Information Technology Support and Service", "Digital Technology"], ["Educators in Training", "Education"],
  ["Utility Line Worker", "Energy & Natural Resources"], ["Financial Management", "Financial Services"],
  ["Health Science", "Healthcare & Human Services"], ["Nutrition and Wellness", "Healthcare & Human Services"], ["Cosmetology and Barbering", "Healthcare & Human Services"],
  ["Food and Beverage Services", "Hospitality, Events, & Tourism"], ["Business Administrative Services", "Management & Entrepreneurship"],
  ["Marketing", "Marketing & Sales"], ["Automotive Technology", "Supply Chain & Transportation"], ["Collision Repair", "Supply Chain & Transportation"],
  ["Cooperative Education", "Work-Based Learning"],
];

const LEA_NAMES = ["Riverbend County", "Pine Ridge City", "Cedar Hollow County", "Lakeview City", "Stonebrook County", "Harbor Point City"];
const FIRST = ["Avery", "Jordan", "Riley", "Morgan", "Casey", "Quinn", "Reese", "Parker", "Rowan", "Sawyer", "Emerson", "Finley"];
const LAST = ["Abernathy", "Blackwood", "Calloway", "Dunmore", "Everly", "Fairbanks", "Greenley", "Hollister", "Ingram", "Kingsley", "Larkin", "Marlowe"];

/** Small seeded PRNG (mulberry32) so every run produces the same data. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generate(seed = 2027) {
  const next = rng(seed);
  const pick = (arr) => arr[Math.floor(next() * arr.length)];
  const person = (domain) => {
    const first = pick(FIRST);
    const last = pick(LAST);
    return { name: `${first} ${last}`, email: `${first}.${last}.${Math.floor(next() * 900 + 100)}@${domain}`.toLowerCase() };
  };

  const clusters = CLUSTERS.map((name, i) => ({ code: String(i + 1).padStart(2, "0"), name }));
  const programs = PROGRAMS.map(([name, cluster], i) => ({
    code: String(i + 1).padStart(2, "0"),
    name,
    clusterCode: clusters.find((c) => c.name === cluster).code,
    isCoop: name === "Cooperative Education",
  }));

  const leas = LEA_NAMES.map((name, i) => {
    const code = String(901 + i);
    const domain = `${name.toLowerCase().replace(/[^a-z]+/g, "")}.example.edu`;
    const schools = [
      { code: "0010", name: `${name.split(" ")[0]} High School`, type: "high_school" },
      { code: "0020", name: `${name.split(" ")[0]} Middle School`, type: "middle_school" },
      { code: "6000", name: `${name.split(" ")[0]} Career Technical Center`, type: "career_tech_center" },
    ];
    const director = person(domain);
    const teachers = Array.from({ length: 6 }, () => ({ ...person(domain), contractType: next() < 0.7 ? "nine_month" : "extended" }));
    const declared = [];
    for (const school of schools.filter((s) => s.type !== "middle_school")) {
      const count = 4 + Math.floor(next() * 4);
      const chosen = new Set();
      while (chosen.size < count) chosen.add(pick(programs).code);
      for (const programCode of chosen) {
        declared.push({ leaCode: code, schoolCode: school.code, programCode, teacherEmail: pick(teachers).email, deliveryType: "LOCAL", dualScenario: null });
      }
    }
    return { code, name, domain, schools, director, teachers, declared };
  });

  const staffDomain = "state.example.gov";
  const staff = {
    admins: [person(staffDomain), person(staffDomain)],
    clusterAdmins: [person(staffDomain), person(staffDomain), person(staffDomain)],
    reviewers: Array.from({ length: 8 }, () => person(staffDomain)),
    leadership: [person(staffDomain)],
  };

  return { seed, schoolYear: "2026-2027", clusters, programs, leas, staff };
}
