// convert.js — turning HubSpot's stored values into what the team actually sees.
// No network here, so every conversion is tested.
const { SETTINGS, LONG_FIELDS } = require("./config");

// Characters XML cannot hold. Left in, they make Excel refuse to open the file.
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const xmlSafe = (s) => String(s).replace(BAD_XML, "");

// dropdowns: stored value -> label. Several HOF fields store one thing and show another —
// Age Range stores "46-50" for what the team sees as "41-45" — so labels are exported,
// and the dictionary keeps both, so it can always be reversed.
function maps(props, owners = [], pipes = [], teams = []) {
  const enums = {};
  for (const p of props) if (p.options.length) enums[p.name] = Object.fromEntries(p.options.map((o) => [o.value, o.label]));
  const ownerById = {}, ownerByUser = {};
  for (const o of owners) {
    const who = o.email || `${o.firstName || ""} ${o.lastName || ""}`.trim() || String(o.id);
    ownerById[String(o.id)] = who;
    if (o.userId) ownerByUser[String(o.userId)] = who;
  }
  const teamById = Object.fromEntries(teams.map((t) => [String(t.id), t.name]));
  const pipeById = {}, stageById = {};
  for (const p of pipes) { pipeById[String(p.id)] = p.label; for (const s of p.stages || []) stageById[String(s.id)] = `${s.label}`; }
  const ownerProps = new Set(props.filter((p) => p.referencedObjectType === "OWNER" || /(^|_)owner_ids?$/.test(p.name)).map((p) => p.name));
  const userProps = new Set(props.filter((p) => /_by_user_id$|^hs_user_ids_of_all_owners$/.test(p.name)).map((p) => p.name));
  const teamProps = new Set(props.filter((p) => /team_id$|_team_ids$/.test(p.name)).map((p) => p.name));
  return { enums, ownerById, ownerByUser, teamById, pipeById, stageById, ownerProps, userProps, teamProps };
}

const many = (v) => String(v).split(";").map((x) => x.trim()).filter(Boolean);

function value(name, raw, m) {
  if (raw == null || raw === "") return "";
  const v = String(raw);
  if (m.ownerProps.has(name)) return many(v).map((x) => m.ownerById[x] || x).join("; ");
  if (m.userProps.has(name)) return many(v).map((x) => m.ownerByUser[x] || x).join("; ");
  if (m.teamProps.has(name)) return many(v).map((x) => m.teamById[x] || x).join("; ");
  if (name === "pipeline" || name === "hs_pipeline") return m.pipeById[v] || v;
  if (name === "dealstage" || name === "hs_pipeline_stage") return m.stageById[v] || v;
  const e = m.enums[name];
  if (e) return many(v).map((x) => (e[x] != null ? e[x] : x)).join("; ");
  return v;
}

// columns for one object: the HubSpot ID, the links, then every property — a long field
// becomes several columns so that nothing is ever cut at Excel's cell limit
function columns(obj, props, links) {
  const cols = [{ key: "hubspot_id", label: "HubSpot record ID", type: "id" }];
  for (const l of links) cols.push({ key: `linked_${l}`, label: `Linked ${l} (HubSpot IDs)`, type: "links", link: l });
  for (const p of props) {
    if (LONG_FIELDS.includes(p.name)) {
      for (let i = 1; i <= SETTINGS.BODY_PARTS; i++) cols.push({ key: i === 1 ? p.name : `${p.name}__part${i}`, label: `${p.label}${i > 1 ? ` (part ${i})` : ""}`, type: p.type, prop: p.name, part: i });
    } else cols.push({ key: p.name, label: p.label, type: p.type, prop: p.name, part: 0 });
  }
  return cols;
}

// one record as a row. Returns how many cells had to be cut, so the manifest can report it.
function row(rec, cols, m, linkMaps) {
  const p = rec.properties || {};
  const out = new Array(cols.length);
  let cut = 0;
  const split = {};
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.type === "id") { out[i] = String(rec.id); continue; }
    if (c.type === "links") { const ids = (linkMaps[c.link] && linkMaps[c.link].get(String(rec.id))) || []; out[i] = ids.join("; "); continue; }
    if (c.part) {
      if (!(c.prop in split)) {
        const full = xmlSafe(value(c.prop, p[c.prop], m));
        const parts = [];
        for (let k = 0; k < full.length; k += SETTINGS.CELL_MAX) parts.push(full.slice(k, k + SETTINGS.CELL_MAX));
        if (parts.length > SETTINGS.BODY_PARTS) { cut++; parts.length = SETTINGS.BODY_PARTS; parts[parts.length - 1] += " …[cut]"; }
        split[c.prop] = parts;
      }
      out[i] = split[c.prop][c.part - 1] || "";
      continue;
    }
    let v = xmlSafe(value(c.prop, p[c.prop], m));
    if (v.length > SETTINGS.CELL_MAX) { v = v.slice(0, SETTINGS.CELL_MAX) + " …[cut]"; cut++; }
    out[i] = v;
  }
  return { cells: out, cut };
}

module.exports = { maps, value, columns, row, xmlSafe };
