// Configuration for the TAPE small-group input sessions.
// Everything the facilitator sees as a checkbox lives here so the prompts,
// picklists, and crosswalk can be edited without touching the app logic.

export type SubQuestion = {
  id: string;
  prompt: string;
  options: string[];
  /** Short label used in report tables. */
  short: string;
};

export type Question = {
  id: string;
  number: number;
  title: string;
  /** "list": one entry per item the team names. "single": one response per team. */
  mode: "list" | "single";
  entryLabel: string;
  entryHint: string;
  /** Picklist offered for the entry name (list mode). */
  picklist?: string[];
  /** Optional free-text list captured in single mode (one per line). */
  namedLabel?: string;
  subs: SubQuestion[];
};

/** TAPE evidence areas / items the teams will be talking about. */
export const TAPE_ITEMS = [
  "Advisory committee (agenda, minutes, roster, sign-in)",
  "CTSO integration and participation",
  "Industry-recognized credentials",
  "Work-based learning",
  "Safety documentation and student safety training",
  "Equipment and inventory records",
  "Program improvement plan (PIP)",
  "Curriculum and course of study alignment",
  "Teacher certification and professional development",
  "Enrollment, access, and special populations data",
  "Perkins fiscal and expenditure records",
  "Program declaration and annual reporting",
  "Facilities, labs, and accessibility",
  "Postsecondary and employer partnerships",
  "Student outcome data (completers, placement, credentials)",
  "Simulated workplace and classroom management",
  "Lesson plans and instructional evidence",
  "Cognia evidence upload and platform requirements",
  "On-site visit and interviews",
];

/**
 * Where a TAPE item could live after the redesign. Used for both the
 * nonnegotiables and the cut list so the report can build one disposition matrix.
 */
export const DISPOSITIONS = [
  "Keep in TAPE program review",
  "Move to Perkins compliance monitoring",
  "Move to fiscal monitoring",
  "Move to civil rights (MOA) review",
  "Local / LEA self-assessment",
  "Remove completely",
];

export const DISPOSITION_SUB: SubQuestion = {
  id: "disposition",
  short: "Where should it live?",
  prompt: "Where should this item live after the redesign?",
  options: DISPOSITIONS,
};

