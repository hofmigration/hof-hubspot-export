// export.js — the run. Read-only: nothing in HubSpot is changed.
const fs = require("fs");
const path = require("path");
const { SETTINGS, PARTS, LINKS, FILE_ORDER } = require("./config");
const hub = require("./hubspot");
const C = require("./convert");
const { Book, tables } = require("./xlsx");

const DAY = 864e5;
const iso = (t) => (t ? new Date(t).toISOString() : "");
const dayStart = (s) => { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
const months = (from, to) => { const out = []; let d = new Date(from); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  for (let t = from; t < to;) { const n = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); out.push([t, Math.min(n, to)]); t = Math.min(n, to); d = new Date(n); } return out; };

// shared reference data: owners, teams, pipelines
async function reference() {
  const owners = await hub.owners().catch(() => []);
  const teams = []; const seen = new Set();
  owners.forEach((o) => (o.teams || []).forEach((t) => { if (!seen.has(t.id)) { seen.add(t.id); teams.push({ id: t.id, name: t.name }); } }));
  const pipes = [];
  for (const obj of ["deals", "tickets", "leads"]) { try { pipes.push(...(await hub.pipelines(obj)).map((p) => ({ ...p, object: obj }))); } catch { /* not readable */ } }
  return { owners, teams, pipes };
}

// ================================================================== DICTIONARY
async function dictionary(ref) {
  const objs = [...PARTS.records, "notes", "tasks", "meetings", "calls", "emails", "communications"];
  const propRows = [["Object", "Property", "Label", "Type", "Field type", "Group", "Calculated", "HubSpot-defined", "Description"]];
  const optRows = [["Object", "Property", "Stored value", "What the team sees", "Hidden"]];
  const access = [["Object", "Readable", "Records in HubSpot", "If not readable"]];
  for (const obj of objs) {
    try {
      const props = await hub.properties(obj);
      for (const p of props) {
        propRows.push([obj, p.name, p.label, p.type, p.fieldType, p.group, p.calculated ? "yes" : "", p.hubspotDefined ? "yes" : "", p.description]);
        for (const o of p.options) optRows.push([obj, p.name, o.value, o.label, o.hidden ? "yes" : ""]);
      }
      const n = await hub.total(obj).catch(() => "");
      access.push([obj, "yes", n, ""]);
    } catch (e) {
      access.push([obj, "NO", "", e.status === 403 ? "The private app is missing the scope for this object — add it, then run again" : e.message.slice(0, 120)]);
    }
  }
  const users = await hub.users().catch(() => []);
  const file = path.join(SETTINGS.OUT_DIR, `${FILE_ORDER.dictionary}-Dictionary.xlsx`);
  await tables(file, [
    ["Read me", [["HubSpot export — dictionary"], [`Exported ${new Date().toISOString()}`], [""],
      ["Properties: every field on every object."], ["Dropdown options: stored value -> what the team sees. The data files use what the team sees; this tab reverses it."],
      ["Owners and Users: match HubSpot people to the new CRM by email."], ["Pipelines: every pipeline and stage, by ID and name."],
      ["Access check: which objects this token can read. Anything marked NO is missing from the export until its scope is added."]]],
    ["Access check", access],
    ["Properties", propRows],
    ["Dropdown options", optRows],
    ["Owners", [["Owner ID", "User ID", "Email", "First name", "Last name", "Teams", "Archived"],
      ...ref.owners.map((o) => [String(o.id), String(o.userId || ""), o.email || "", o.firstName || "", o.lastName || "", (o.teams || []).map((t) => t.name).join("; "), o.archived ? "yes" : ""])]],
    ["Teams", [["Team ID", "Team"], ...ref.teams.map((t) => [String(t.id), t.name])]],
    ["Users", [["User record ID", "Email", "First name", "Last name", "Seat", "Last active", "Deactivated"],
      ...users.map((u) => { const p = u.properties || {}; return [String(u.id), p.hs_email || "", p.hs_given_name || "", p.hs_family_name || "", p.hs_assigned_seats || "", p.hs_last_activity_time || "", p.hs_deactivated || ""]; })]],
    ["Pipelines", [["Object", "Pipeline ID", "Pipeline", "Stage ID", "Stage", "Stage order"],
      ...ref.pipes.flatMap((p) => (p.stages || []).map((s) => [p.object, String(p.id), p.label, String(s.id), s.label, s.displayOrder]))]],
  ]);
  console.log(`Wrote ${path.basename(file)} — ${propRows.length - 1} properties, ${optRows.length - 1} dropdown options, ${ref.owners.length} owners, ${users.length} users.`);
  return [["dictionary", "", "", path.basename(file), "", "", ""]];
}

