"use client";

import { useMemo, useState } from "react";

const templates = [
  ["Advisory committee agenda", "QPI 2.1", "Plan a focused, employer-informed meeting", "Include program data, curriculum feedback, safety, equipment, credentials, WBL, action owners, and due dates."],
  ["Advisory committee minutes", "QPI 2.1", "Document decisions and follow-through", "Capture attendees, discussion, recommendations, motions, assigned actions, dates, and evidence of follow-up."],
  ["Advisory sign-in sheet", "QPI 2.1", "Verify representation and participation", "Record name, organization, role, industry sector, email, signature, and meeting date."],
  ["Advisory membership roster", "QPI 2.1", "Show a current, representative committee", "Identify business, industry, education, student, parent, and community roles plus appointment term."],
  ["CTSO evidence tracker", "CTSO", "Connect student leadership to instruction", "Log chapter activities, dates, participants, standards, outcomes, photos, and file links."],
  ["CTSO agenda & minutes", "CTSO", "Document student-led chapter business", "Include officer roles, old/new business, decisions, service, competitive events, and next actions."],
  ["CTSO participation log", "CTSO", "Show equitable student involvement", "Track membership, leadership roles, events, competition, service hours, and recognitions."],
  ["Credential tracker", "Credentials", "Monitor access, attempts, and attainment", "Record credential, student group, date, attempt, result, cost support, and follow-up."],
  ["Work-based learning log", "WBL", "Connect classroom and workplace learning", "Capture employer, experience type, hours, supervisor, competencies, evaluation, and documentation link."],
  ["Program improvement organizer", "Improvement", "Turn findings into actions", "Define need, baseline, root cause, action, owner, resources, measure, milestone, and status."],
  ["Safety documentation checklist", "Safety", "Keep required records current", "Verify training, inspections, SDS, drills, PPE, incident procedures, student tests, and dates."],
  ["Equipment & inventory record", "Equipment", "Show safe, current instructional capacity", "List asset, location, condition, industry alignment, inspection date, replacement priority, and owner."],
  ["Teacher evidence checklist", "All QPIs", "Collect evidence during normal work", "Organize artifacts by QPI, date, quality check, filename, folder, and missing item."],
  ["Director review checklist", "All QPIs", "Complete a consistent pre-Cognia review", "Confirm relevance, recency, naming, readability, privacy, organization, and upload readiness."],
  ["PIP planning template", "PIP", "Build a measurable improvement plan", "State finding, root cause, target, strategies, responsible staff, resources, evidence, and timeline."],
  ["PIP progress monitor", "PIP", "Document implementation and impact", "Track milestone, evidence reviewed, measure, progress, barrier, adjustment, owner, and next review."],
  ["Annual preparation timeline", "Planning", "Pace TAPE work across the year", "Assign monthly tasks, owners, due dates, evidence areas, status, and local checkpoints."],
];

const timeline = [
  ["AUG", "Declare & organize", "Confirm programs and staff. Create the year folder structure. Set advisory membership."],
  ["SEP", "Launch evidence routines", "Submit declarations. Schedule advisory meetings. Start safety and equipment checks."],
  ["OCT", "Document engagement", "Capture CTSO, credential, and WBL evidence. Review naming conventions."],
  ["NOV", "Check the foundation", "Hold advisory meeting. File minutes, roster, sign-in, and follow-up actions."],
  ["DEC", "Clean & confirm", "Review first-semester evidence for currency, relevance, and missing items."],
  ["JAN", "Mid-year readiness", "Complete the QPI readiness check. Assign cleanup and support actions."],
  ["FEB", "Close evidence gaps", "Update credential, WBL, CTSO, safety, and equipment documentation."],
  ["MAR", "Review program quality", "Complete director review. Begin PIP planning where findings remain."],
  ["APR", "Prepare for Cognia", "Finalize strong artifacts. Confirm file names, privacy, and folder placement."],
  ["MAY", "Upload & verify", "Move approved official evidence into Cognia and confirm completion."],
  ["JUN", "Reflect & improve", "Archive the year, review trends, and record improvements for next cycle."],
  ["JUL", "Plan ahead", "Update local calendar, templates, contacts, and training needs."],
];

