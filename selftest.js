// selftest.js — the whole export, against a fake HubSpot where every answer is known.
// A real run takes hours; this proves the conversions, the splitting, the links, the
// ordering and the Excel limits in seconds, before every run.
const fs = require("fs");
const path = require("path");
const { SETTINGS } = require("./config");
const C = require("./convert");

let pass = 0, fail = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${l}${ok || !d ? "" : `\n        ${d}`}`); ok ? pass++ : fail++; };

(async () => {
  console.log("HUBSPOT EXPORT — SELF-TEST\n");

  // ---- conversions ----
  const props = [
    { name: "age_range", label: "Age Range", type: "enumeration", options: [{ value: "46-50", label: "41-45" }, { value: "50++", label: "50+" }] },
    { name: "education_level", label: "Education Level", type: "enumeration", options: [{ value: "Other", label: "Diploma" }] },
    { name: "langs", label: "Languages", type: "enumeration", options: [{ value: "en", label: "English" }, { value: "ur", label: "Urdu" }] },
    { name: "hubspot_owner_id", label: "Owner", type: "enumeration", referencedObjectType: "OWNER", options: [] },
    { name: "hs_created_by_user_id", label: "Created by", type: "number", options: [] },
    { name: "hubspot_team_id", label: "Team", type: "enumeration", options: [] },
    { name: "pipeline", label: "Pipeline", type: "enumeration", options: [] },
    { name: "dealstage", label: "Deal stage", type: "enumeration", options: [] },
    { name: "phone", label: "Phone", type: "string", options: [] },
    { name: "hs_email_text", label: "Email body", type: "string", options: [] },
  ];
  const owners = [{ id: 89930419, userId: 555, email: "warda@hofmigration.com" }];
  const pipes = [{ id: "149481597", label: "HOF Service Pipeline (USA NIW)", stages: [{ id: "60994706", label: "Payment Made/Deal Won" }] }];
  const m = C.maps(props, owners, pipes, [{ id: 7, name: "Case Managers" }]);
  check("a dropdown exports what the team sees — Age Range '46-50' is 41-45", C.value("age_range", "46-50", m) === "41-45");
  check("Education Level 'Other' exports as Diploma", C.value("education_level", "Other", m) === "Diploma");
  check("a multi-select keeps every choice", C.value("langs", "en;ur", m) === "English; Urdu");
  check("an option deleted since keeps its stored value, never blank", C.value("age_range", "33-40", m) === "33-40");
  check("an owner exports as their email", C.value("hubspot_owner_id", "89930419", m) === "warda@hofmigration.com");
  check("a 'created by' user exports as their email", C.value("hs_created_by_user_id", "555", m) === "warda@hofmigration.com");
  check("a team exports by name", C.value("hubspot_team_id", "7", m) === "Case Managers");
  check("a pipeline exports by name", C.value("pipeline", "149481597", m) === "HOF Service Pipeline (USA NIW)");
  check("a stage exports by name", C.value("dealstage", "60994706", m) === "Payment Made/Deal Won");
  check("a phone number stays exactly as typed", C.value("phone", "+971 52 449 0607", m) === "+971 52 449 0607");
  check("characters Excel can't hold are removed", C.xmlSafe("ok\u0000\u0007 text") === "ok text");

  // ---- columns and long text ----
  const cols = C.columns("emails", props, ["contacts", "deals"]);
  check("the HubSpot ID is the first column", cols[0].key === "hubspot_id");
  check("each kind of link gets a column", cols[1].key === "linked_contacts" && cols[2].key === "linked_deals");
  check(`a long field gets ${SETTINGS.BODY_PARTS} part columns`, cols.filter((c) => c.prop === "hs_email_text").length === SETTINGS.BODY_PARTS);
  const long = "x".repeat(SETTINGS.CELL_MAX * 2 + 10);
  const r1 = C.row({ id: "1", properties: { hs_email_text: long } }, cols, m, { contacts: new Map([["1", ["11", "12"]]]), deals: new Map() });
  const parts = cols.map((c, i) => [c, r1.cells[i]]).filter(([c]) => c.prop === "hs_email_text").map(([, v]) => v);
  check("a body longer than one cell is split, not cut", parts.join("").length === long.length && r1.cut === 0);
  check("every part fits in an Excel cell", parts.every((p) => p.length <= 32767));
  check("links are listed by ID", r1.cells[1] === "11; 12");
  const huge = "y".repeat(SETTINGS.CELL_MAX * (SETTINGS.BODY_PARTS + 1));
  const r2 = C.row({ id: "2", properties: { hs_email_text: huge } }, cols, m, {});
  check("only text beyond every part column is cut, and it's counted", r2.cut === 1);

  // ---- the whole export, against a fake HubSpot ----
  const N = 2600;
  const T0 = Date.UTC(2024, 0, 1);
  const fake = [];
  for (let i = 0; i < N; i++) fake.push({ id: String(1000 + i), properties: { createdate: new Date(T0 + i * 3 * 3600e3).toISOString(), age_range: i % 2 ? "46-50" : "50++", hubspot_owner_id: "89930419", phone: `+92300${i}` } });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const inRange = (a, b) => fake.filter((r) => { const t = Date.parse(r.properties.createdate); return t >= a && t < b; });
  const hubMock = {
    properties: async () => props.filter((p) => ["age_range", "hubspot_owner_id", "phone"].includes(p.name)).concat([{ name: "createdate", label: "Created", type: "datetime", options: [] }]),
    total: async (obj, dp, a, b) => (a == null ? fake.length : inRange(a, b).length),
    // windows of under 300 here, so the test exercises many windows and the splitting
    plan: async function plan(obj, dp, a, b) { const n = inRange(a, b).length; if (!n) return []; if (n > 300) { const mid = Math.floor((a + b) / 2); return [...(await plan(obj, dp, a, mid)), ...(await plan(obj, dp, mid, b))]; } return [{ from: a, to: b, n }]; },
    // random delays, so windows finish out of order — the file must still be in order
    readLeaf: async (obj, dp, names, w) => { await sleep(Math.random() * 15); return inRange(w.from, w.to); },
    links: async (from, to, ids) => ({ map: new Map(ids.map((id) => [id, [`c${id}`]])) }),
  };
  require.cache[require.resolve("./hubspot")] = { id: "hub", filename: require.resolve("./hubspot"), loaded: true, exports: hubMock };
  Object.assign(SETTINGS, { SHEET_ROWS: 1000, BOOK_ROWS: 2000, OUT_DIR: "/tmp/export-test", EARLIEST: "2024-01-01", TO_DATE: "2024-12-31" });
  fs.rmSync(SETTINGS.OUT_DIR, { recursive: true, force: true });
  const { exportObject } = require("./export");
  const LINKS = require("./config").LINKS; LINKS.contacts = ["companies"];
  const res = await exportObject("contacts", { owners, pipes: [], teams: [] });
  check(`every record is exported (${res[2]} of ${N})`, res[2] === N && res[1] === N);
  check("a new file starts every BOOK_ROWS rows", String(res[3]).split(", ").length === 2);
  check("a new sheet starts every SHEET_ROWS rows", res[4] === 3);

  // read the files back and check the content and the order
  const ExcelJS = require("exceljs");
  const files = String(res[3]).split(", ");
  const ids = []; let first = null, sheetNames = [];
  for (const f of files) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(SETTINGS.OUT_DIR, f));
    sheetNames.push(...wb.worksheets.map((w) => w.name));
    for (const ws of wb.worksheets.filter((w) => w.name.startsWith("Data"))) {
      ws.eachRow((row, n) => { if (n === 1) { first = first || row.values.slice(1); return; } ids.push(String(row.getCell(1).value)); });
    }
  }
  check("rows come out in creation order, even when windows finish out of order", ids.every((id, i) => i === 0 || Number(id) > Number(ids[i - 1])));
  check("no record is written twice", new Set(ids).size === ids.length && ids.length === N);
  check("every file ends with a Columns guide", sheetNames.filter((n) => n === "Columns").length === files.length);
  check("the header row uses HubSpot's field names", first && first[0] === "hubspot_id" && first.includes("age_range"));
  const wb1 = new ExcelJS.Workbook(); await wb1.xlsx.readFile(path.join(SETTINGS.OUT_DIR, files[0]));
  const r2row = wb1.getWorksheet("Data 1").getRow(3).values.slice(1);
  const ci = first.indexOf("age_range"), oi = first.indexOf("hubspot_owner_id"), li = first.indexOf("linked_companies");
  check("the file holds what the team sees, not the stored value", r2row[ci] === "41-45");
  check("the file holds the owner's email", r2row[oi] === "warda@hofmigration.com");
  check("the file holds each record's links", String(r2row[li]).startsWith("c"));

  // a test run stops early, cleanly
  Object.assign(SETTINGS, { TEST_LIMIT: 50, OUT_DIR: "/tmp/export-test2" });
  fs.rmSync(SETTINGS.OUT_DIR, { recursive: true, force: true });
  const t = await exportObject("contacts", { owners, pipes: [], teams: [] });
  check("a test run exports exactly its limit", t[2] === 50 && /test run/.test(t[6]));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => { console.error("SELF-TEST CRASHED:", e); process.exit(1); });