// ================================================================== FILES
async function fileList() {
  const list = await hub.files();
  const file = path.join(SETTINGS.OUT_DIR, `${FILE_ORDER.files}-Files.xlsx`);
  await tables(file, [["Files", [["File ID", "Name", "Extension", "Size (bytes)", "Folder", "Access", "URL", "Created", "Updated"],
    ...list.map((f) => [String(f.id), f.name || "", f.extension || "", f.size || "", f.path || f.parentFolderId || "", f.access || "", f.url || "", f.createdAt || "", f.updatedAt || ""])]]]);
  console.log(`Wrote ${path.basename(file)} — ${list.length} files listed. Notes and emails name their attachments by File ID.`);
  return [["files", list.length, list.length, path.basename(file), "", "", ""]];
}

// ================================================================== ONE OBJECT
async function exportObject(obj, ref) {
  let props;
  try { props = await hub.properties(obj); }
  catch (e) { console.log(`  ${obj}: not readable (${e.status || e.message}). Skipped — add its scope and run again.`); return [obj, "", 0, "NOT READABLE", "", "", e.status === 403 ? "missing scope" : String(e.message).slice(0, 80)]; }
  if (obj === "emails" && !SETTINGS.INCLUDE_EMAIL_HTML) props = props.filter((p) => p.name !== "hs_email_html");

  const names = props.map((p) => p.name);
  const dateProp = names.includes("createdate") ? "createdate" : "hs_createdate";
  const links = LINKS[obj] || [];
  const m = C.maps(props, ref.owners, ref.pipes, ref.teams);
  const cols = C.columns(obj, props, links);
  const from = dayStart(SETTINGS.FROM_DATE) ?? dayStart(SETTINGS.EARLIEST);
  const to = SETTINGS.TO_DATE ? dayStart(SETTINGS.TO_DATE) + DAY : Date.now() + DAY;
  const slice = SETTINGS.FROM_DATE || SETTINGS.TO_DATE ? `-${SETTINGS.FROM_DATE || "start"}_to_${SETTINGS.TO_DATE || "now"}` : "";
  const book = new Book(SETTINGS.OUT_DIR, `${FILE_ORDER[obj]}-${obj}${slice}`, cols);

  const expected = await hub.total(obj, dateProp, from, to);
  console.log(`  ${obj}: ${expected} in HubSpot for this range, ${props.length} properties, ${links.length} kinds of link`);

  // 1. plan: windows of under 10,000 records each — counts only, so it is quick
  const leaves = [];
  for (const [a, b] of months(from, to)) leaves.push(...(await hub.plan(obj, dateProp, a, b)));
  console.log(`    planned ${leaves.length} window(s)`);

  // 2. read a few windows at once, but write them strictly in order. Memory stays small:
  //    only the windows in flight are ever held.
  let written = 0, cut = 0;
  const linkErrors = new Set();
  const limit = SETTINGS.TEST_LIMIT || Infinity;
  const fetchLeaf = async (w) => {
    const recs = await hub.readLeaf(obj, dateProp, names, w);
    const ids = recs.map((r) => String(r.id));
    const linkMaps = {};
    for (const l of links) { const r = ids.length ? await hub.links(obj, l, ids) : { map: new Map() }; linkMaps[l] = r.map; if (r.error) linkErrors.add(`${l} (${r.error})`); }
    return { recs, linkMaps };
  };
  const results = new Array(leaves.length);
  let launched = 0;
  // every result is settled into {ok, v|e}, so a window that fails while another is being
  // written can never crash the run unnoticed — it is raised when its turn comes
  const launch = () => { const i = launched++; results[i] = fetchLeaf(leaves[i]).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })); };
  for (let i = 0; i < Math.min(SETTINGS.WORKERS, leaves.length); i++) launch();
  for (let i = 0; i < leaves.length && written < limit; i++) {
    const r = await results[i];
    results[i] = null;
    if (launched < leaves.length) launch();
    if (!r.ok) throw r.e;
    for (const rec of r.v.recs) {
      if (written >= limit) break;
      const { cells, cut: c } = C.row(rec, cols, m, r.v.linkMaps);
      await book.add(cells); written++; cut += c;
    }
    if ((i + 1) % 25 === 0 || i === leaves.length - 1) console.log(`    ${i + 1}/${leaves.length} windows — ${written} written`);
  }
  const res = await book.close();
  const note = [SETTINGS.TEST_LIMIT ? `test run, first ${SETTINGS.TEST_LIMIT}` : "", linkErrors.size ? `links not readable: ${[...linkErrors].join(", ")}` : "", cut ? `${cut} cell(s) longer than ${SETTINGS.BODY_PARTS} parts were cut` : ""].filter(Boolean).join(" · ");
  if (!SETTINGS.TEST_LIMIT && written !== expected) console.log(`  !! ${obj}: HubSpot said ${expected}, exported ${written}. Records added during the run explain a small difference; a large one does not.`);
  return [obj, expected, written, res.files.join(", "), res.sheets, cols.length, note];
}

