// Configuration for the TAPE small-group input sessions.
// Prompts, picklists, facilitator context, and the crosswalk all live here so
// they can be edited without touching the app logic. Content is drawn from the
// August 2026 TAPE Redesign Brief and its two research memos (federal
// requirements; 10-state and 16-state comparisons).

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
  /** Talking points from the research the facilitator can open during the session. */
  context: string[];
  subs: SubQuestion[];
};

/** Authority behind an indicator, per the redesign brief's audit. */
export type Anchor = "fed" | "code" | "policy" | "process";

export const ANCHOR_LABEL: Record<Anchor, string> = {
  fed: "Genuine federal anchor",
  code: "Alabama Admin. Code anchor",
  policy: "ALSDE policy only",
  process: "TAPE process element",
};

/**
 * Every scored indicator in the 2025-26 TAPE tool plus the process elements
 * around it. Format: code, name, anchor, what the brief found, suggested home.
 */
export const INDICATORS: { code: string; name: string; anchor: Anchor; basis: string; suggested: string }[] = [
  { code: "1.1.A", name: "CTSO Program of Work", anchor: "policy", basis: "Perkins V mentions CTSOs three times, all permissive. 290-6-1-.04(5) requires affiliation and a teacher-advisor; it says nothing about a program of work.", suggested: "Program self-assessment (Layer 2)" },
  { code: "1.1.B", name: "CTSO Membership / Affiliation", anchor: "code", basis: "Ala. Admin. Code 290-6-1-.04(5): each local program shall be affiliated. Genuine state-rule anchor.", suggested: "Annual assurance (Layer 1)" },
  { code: "1.1.C", name: "CTSO Meetings (4 minimum)", anchor: "policy", basis: "No federal or Code basis for a meeting count, the required agenda items, or the financial-approval element. ALSDE policy.", suggested: "Remove completely" },
  { code: "1.1.D", name: "Leadership Opportunities", anchor: "policy", basis: "Officer list. ALSDE policy.", suggested: "Remove completely" },
  { code: "1.1.E", name: "Competitive Events / Activities", anchor: "policy", basis: "Sec. 135(b)(5)(O) permits supporting competition participation as an allowable use. It is not a requirement. Judge lists are ALSDE's.", suggested: "Program self-assessment (Layer 2)" },
  { code: "1.1.F", name: "Learning Through Community Service", anchor: "policy", basis: "No federal or Code basis. Dated photographic evidence is entirely an ALSDE evidentiary standard.", suggested: "Remove completely" },
  { code: "1.1.G", name: "CTSO Integration into Curriculum", anchor: "policy", basis: "Sec. 3(6)'s 'integral part of the instructional program' is definitional, not a mandate. Frequently misquoted as one.", suggested: "Program self-assessment (Layer 2)" },
  { code: "2.1.A", name: "CTE Syllabus", anchor: "code", basis: "Required reading books and the parent summary of instructional material come from Alabama Act 2024-35. The remaining syllabus elements are ALSDE policy.", suggested: "Annual assurance (Layer 1)" },
  { code: "2.1.B", name: "Embedded Numeracy", anchor: "policy", basis: "Sec. 2354(b)(4) requires integration of 'coherent and rigorous content'; it never names numeracy, sets no minutes, and requires no model. Content 'shall be determined by the State.'", suggested: "District review, on-site (Layer 3)" },
  { code: "2.1.C", name: "Embedded Literacy", anchor: "policy", basis: "Same as 2.1.B. Perkins V does not name literacy as a required integration target. The proxy is the 2S1 indicator, a measurement, not an instructional mandate.", suggested: "District review, on-site (Layer 3)" },
  { code: "2.1.D", name: "Embedded Science", anchor: "policy", basis: "Science is a core indicator for Alabama (2S3), an Alabama selection under Sec. 113, not a federal instructional requirement.", suggested: "District review, on-site (Layer 3)" },
  { code: "2.1.E", name: "Program Budget", anchor: "policy", basis: "No federal requirement for a teacher-prepared program budget. Adjacent to 2 CFR 200.403 allowability but not required by it.", suggested: "LEA local monitoring only (Form 14-1)" },
  { code: "2.1.F", name: "Classroom / Lab Safety", anchor: "code", basis: "100% safety proficiency using locally designed assessments is 290-6-1-.04(6). Alabama public schools are outside federal OSHA jurisdiction entirely.", suggested: "District review, on-site (Layer 3)" },
  { code: "2.1.G", name: "Facilities", anchor: "code", basis: "Preventive maintenance and equipment inventory are 290-6-1-.10. ADA Title II and Section 504 apply to labs and shops. The remaining eleven bundled conditions are ALSDE policy.", suggested: "District review, on-site (Layer 3)" },
  { code: "2.1.H", name: "Industry Credentialing & Technical Assessments", anchor: "fed", basis: "Genuine federal anchor only if Alabama selected 5S1 (credential attainment) under Sec. 113(b)(2)(A)(iv). The 88% pass-rate threshold is Alabama's.", suggested: "Automate from state data (Layer 0)" },
  { code: "3.1.A", name: "Program Scheduling (3 courses / 2 years)", anchor: "policy", basis: "The strongest candidate for the size/scope/quality definition. Sec. 2354(b)(2) requires at least one state-approved program of study; it sets no course count.", suggested: "Write into SSQ definition (State Plan)" },
  { code: "3.1.B", name: "Parent / Guardian Involvement", anchor: "policy", basis: "Parents are a mandatory CLNA stakeholder category under Sec. 2354(d)(4). Two annual events with dated documentation is entirely ALSDE.", suggested: "Remove completely" },
  { code: "3.1.C", name: "Advisory Committee Development & Meetings", anchor: "code", basis: "290-6-1-.06(1)(a): each LEA has a system-level Council and each program has a committee. No advisory committee requirement exists anywhere in Perkins V; the five-member minimum, twice-yearly cadence, 51% quorum, and onsite requirement are Alabama's.", suggested: "Annual assurance (Layer 1)" },
  { code: "3.1.D", name: "Advisory Committee Program of Work", anchor: "policy", basis: "No federal or Code basis. ALSDE policy.", suggested: "Remove completely" },
  { code: "3.1.E", name: "Marketing, PR, and Community Outreach", anchor: "policy", basis: "No federal or Code basis. Sec. 2354(b)(2)(C) requires describing how students learn about offerings, a description, not a marketing standard.", suggested: "Remove completely" },
  { code: "4.1.A", name: "Technical Updates", anchor: "code", basis: "290-6-1-.07(3) requires business/industry awareness hours based on BIC requirements. It sets no hour count; the 8/16-hour figures live in BIC criteria and the MOA Manual.", suggested: "Annual assurance (Layer 1)" },
  { code: "5.1.A", name: "Program Area Work-Based Learning", anchor: "policy", basis: "Sec. 2354(b)(6) requires only a description, qualified 'as applicable.' The statutory definition permits simulated environments.", suggested: "Program self-assessment (Layer 2)" },
  { code: "5.1.B", name: "Off-Site Live Work", anchor: "fed", basis: "Where minors work in hazardous occupations, 29 CFR 570.50(c) requires a signed written training agreement and a schedule of progressive work processes. The strongest genuinely federal on-site criterion.", suggested: "District review, on-site (Layer 3)" },
  { code: "5.2.A", name: "Cooperative Education / Internship WBL", anchor: "fed", basis: "Same FLSA anchor. Training agreement and training plan are federally required documents for HO-covered placements; the child labor law training requirement is Alabama's.", suggested: "District review, on-site (Layer 3)" },
  { code: "Process", name: "Cognia evidence upload", anchor: "process", basis: "Platform requirement, not a program requirement. The brief calls the assurance layer 'where the Cognia evidence burden goes to die.'", suggested: "Remove completely" },
  { code: "Process", name: "On-site visit to every sampled program", anchor: "process", basis: "Site visits are an optional tool under 2 CFR 200.332(f). No state in the sample still reviews program by program on a fixed rotation.", suggested: "District review, on-site (Layer 3)" },
  { code: "Process", name: "Desk audit before the visit", anchor: "process", basis: "Already practiced. Becomes the annual desk-only risk score computed from data ALSDE holds.", suggested: "Automate from state data (Layer 0)" },
  { code: "Process", name: "25% sample on a five-year rotation", anchor: "process", basis: "Not probabilistic, wrong unit of analysis, and a five-year window never holds a point-in-time picture. Replace with a risk score plus a small permanent random stream.", suggested: "Automate from state data (Layer 0)" },
  { code: "Process", name: "1/2 scoring scale", anchor: "process", basis: "Two points is where the measurement literature finds the sharpest reliability loss. Move to a labeled four-point scale.", suggested: "Program self-assessment (Layer 2)" },
  { code: "Process", name: "Program Improvement Plan (PIP)", anchor: "process", basis: "Perkins requires an improvement plan only when a recipient misses 90% of a local level (Sec. 123(b)). Fold plans into the CLNA and local application the district already has.", suggested: "District review, on-site (Layer 3)" },
  { code: "Process", name: "Four years of Form 14-1 evidence", anchor: "process", basis: "Exceeds the three-year federal retention floor (2 CFR 200.334).", suggested: "LEA local monitoring only (Form 14-1)" },
  { code: "Process", name: "EPIC opt-in tier", anchor: "process", basis: "Voluntary, rubric-scored, incentive-attached recognition outside the compliance system. Georgia and Tennessee landed on the same pattern. Keep.", suggested: "Program self-assessment (Layer 2)" },
  { code: "Process", name: "Consistency meeting before findings", anchor: "process", basis: "Only Maryland does anything comparable. The seed of a real calibration protocol. Keep and build on it.", suggested: "District review, on-site (Layer 3)" },
  { code: "Process", name: "Post-review teacher and director surveys", anchor: "process", basis: "Rare. Keep it and start publishing the results.", suggested: "District review, on-site (Layer 3)" },
  { code: "Process", name: "Purpose statements for each domain", anchor: "process", basis: "Almost no state instrument explains why an indicator exists. Real intellectual work that should survive any redesign.", suggested: "Program self-assessment (Layer 2)" },
];