export const QUESTIONS: Question[] = [
  {
    id: "q1",
    number: 1,
    title: "What are TAPE nonnegotiables?",
    mode: "list",
    entryLabel: "Nonnegotiable item",
    entryHint: "Add one entry for each item the team says must stay.",
    picklist: TAPE_ITEMS,
    subs: [
      {
        id: "q1a",
        short: "Protection lost without it",
        prompt: "What student, fiscal, safety, equity, or quality protection would be lost without it?",
        options: [
          "Student protection",
          "Fiscal protection",
          "Safety protection",
          "Equity / access protection",
          "Program quality protection",
          "No clear protection identified",
        ],
      },
      {
        id: "q1b",
        short: "Basis",
        prompt: "Is it required by law/policy, or is it essential because of risk and impact?",
        options: [
          "Required by federal law (Perkins V, OCR MOA, IDEA, UGG)",
          "Required by state law or SBE rule",
          "Required by ALSDE policy or guidance",
          "Essential because of risk (not legally required)",
          "Essential because of impact on students (not legally required)",
          "Tradition only",
        ],
      },
      {
        id: "q1c",
        short: "Minimum evidence",
        prompt: "What is the minimum evidence to verify it?",
        options: [
          "Existing state data system (no upload)",
          "Director attestation / self-certification",
          "Dated minutes or agenda",
          "Roster, log, or sign-in",
          "Certificate or license record",
          "Photo or inventory record",
          "Data report or export",
          "Sampled artifacts on request",
          "On-site observation",
          "Interview",
        ],
      },
      DISPOSITION_SUB,
    ],
  },
  {
    id: "q2",
    number: 2,
    title: "What TAPE items should be cut?",
    mode: "list",
    entryLabel: "Item to cut or change",
    entryHint: "Add one entry for each item the team wants cut, moved, or reduced.",
    picklist: TAPE_ITEMS,
    subs: [
      {
        id: "q2a",
        short: "Why cut",
        prompt: "Is it duplicative, low-value, outdated, or disproportionately burdensome?",
        options: [
          "Duplicative of Perkins compliance monitoring",
          "Duplicative of Cognia accreditation",
          "Duplicative of another state data collection",
          "Low value for program improvement",
          "Outdated (no longer reflects practice)",
          "Disproportionately burdensome for teachers",
          "Disproportionately burdensome for directors",
          "Disproportionately burdensome for reviewers",
        ],
      },
      {
        id: "q2b",
        short: "Decision supported",
        prompt: "What decision does the evidence currently support?",
        options: [
          "Compliance finding only",
          "Program approval or continuation",
          "Funding eligibility",
          "Technical assistance targeting",
          "Program quality rating",
          "No clear decision",
        ],
      },
      {
        id: "q2c",
        short: "Alternative",
        prompt: "Could it be sampled, consolidated, automated, or reviewed locally instead?",
        options: [
          "Sample a subset of programs",
          "Consolidate with another item",
          "Automate from existing data",
          "Review locally (LEA)",
          "Attestation instead of artifacts",
          "Remove with no replacement",
        ],
      },
      DISPOSITION_SUB,
    ],
  },
  {
    id: "q3",
    number: 3,
    title: "What is missing from the current tool?",
    mode: "single",
    entryLabel: "Team response",
    entryHint: "One response per team. List specific gaps the team named, then check what applies.",
    namedLabel: "Gaps the team named (one per line)",
    subs: [
      {
        id: "q3a",
        short: "Weakness that escapes review",
        prompt: "What system-level weakness can currently escape review?",
        options: [
          "Programs not aligned to labor market demand",
          "Weak pathway sequencing across schools",
          "Teacher capacity and certification gaps",
          "Unequal student access across schools or groups",
          "Fiscal misuse or unspent funds",
          "Safety practice that differs from documentation",
          "Poor data quality or reporting",
          "Leadership and governance weaknesses",
          "Outdated facilities or equipment",
          "Improvement plans with no follow-through",
        ],
      },
      {
        id: "q3b",
        short: "Outcome or access not visible",
        prompt: "What student outcome or access issue is not visible?",
        options: [
          "Credential attainment by student group",
          "Concentrator completion and persistence",
          "Work-based learning placement",
          "Postsecondary and employment outcomes",
          "Special populations participation",
          "Course access by school or feeder pattern",
          "Dual enrollment and articulation",
          "CTSO participation rates",
          "Nontraditional enrollment by gender",
        ],
      },
      {
        id: "q3c",
        short: "Earlier risk identification",
        prompt: "What would help us identify risk earlier?",
        options: [
          "Annual data dashboard by LEA and program",
          "Early warning indicators",
          "Risk-based review selection",
          "LEA self-assessment before review",
          "Desk review of data before any visit",
          "Interim check-ins between reviews",
          "Multi-year trend analysis",
          "Peer review across LEAs",
        ],
      },
    ],
  },
  {
    id: "q4",
    number: 4,
    title: "In a perfect world, what would TAPE look like?",
    mode: "single",
    entryLabel: "Team response",
    entryHint: "One response per team.",
    namedLabel: "Ideas the team named (one per line)",
    subs: [
      {
        id: "q4a",
        short: "Unit of review",
        prompt: "What is the unit of review?",
        options: [
          "Individual program",
          "School or career center",
          "LEA / district",
          "Pathway or cluster",
          "Region",
          "Risk-selected sample",
        ],
      },
      {
        id: "q4b",
        short: "Before the visit",
        prompt: "What happens before the visit?",
        options: [
          "Data pulled from state systems (no uploads)",
          "LEA self-assessment submitted",
          "Desk review of data and documents",
          "Risk tier assigned",
          "Focus areas agreed with LEA",
          "Reviewer training and calibration",
        ],
      },
      {
        id: "q4c",
        short: "During the visit",
        prompt: "What happens during the visit?",
        options: [
          "Focused visit on flagged areas only",
          "Virtual or desk review option",
          "Classroom and lab observation",
          "Student, teacher, and employer interviews",
          "Same-day verbal feedback",
          "No visit unless risk warrants it",
        ],
      },
      {
        id: "q4d",
        short: "After the visit",
        prompt: "What happens after the visit?",
        options: [
          "Written report within 30 days",
          "Improvement plan only where findings exist",
          "Technical assistance follow-up",
          "Recognition of strong programs",
          "Progress check the next year",
          "Results feed CLNA and local application",
        ],
      },
      {
        id: "q4e",
        short: "Rigorous and useful",
        prompt: "What would make the process both rigorous and useful to an LEA?",
        options: [
          "Clear rubric published in advance",
          "Trained, consistent reviewers",
          "Fast, actionable feedback",
          "Differentiated by risk and performance",
          "Aligned with Perkins monitoring and Cognia",
          "Reduced paperwork and duplicate uploads",
          "Benchmarks against similar LEAs",
          "Ties to funding or program approval decisions",
        ],
      },
    ],
  },
];