// ================================================================== RUN
async function main() {
  if (!process.env.HUBSPOT_TOKEN) { console.log("!! No HUBSPOT_TOKEN secret."); process.exit(1); }
  const part = SETTINGS.PART;
  if (!(part in PARTS)) { console.log(`!! Unknown part "${part}". Choose one of: ${Object.keys(PARTS).join(", ")}`); process.exit(1); }
  fs.mkdirSync(SETTINGS.OUT_DIR, { recursive: true });
  const started = new Date();
  console.log(`=== HubSpot export — ${part}${SETTINGS.TEST_LIMIT ? ` (test: first ${SETTINGS.TEST_LIMIT} of each)` : ""} ===\n`);
  try {
    const ref = await reference();
    let rows;
    if (part === "dictionary") rows = await dictionary(ref);
    else if (part === "files") rows = await fileList();
    else { rows = []; for (const obj of PARTS[part]) rows.push(await exportObject(obj, ref)); }

    const file = path.join(SETTINGS.OUT_DIR, `Manifest-${part}.xlsx`);
    await tables(file, [["Manifest", [
      ["Object", "In HubSpot", "Exported", "Files", "Sheets", "Columns", "Notes"], ...rows,
      [], [`Part: ${part}`], [`Range: ${SETTINGS.FROM_DATE || "the start"} to ${SETTINGS.TO_DATE || "now"}`],
      [`Started ${started.toISOString()}, finished ${new Date().toISOString()}`],
      ["Dropdowns are exported as what the team sees; owners as their email; pipelines and stages by name. The Dictionary reverses all of these."],
      [`Long fields are split across columns named <field>__part2, __part3… — join them in order to get the full text.`]]]]);
    console.log(`\nWrote ${path.basename(file)}. Everything is in this run's Artifacts — download it, then delete the artifact.`);
  } catch (e) {
    console.error(`\nFAILED: ${e.message}`);
    process.exit(1);
  }
}

// run only when started directly, so the self-test can drive exportObject with a fake HubSpot
if (require.main === module) main();
module.exports = { exportObject, months };