/** Picklist labels shown in the item dropdown. */
export const TAPE_ITEMS = INDICATORS.map((i) => (i.code === "Process" ? i.name : `${i.code} ${i.name}`));

export function findIndicator(item: string) {
  const key = item.trim().toLowerCase();
  return INDICATORS.find((i) => key === (i.code === "Process" ? i.name : `${i.code} ${i.name}`).toLowerCase() || key === i.name.toLowerCase() || key === i.code.toLowerCase());
}

/**
 * Where an item could live in the four-layer architecture the brief proposes.
 * Used for both the nonnegotiables and the cut list so the report can build
 * one disposition matrix.
 */
export const DISPOSITIONS = [
  "Automate from state data (Layer 0)",
  "Annual assurance (Layer 1)",
  "Program self-assessment (Layer 2)",
  "District review, on-site (Layer 3)",
  "Write into SSQ definition (State Plan)",
  "LEA local monitoring only (Form 14-1)",
  "Remove completely",
];

export const DISPOSITION_SUB: SubQuestion = {
  id: "disposition",
  short: "Where should it live?",
  prompt: "Where should this item live after the redesign?",
  options: DISPOSITIONS,
};

export const LAYERS = [
  { name: "Layer 0: Risk model", detail: "Annual, desk-only, zero district burden. Score every recipient from data ALSDE already holds (indicators, expenditure rate, carryover, audit findings, turnover, prior findings, time since last review). Publish each district's score with an appeal window." },
  { name: "Layer 1: Assurances", detail: "The compliance floor. About 14 binding assurances attested annually as a condition of approval, verified by a random 10% desktop sample, not universal upload." },
  { name: "Layer 2: Program self-assessment", detail: "Biennial, census, no evidence, no consequences. The ~20 QPIs become a four-level rubric with numeric anchors, completed by the instructor with the advisory committee. Submission is a funding condition; scores are diagnostic." },
  { name: "Layer 3: District review", detail: "The on-site event. Risk-selected depth, universal participation. Pre-populated form, reviewers from neighboring LEAs plus an employer, identical focus-group questions, district validates the draft. Output: Strengths, Challenges, External Factors, Takeaways for the State." },
  { name: "Layer 4: Random estimation sample", detail: "Small, purely random, permanent. Roughly 10-15% of districts pooled across years, no risk input. The only defensible statewide numbers and the check on the risk model." },
];