const nav = ["Start Here", "Declaration", "QPI Readiness", "Evidence Wizard", "Templates", "Naming", "Training", "Updates", "Support", "Timeline", "Cognia Prep", "FAQ"];

const formActions = [
  ["Program Declaration", "Annual program inventory and TAPE status", "18 fields", "Declarations"],
  ["QPI Readiness Check", "One response per program/QPI review", "13 fields", "QPI_Readiness"],
  ["Director Support Request", "Triage, ownership, and resolution", "12 fields", "Support_Requests"],
  ["TAPE Training Registration", "Event registration and accommodations", "10 fields", "Training_Registration"],
  ["Training Attendance", "QR sign-in at each session", "7 fields", "Training_Attendance"],
  ["Session Feedback", "Session quality and follow-up needs", "9 fields", "Training_Feedback"],
  ["Program Change Tracker", "Year-round program updates", "11 fields", "Program_Changes"],
  ["Local Timeline Builder", "District milestones and owners", "9 fields", "Local_Timelines"],
];

function slug(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9.-]+/g, "").replace(/\s/g, "");
}

export default function Home() {
  const [role, setRole] = useState("Director");
  const [goal, setGoal] = useState("Prepare evidence");
  const [area, setArea] = useState("Advisory committee");
  const [scope, setScope] = useState("Specific program");
  const [schoolYear, setSchoolYear] = useState("2026-2027");
  const [system, setSystem] = useState("Tallassee City");
  const [school, setSchool] = useState("Tallassee HS");
  const [program, setProgram] = useState("Health Science");
  const [qpi, setQpi] = useState("QPI2.1");
  const [artifact, setArtifact] = useState("Advisory Minutes");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const fileName = [schoolYear, system, school, program, qpi, artifact].map(slug).join("_");
  const filtered = templates.filter((t) => `${t[0]} ${t[1]} ${t[2]}`.toLowerCase().includes(query.toLowerCase()));
  const recommendation = useMemo(() => {
    const map: Record<string, string> = {
      "Understand a QPI": "Start with the QPI explanation, then compare the expectation with your current program practice.",
      "Prepare evidence": "Use the evidence checklist and related template. Choose current artifacts that show implementation and impact.",
      "Organize files": "Create the recommended QPI folders and rename artifacts before review.",
      "Complete a program declaration": "Open the Program Declaration form and submit one record per program.",
      "Complete a readiness check": "Complete the QPI Readiness form after a director-level evidence review.",
      "Request support": "Submit a Support Request with the QPI, urgency, and a clear description of the barrier.",
      "Prepare for a PIP": "Use the PIP planner to connect the finding, root cause, measurable action, evidence, and monitoring dates.",
    };
    return map[goal];
  }, [goal]);

  const downloadTemplate = (name: string, areaLabel: string) => {
    const body = `${name.toUpperCase()}\nTAPE RESOURCE HUB | ${areaLabel}\n\nSchool System:\nSchool:\nProgram:\nSchool Year:\nOwner:\nDate:\n\nPURPOSE\n\nEVIDENCE / NOTES\n\nACTION OR DECISION\n\nRESPONSIBLE PERSON\n\nDUE DATE\n\nFOLLOW-UP / OUTCOME\n\nRELATED FILE NAME\n${fileName}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = `${slug(name)}.txt`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <main>
      <div className="notice">PREPARATION HUB <span>This tool supports TAPE readiness. Cognia remains Alabama&apos;s official compliance and accreditation platform.</span></div>
      <header className="siteHeader">
        <a className="brand" href="#top" aria-label="TAPE Resource Hub home"><span className="stateMark">AL</span><span><b>TAPE</b><small>RESOURCE HUB · ALABAMA CTE</small></span></a>
        <nav aria-label="Primary navigation">
          {nav.slice(0, 6).map((item) => <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`}>{item}</a>)}
          <a className="navMore" href="#all-resources">All resources ↓</a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="blueprint blueprintOne"/><div className="blueprint blueprintTwo"/>
        <div className="heroCopy">
          <p className="eyebrow"><span/> TOOL FOR ASSESSING PROGRAM EFFECTIVENESS</p>
          <h1>Build programs<br/>that <em>last.</em></h1>
          <p className="lead">One organized place to declare programs, check QPI readiness, prepare strong evidence, and get support—before official work moves into Cognia.</p>
          <div className="heroActions"><a className="button primary" href="#start-here">Start here <b>→</b></a><a className="button secondary" href="#evidence-wizard">Find my evidence</a></div>
          <p className="micro">Better evidence. Better programs. Better Alabama.</p>
        </div>
        <div className="measureCard" aria-label="TAPE readiness cycle">
          <div className="tapeWord">TAPE</div>
          <div className="tapeLine"><span/><span/><span/><span/><span/></div>
          <div className="cycle"><b>ASSESS</b><b>EVALUATE</b><b>IMPROVE</b><b>GROW</b><b>IMPACT</b></div>
          <p>STRONG PROGRAMS<br/><strong>ARE BUILT DAILY.</strong></p>
        </div>
      </section>

      <section className="quickStrip" id="start-here">
        <div><span>01</span><b>Declare programs</b><small>Establish the annual program record.</small></div>
        <div><span>02</span><b>Check readiness</b><small>See what is ready, missing, or needs cleanup.</small></div>
        <div><span>03</span><b>Prepare evidence</b><small>Use templates, names, and folders consistently.</small></div>
        <div><span>04</span><b>Move to Cognia</b><small>Upload approved official evidence there.</small></div>
      </section>

      <section className="section split" id="declaration">
        <div>
          <p className="kicker">START HERE · ANNUAL SETUP</p><h2>Know what you have.<br/><i>Know what needs support.</i></h2>
          <p>Submit one declaration for each active, new, inactive, or closing CTE program. Directors establish the record; teachers can help confirm program details.</p>
          <ul className="checkList"><li>Program, cluster, teacher, CTSO, credential, and WBL connection</li><li>Advisory status and current program status</li><li>TAPE review year and areas of concern</li></ul>
          <a className="button dark" href="https://forms.office.com" target="_blank" rel="noreferrer">Open Program Declaration ↗</a>
          <small className="pending">Microsoft Form destination ready to connect during tenant setup.</small>
        </div>
        <div className="statusPanel">
          <p>DECLARATION SNAPSHOT</p><h3>What happens next?</h3>
          {["Response enters Declarations table", "Program ID is assigned", "Change submissions update the active record", "Dashboard filters by system, school, program, and status"].map((x,i)=><div className="statusRow" key={x}><span>0{i+1}</span>{x}</div>)}
        </div>
      </section>

      <section className="section navy" id="qpi-readiness">
        <div className="sectionHeading"><div><p className="kicker">QPI READINESS</p><h2>A readiness check.<br/><i>Not another compliance platform.</i></h2></div><p>For each QPI, confirm whether evidence exists, is current, is organized, and needs support. Use the result to assign next steps before Cognia.</p></div>
        <div className="readinessGrid">
          {[["READY","Evidence is current, relevant, organized, and reviewable","green"],["NEEDS CLEANUP","Evidence exists but naming, dates, or organization need work","blue"],["MISSING EVIDENCE","The expected practice or artifact cannot yet be shown","orange"],["NOT APPLICABLE","The QPI does not apply; document the rationale","gray"],["SUPPORT REQUESTED","Director or teacher needs clarification, coaching, or review","red"]].map(x=><article key={x[0]} className={x[2]}><span>●</span><h3>{x[0]}</h3><p>{x[1]}</p></article>)}
        </div>
        <a className="button gold" href="https://forms.office.com" target="_blank" rel="noreferrer">Complete a readiness check ↗</a>
      </section>

      <section className="section wizardSection" id="evidence-wizard">
        <div className="sectionHeading"><div><p className="kicker">GUIDED RESOURCE FINDER</p><h2>What evidence<br/><i>do I need?</i></h2></div><p>Answer four quick questions. The hub will point you to the right next step, related template, naming guidance, and Cognia reminder.</p></div>
        <div className="wizard">
          <div className="wizardFields">
            <label>1 · I am a<select value={role} onChange={e=>setRole(e.target.value)}><option>Director</option><option>Teacher</option></select></label>
            <label>2 · I want to<select value={goal} onChange={e=>setGoal(e.target.value)}>{["Understand a QPI","Prepare evidence","Organize files","Complete a program declaration","Complete a readiness check","Request support","Prepare for a PIP"].map(x=><option key={x}>{x}</option>)}</select></label>
            <label>3 · Evidence area<select value={area} onChange={e=>setArea(e.target.value)}>{["Advisory committee","CTSO","Credentials","Work-based learning","Safety","Equipment","Program improvement","All QPIs"].map(x=><option key={x}>{x}</option>)}</select></label>
            <label>4 · Scope<select value={scope} onChange={e=>setScope(e.target.value)}><option>Specific program</option><option>District-wide preparation</option></select></label>
          </div>
          <div className="wizardResult"><p>YOUR ROUTE</p><span className="routeTag">{role} · {area} · {scope}</span><h3>{recommendation}</h3><ol><li>Review the <b>{area}</b> expectation and evidence checklist.</li><li>Download the related template and use the file-name generator.</li><li>Complete the readiness check; request support if the status is not Ready.</li></ol><div className="cogniaNote"><b>COGNIA CHECK</b> When official evidence is required, upload the final approved artifact in Cognia—not here.</div><a href="#templates" className="textLink">Show related templates →</a></div>
        </div>
      </section>

      <section className="section library" id="templates">
        <div className="sectionHeading"><div><p className="kicker">TEMPLATE LIBRARY · 17 RESOURCES</p><h2>Start consistent.<br/><i>Finish review-ready.</i></h2></div><div className="search"><label htmlFor="templateSearch">Search templates</label><input id="templateSearch" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Try advisory, safety, PIP..."/></div></div>
        <div className="templateGrid">{filtered.map((t,i)=><article className="template" key={t[0]}><div><span className="fileIcon">{String(i+1).padStart(2,"0")}</span><small>{t[1]}</small></div><h3>{t[0]}</h3><p><b>Use it to:</b> {t[2]}.</p><p className="strong"><b>Strong evidence:</b> {t[3]}</p><button onClick={()=>downloadTemplate(t[0],t[1])}>Download starter ↓</button></article>)}</div>
      </section>

      <section className="section naming" id="naming">
        <div className="sectionHeading"><div><p className="kicker">NAMING + FOLDER SYSTEM</p><h2>Name it once.<br/><i>Find it fast.</i></h2></div><p>Use the same six-part formula across every system and program. Remove spaces and special characters from each segment.</p></div>
        <div className="formula">[SchoolYear]_[System]_[School]_[Program]_[QPI]_[ArtifactType]</div>
        <div className="generator">
          {[['School year',schoolYear,setSchoolYear],['System',system,setSystem],['School',school,setSchool],['Program',program,setProgram],['QPI / Area',qpi,setQpi],['Artifact',artifact,setArtifact]].map(([l,v,setter])=><label key={l as string}>{l as string}<input value={v as string} onChange={e=>(setter as (s:string)=>void)(e.target.value)}/></label>)}
          <div className="generated"><small>YOUR FILE NAME</small><code>{fileName}</code><button onClick={()=>{navigator.clipboard?.writeText(fileName);setCopied(true);setTimeout(()=>setCopied(false),1500)}}>{copied?"Copied!":"Copy name"}</button></div>
        </div>
        <div className="folderTree"><div><b>📁 2026-2027 TAPE</b><span>↳ 00_Program Declaration</span><span>↳ 01_QPI Readiness</span><span>↳ 02_Advisory Committee</span><span>↳ 03_CTSO</span></div><div><span>↳ 04_Credentials</span><span>↳ 05_Work-Based Learning</span><span>↳ 06_Safety & Equipment</span><span>↳ 07_Program Improvement & PIP</span></div><div><span>↳ 08_Approved for Cognia</span><span>↳ 09_Training & Support</span><span>↳ 99_Archive - Do Not Upload</span><small>Keep drafts separate from approved evidence.</small></div></div>
      </section>

      <section className="section timelineSection" id="timeline">
        <div className="sectionHeading"><div><p className="kicker">ANNUAL TAPE TIMELINE</p><h2>Build daily.<br/><i>Review calmly.</i></h2></div><a className="button outline" href="https://forms.office.com" target="_blank" rel="noreferrer">Customize local timeline ↗</a></div>
        <div className="timeline">{timeline.map((m,i)=><article key={m[0]}><div><span>{String(i+1).padStart(2,"0")}</span><b>{m[0]}</b></div><h3>{m[1]}</h3><p>{m[2]}</p></article>)}</div>
      </section>

      <section className="section dataSection" id="all-resources">
        <div className="sectionHeading"><div><p className="kicker">MICROSOFT 365 DATA PLAN</p><h2>One source.<br/><i>Clean reporting.</i></h2></div><p>Use a SharePoint-hosted Excel workbook for launch, then move high-volume operational tables to Microsoft Lists without changing field names.</p></div>
        <div className="dataLayout"><div className="formTable"><div className="tableHead"><span>FORM</span><span>PURPOSE</span><span>DESTINATION</span></div>{formActions.map(x=><div className="tableRow" key={x[0]}><span><b>{x[0]}</b><small>{x[2]}</small></span><span>{x[1]}</span><code>{x[3]}</code></div>)}</div><aside><h3>Master workbook</h3><p><b>TAPE_Master_Data.xlsx</b></p><ul><li>Reference_Lists</li><li>Program_Master</li><li>Declarations</li><li>QPI_Readiness</li><li>Support_Requests</li><li>Training (3 tabs)</li><li>Program_Changes</li><li>Local_Timelines</li><li>Dashboard_Export</li></ul><div className="tip"><b>Governance:</b> use ProgramID, ResponseID, SchoolYear, System, School, Program, SubmittedDate, and Status in every operational table.</div></aside></div>
      </section>

      <section className="section actions" id="training">
        <div className="actionCard"><p>TRAINING & EVENTS</p><h3>Learn. Practice. Follow up.</h3><span>Register, use QR sign-in, share feedback, and access post-session resources.</span><a href="https://forms.office.com" target="_blank" rel="noreferrer">View training tools →</a></div>
        <div className="actionCard" id="updates"><p>PROGRAM UPDATES</p><h3>Keep the program record current.</h3><span>Report staff, credential, CTSO, facility, equipment, pathway, and status changes.</span><a href="https://forms.office.com" target="_blank" rel="noreferrer">Submit an update →</a></div>
        <div className="actionCard orangeCard" id="support"><p>SUPPORT REQUESTS</p><h3>Ask early. Move forward.</h3><span>Request QPI, evidence, Cognia prep, template, PIP, training, or readiness help.</span><a href="https://forms.office.com" target="_blank" rel="noreferrer">Request support →</a></div>
      </section>

      <section className="section cognia" id="cognia-prep"><div><p className="kicker">FINAL HANDOFF</p><h2>Prepare here.<br/><i>Submit in Cognia.</i></h2><p>The TAPE Resource Hub helps you understand expectations, organize work, and verify readiness. It does not collect official accreditation evidence.</p></div><ol><li><b>REVIEW</b><span>Relevant, current, complete, readable</span></li><li><b>PROTECT</b><span>Remove unnecessary student-sensitive data</span></li><li><b>NAME</b><span>Apply the standard file name</span></li><li><b>APPROVE</b><span>Director confirms upload readiness</span></li><li><b>UPLOAD</b><span>Submit official evidence in Cognia</span></li></ol></section>

      <section className="section faq" id="faq"><p className="kicker">FREQUENTLY ASKED QUESTIONS</p><h2>Clear answers.<br/><i>Fewer surprises.</i></h2>{[["Does this replace Cognia?","No. Cognia remains the official compliance and accreditation platform. This hub is for preparation, organization, templates, declarations, readiness checks, and support."],["Should evidence be uploaded here?","No. Keep working files in your approved local Microsoft 365 folders. Upload official evidence only in Cognia when directed."],["How often should readiness be checked?","At minimum, complete a mid-year check and a final pre-Cognia review. Directors may add local checkpoints."],["What makes evidence strong?","Strong evidence is relevant to the expectation, current, complete, readable, specific to the program, and shows implementation or impact—not just intent."],["Who can request support?","The support workflow is director-led, but teachers can help describe the program need. Include the QPI, urgency, and desired outcome."]].map(x=><details key={x[0]}><summary>{x[0]}<span>+</span></summary><p>{x[1]}</p></details>)}</section>

      <footer><div className="brand"><span className="stateMark">AL</span><span><b>TAPE</b><small>RESOURCE HUB · ALABAMA CTE</small></span></div><p>Better evidence. Better programs. Better Alabama.</p><div><a href="#top">Back to top ↑</a><small>Preparation resource · Not the official Cognia platform</small></div></footer>
    </main>
  );
}