/**
 * Starting-point crosswalk of each TAPE item to its likely legal or policy
 * basis and a suggested home after the redesign. This reconstructs the earlier
 * "TAPE vs. compliance" analysis and should be checked against that report.
 */
export type Crosswalk = {
  item: string;
  basis: string;
  citation: string;
  suggested: string;
};

export const CROSSWALK: Crosswalk[] = [
  { item: TAPE_ITEMS[0], basis: "Stakeholder consultation is required for the CLNA; standing advisory committees are state practice.", citation: "Perkins V §134(c)-(d); Ala. Admin. Code 290-6-1", suggested: "Move to Perkins compliance monitoring" },
  { item: TAPE_ITEMS[1], basis: "CTSOs are a permissible use of funds and a state expectation, not a federal requirement.", citation: "Perkins V §135; ALSDE policy", suggested: "Local / LEA self-assessment" },
  { item: TAPE_ITEMS[2], basis: "Credential attainment is a Perkins accountability indicator and a state CCR indicator.", citation: "Perkins V §113 (5S1); state accountability", suggested: "Move to Perkins compliance monitoring" },
  { item: TAPE_ITEMS[3], basis: "Local application must describe WBL opportunities; data already reported.", citation: "Perkins V §134(b); §113", suggested: "Move to Perkins compliance monitoring" },
  { item: TAPE_ITEMS[4], basis: "Student safety in labs is a legal and liability protection.", citation: "State safety requirements; OSHA-aligned practice", suggested: "Keep in TAPE program review" },
  { item: TAPE_ITEMS[5], basis: "Equipment records and physical inventory are a federal grant requirement.", citation: "2 CFR 200.313", suggested: "Move to fiscal monitoring" },
  { item: TAPE_ITEMS[6], basis: "Improvement plans are required when local performance falls below target.", citation: "Perkins V §123(b)", suggested: "Move to Perkins compliance monitoring" },
  { item: TAPE_ITEMS[7], basis: "Course of study alignment is state law.", citation: "Code of Ala. §16-35; Ala. Admin. Code 290-6-1", suggested: "Keep in TAPE program review" },
  { item: TAPE_ITEMS[8], basis: "Certification is state law and visible in state systems.", citation: "Ala. Admin. Code 290-3-3", suggested: "Local / LEA self-assessment" },
  { item: TAPE_ITEMS[9], basis: "Access for special populations and civil rights compliance are federally required and reviewed through the MOA process.", citation: "Perkins V §134(b)(5); OCR Vocational Ed. Guidelines (34 CFR 100 App. B)", suggested: "Move to civil rights (MOA) review" },
  { item: TAPE_ITEMS[10], basis: "Allowable costs and fiscal controls are federal requirements.", citation: "Perkins V §135; 2 CFR 200", suggested: "Move to fiscal monitoring" },
  { item: TAPE_ITEMS[11], basis: "State-managed program inventory; not a review artifact.", citation: "ALSDE policy", suggested: "Local / LEA self-assessment" },
  { item: TAPE_ITEMS[12], basis: "Facility accessibility is covered by civil rights review; condition is a quality issue.", citation: "ADA / Section 504; OCR MOA", suggested: "Move to civil rights (MOA) review" },
  { item: TAPE_ITEMS[13], basis: "Partnerships are described in the CLNA and local application.", citation: "Perkins V §134(c)", suggested: "Move to Perkins compliance monitoring" },
  { item: TAPE_ITEMS[14], basis: "Outcome data is already collected for accountability.", citation: "Perkins V §113", suggested: "Move to Perkins compliance monitoring" },
  { item: TAPE_ITEMS[15], basis: "State initiative with no legal requirement.", citation: "ALSDE policy", suggested: "Remove completely" },
  { item: TAPE_ITEMS[16], basis: "Instructional evidence has no legal requirement and is disproportionately burdensome.", citation: "None", suggested: "Remove completely" },
  { item: TAPE_ITEMS[17], basis: "Platform requirement, not a program requirement.", citation: "ALSDE / Cognia contract", suggested: "Remove completely" },
  { item: TAPE_ITEMS[18], basis: "Visits verify practice but are the largest cost driver.", citation: "ALSDE policy", suggested: "Keep in TAPE program review" },
];

export const DEFAULT_TEAM_NAMES = ["Team 1", "Team 2", "Team 3"];
