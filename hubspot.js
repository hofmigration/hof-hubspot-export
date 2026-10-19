// hubspot.js — reading HubSpot, carefully. Nothing is ever written.
//
// Search is used for records and activities because it can be filtered by date, so a large
// object can be read in many small windows at once. HubSpot will not page past 10,000
// results in one search, so any window that is too big is halved until each part fits —
// a busy month can never be silently cut short.
const { SETTINGS } = require("./config");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// two separate throttles: search has a much lower limit than the rest of the API
function throttle(rps) {
  let next = 0;
  return async () => { const now = Date.now(); const at = Math.max(now, next); next = at + 1000 / rps; if (at > now) await sleep(at - now); };
}
const gate = { search: throttle(SETTINGS.SEARCH_RPS), api: throttle(SETTINGS.API_RPS) };

async function hs(method, path, body, kind = "api", attempt = 0) {
  await gate[kind]();
  let res;
  try {
    res = await fetch(`https://api.hubapi.com${path}`, {
      method, headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (attempt < 6) { await sleep(2000 * (attempt + 1)); return hs(method, path, body, kind, attempt + 1); }
    throw new Error(`Could not reach HubSpot: ${e.message}`);
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 8) {
    await sleep(Math.min(30000, 2000 * 2 ** attempt));
    return hs(method, path, body, kind, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) { const e = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 220)}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : null;
}

async function properties(obj) {
  const r = await hs("GET", `/crm/v3/properties/${obj}?archived=false`);
  return (r.results || []).map((p) => ({
    name: p.name, label: p.label, type: p.type, fieldType: p.fieldType, group: p.groupName, description: p.description || "",
    options: (p.options || []).map((o) => ({ value: String(o.value), label: o.label, hidden: !!o.hidden })),
    referencedObjectType: p.referencedObjectType || "", calculated: !!p.calculated, hubspotDefined: !!p.hubspotDefined,
  }));
}

// how many HubSpot says it holds, between two moments
async function total(obj, dateProp, from, to) {
  const filters = dateProp ? [{ propertyName: dateProp, operator: "GTE", value: String(from) }, { propertyName: dateProp, operator: "LT", value: String(to) }] : [];
  const r = await hs("POST", `/crm/v3/objects/${obj}/search`, { filterGroups: filters.length ? [{ filters }] : [], properties: ["hs_object_id"], limit: 1 }, "search");
  return r.total || 0;
}

// Planning: split [from, to) into windows of under 10,000 records each. HubSpot will not
// page past 10,000 in one search, so a busy window is halved until every part fits —
// nothing is ever silently cut short. Only counts are read here, so it is quick.
async function plan(obj, dateProp, from, to, depth = 0) {
  const n = await total(obj, dateProp, from, to);
  if (!n) return [];
  if (n > 9800 && depth < 24 && to - from > 1000) {
    const mid = Math.floor((from + to) / 2);
    return [...(await plan(obj, dateProp, from, mid, depth + 1)), ...(await plan(obj, dateProp, mid, to, depth + 1))];
  }
  return [{ from, to, n }];
}

// Reading one planned window, oldest first.
async function readLeaf(obj, dateProp, props, w) {
  const group = [{ filters: [{ propertyName: dateProp, operator: "GTE", value: String(w.from) }, { propertyName: dateProp, operator: "LT", value: String(w.to) }] }];
  const out = []; let after;
  for (let i = 0; i < 110; i++) {
    const r = await hs("POST", `/crm/v3/objects/${obj}/search`, { filterGroups: group, properties: props,
      sorts: [{ propertyName: dateProp, direction: "ASCENDING" }], limit: 100, after }, "search");
    out.push(...(r.results || []));
    after = r.paging && r.paging.next && r.paging.next.after;
    if (!after) break;
  }
  return out;
}

// links, many at once. HubSpot's batch size for this has changed over time, so it starts
// big and halves on refusal rather than assuming.
let assocBatch = 1000;
async function links(fromObj, toObj, ids) {
  const map = new Map();
  for (let i = 0; i < ids.length;) {
    const chunk = ids.slice(i, i + assocBatch);
    try {
      const r = await hs("POST", `/crm/v4/associations/${fromObj}/${toObj}/batch/read`, { inputs: chunk.map((id) => ({ id: String(id) })) });
      for (const row of r.results || []) map.set(String(row.from && row.from.id), (row.to || []).map((t) => String(t.toObjectId)));
      i += chunk.length;
    } catch (e) {
      if (e.status === 400 && assocBatch > 100) { assocBatch = Math.max(100, Math.floor(assocBatch / 2)); continue; }
      if (e.status === 403 || e.status === 404 || e.status === 400) return { map, error: `${e.status}` };
      throw e;
    }
  }
  return { map };
}

async function pagedGet(path, key = "results") {
  const out = []; let after;
  for (let i = 0; i < 5000; i++) {
    const r = await hs("GET", `${path}${path.includes("?") ? "&" : "?"}limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    out.push(...(r[key] || []));
    after = r.paging && r.paging.next && r.paging.next.after;
    if (!after) break;
  }
  return out;
}

const owners = () => pagedGet("/crm/v3/owners?archived=false");
const pipelines = (obj) => hs("GET", `/crm/v3/pipelines/${obj}`).then((r) => r.results || []);
async function users() {
  const props = ["hs_given_name", "hs_family_name", "hs_email", "hs_assigned_seats", "hs_last_activity_time", "hs_deactivated", "hs_internal_user_id"];
  return pagedGet(`/crm/v3/objects/users?properties=${props.join(",")}`);
}
const files = () => pagedGet("/files/v3/files/search?sort=createdAt");

module.exports = { hs, properties, total, plan, readLeaf, links, owners, pipelines, users, files };