export const QUESTIONS: Question[] = [
  {
    id: "q1",
    number: 1,
    title: "What are TAPE nonnegotiables?",
    mode: "list",
    entryLabel: "Nonnegotiable item",
    entryHint: "Add one entry for each indicator or process element the team says must stay.",
    picklist: TAPE_ITEMS,
    context: [
      "Zero of the ~24 scored indicators are federally required as written. Two have a genuine federal anchor (2.1.H if Alabama selected 5S1; the FLSA training agreements in 5.1.B and 5.2.A), seven rest on the Alabama Administrative Code, fifteen rest on ALSDE policy alone.",
      "Perkins V is procedurally prescriptive and substantively empty: it says what documents must exist and what must be measured, and it forbids the federal government from defining a good program (20 U.S.C. 2306a).",
      "The Civil Rights MOA on-site review mandate, the one federal rule that forced this model, was rescinded July 23, 2026.",
      "Alabama's own rule already assigns program-level evaluation to the LEA (290-6-1-.03(2)(d)) and lists Comprehensive LEA Monitoring first among accountability measures.",
      "Anything Alabama writes into its size, scope, and quality definition in the State Plan becomes a federal allowability condition under Sec. 135(b). That is the lever for keeping a state expectation without calling it federal.",
    ],
    subs: [
      {
        id: "q1a",
        short: "Protection lost without it",
        prompt: "What student, fiscal, safety, equity, or quality protection would be lost without it?",
        options: [
          "Student safety",
          "Student access or equity",
          "Fiscal accountability",
          "Program quality",
          "Data quality",
          "Employer and industry relevance",
          "No clear protection identified",
        ],
      },
      {
        id: "q1b",
        short: "Basis",
        prompt: "Is it required by law/policy, or is it essential because of risk and impact?",
        options: [
          "Genuine federal anchor (Perkins V, FLSA, IDEA, 2 CFR 200)",
          "Alabama Administrative Code 290-6-1",
          "ALSDE policy or MOA Manual only",
          "Could be written into the SSQ definition",
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
          "State-held data (no upload)",
          "Director assurance / attestation",
          "Random 10% desktop sample",
          "Signed agreement on file (FLSA training agreement)",
          "Dated minutes, roster, or sign-in",
          "Certificate or license record",
          "On-site observation",
          "Interview or focus group",
          "Photo or screenshot (lowest signal)",
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
    entryHint: "Add one entry for each indicator or process element the team wants cut, moved, or reduced.",
    picklist: TAPE_ITEMS,
    context: [
      "Seven of the ~24 indicators score CTSO operations. Alabama's real authority (290-6-1-.04(5)) requires affiliation and a teacher-advisor and nothing else. The program of work, four sets of minutes, judge lists, and dated photos are ALSDE's and are the single largest block of teacher burden.",
      "Photograph and screenshot evidence across 1.1.E, 1.1.F, 1.1.G, 3.1.B, and 3.1.E is the highest-effort, lowest-signal category in the tool.",
      "Four years of Form 14-1s exceeds the three-year federal retention floor (2 CFR 200.334).",
      "2.1.G bundles eleven distinct conditions into one 1/2 score. A reviewer cannot record that ten of eleven are excellent.",
      "Three states ran this exact model and exited it: Kentucky (2016), Missouri (self-assessment, no evidence), Georgia (eliminated program-level Section B after FY19). Alabama is the last one still doing it.",
      "Warning from Tennessee and North Carolina: if state review is reduced, formally retire the local recordkeeping it justified, or the cost stays and the purpose leaves.",
    ],
    subs: [
      {
        id: "q2a",
        short: "Why cut",
        prompt: "Is it duplicative, low-value, outdated, or disproportionately burdensome?",
        options: [
          "Duplicative of Form 14-1 / LEA monitoring",
          "Duplicative of the CLNA or local application",
          "Duplicative of data the state already holds",
          "Presented as federal but is ALSDE policy",
          "Photo or screenshot evidence (low signal)",
          "Exceeds the 3-year federal retention floor",
          "Double-barreled (many conditions, one score)",
          "Outdated (no longer reflects practice)",
          "Disproportionately burdensome for teachers",
          "Disproportionately burdensome for directors",
          "Disproportionately burdensome for reviewers",
          "Rarely or never produces a finding",
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
          "Annual assurance instead of evidence",
          "Random 10% desktop sample",
          "Automate from state data",
          "Self-assessment with no evidence",
          "Move to the district-level review",
          "Event-driven (a program change triggers a visit)",
          "Consolidate with another indicator",
          "Review locally (LEA)",
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
    context: [
      "Program-by-program review sees deficiencies in certain programs but not the overall problem. Five programs inside one district carry the information of about two independent observations because they share a director, budget, data system, and PD calendar.",
      "A district census would surface what program review cannot: portfolio coherence and duplication across schools, equity of access between schools, concentrator flow across the system, whether the CLNA drove the budget, teacher pipeline as a system property, advisement capacity, and data quality.",
      "A five-year window means there is never a moment when the 25% reviewed describes the state now.",
      "Pure risk-targeting has a known failure mode: it entrenches prior findings and misses new problems in units the model calls safe. The remedy everywhere is a small permanent random component alongside the risk component.",
      "Three analyses on data ALSDE already owns: ICC by indicator (which QPIs are really district properties), effort versus finding rate (what never produces a finding), and a nine-district burden baseline.",
    ],
    subs: [
      {
        id: "q3a",
        short: "Weakness that escapes review",
        prompt: "What system-level weakness can currently escape review?",
        options: [
          "Portfolio coherence and duplication across schools",
          "Programs not aligned to labor-market demand",
          "Equity of access between schools in the same district",
          "Concentrator flow and pathway completion across the system",
          "CLNA quality and whether it actually drove the budget",
          "Teacher pipeline, certification, and turnover",
          "Career advisement capacity and counselor ratios",
          "Data quality as a district function",
          "Fiscal: carryover, expenditure rate, audit findings",
          "Leadership and governance stability",
        ],
      },
      {
        id: "q3b",
        short: "Outcome or access not visible",
        prompt: "What student outcome or access issue is not visible?",
        options: [
          "Credential attainment by student group",
          "Concentrator completion and persistence",
          "Work-based learning hours and placement",
          "Postsecondary and employment outcomes",
          "Special populations participation",
          "Course access by school or feeder pattern",
          "Dual enrollment and articulation",
          "Nontraditional enrollment by gender",
          "Students not in CTE at all",
        ],
      },
      {
        id: "q3c",
        short: "Earlier risk identification",
        prompt: "What would help us identify risk earlier?",
        options: [
          "Annual desk-only risk score from state data",
          "Time since last review counted in the risk score",
          "Negative points for sustained clean performance",
          "Small permanent random sample",
          "Annual data screen that triggers review (Ohio)",
          "Published risk score with an appeal window",
          "Interim check-ins between reviews",
          "Multi-year trend analysis",
          "ICC analysis to sort indicators by district vs. program",
          "Effort vs. finding-rate analysis of each indicator",
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
    context: [
      "The brief's answer is a four-layer architecture, each layer with one job: a desk-only risk model, annual assurances verified by a 10% sample, a biennial program self-assessment with no evidence, a risk-selected district review on site, plus a small permanent random sample.",
      "Maryland's Expert Review Team is the model: LEA as the unit, 10-14 reviewers including a teacher and school leader from a neighboring LEA plus an employer, no scoring in years 1-2, identical focus-group questions, district validates the draft, every report published.",
      "Delaware's burden mechanic: the state pre-populates the monitoring form, the district completes it before the visit, and interview questions are narrowed by what the district said.",
      "Massachusetts handles facilities and safety event-driven: a Program Change Form triggers a targeted visit when a space is expanded, renovated, or moved.",
      "Build on the CLNA, not beside it. Federal law already requires a biennial district-level needs analysis covering roughly six of the eight district domains.",
      "Phase it: years 1-2 baseline with no scoring or consequences, years 3-4 build the instrument from what was seen, year 5+ attach stakes. Cooperation, not calibration, is the binding constraint.",
    ],
    subs: [
      {
        id: "q4a",
        short: "Unit of review",
        prompt: "What is the unit of review?",
        options: [
          "LEA / district (the Perkins recipient)",
          "Individual program at an individual school (current)",
          "School or career center",
          "Pathway, entered only by a data screen",
          "Risk-selected districts plus a random stream",
          "Program drill-down only where the district review points",
        ],
      },
      {
        id: "q4b",
        short: "Before the visit",
        prompt: "What happens before the visit?",
        options: [
          "State pre-populates the data; district submits nothing to be scored",
          "Risk score published to the district with an appeal window",
          "District completes a pre-populated form",
          "Interview scope narrowed by district responses",
          "Program self-assessments already on file",
          "Reviewer training and calibration",
          "Focus areas agreed with the district",
        ],
      },
      {
        id: "q4c",
        short: "During the visit",
        prompt: "What happens during the visit?",
        options: [
          "Universal participation with risk-tiered depth",
          "Team includes reviewers from neighboring LEAs and an employer",
          "Identical focus-group questions at every visit",
          "Lab and shop walk-through only where flagged or event-driven",
          "FLSA training agreements checked on site",
          "Virtual or desk option for low-risk districts",
          "Classroom observation of integrated academics",
          "Same-day verbal feedback",
        ],
      },
      {
        id: "q4d",
        short: "After the visit",
        prompt: "What happens after the visit?",
        options: [
          "Report structured Strengths / Challenges / External Factors / Takeaways for the State",
          "District reviews and validates the draft before it is final",
          "Structured team debrief one week later",
          "Improvement plan folds into the existing CLNA and local application",
          "Reports published",
          "Technical assistance follow-up",
          "Recognition of strong programs (EPIC)",
          "No consequences in years 1-2",
        ],
      },
      {
        id: "q4e",
        short: "Rigorous and useful",
        prompt: "What would make the process both rigorous and useful to an LEA?",
        options: [
          "Four-point scale with a descriptor for every level",
          "Numeric anchors instead of adjectives",
          "An explicit 'insufficient evidence' option",
          "Pre-written root-cause menu",
          "Defined terms for every standard",
          "Split double-barreled indicators",
          "Consequences wired to a due-process pathway",
          "Publish post-review survey results",
          "Keep the purpose statements",
          "Keep the EPIC opt-in tier",
          "Reduced paperwork and no duplicate uploads",
          "Benchmarks against similar LEAs",
        ],
      },
    ],
  },
];

export const DEFAULT_TEAM_NAMES = ["Team 1", "Team 2", "Team 3", "Team 4"];
