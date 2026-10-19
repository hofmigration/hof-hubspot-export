// config.js — HubSpot full export. SAFE TO EDIT.
//
// Exports everything in HubSpot to Excel, in five layers, one part per run:
//   dictionary   properties, dropdown options, owners, teams, users, pipelines, access check
//   records      companies, contacts, deals, line items, products, quotes, tickets, leads
//   notes · tasks · meetings · calls · emails · communications   the activity history
//   files        every file in HubSpot's file manager
// Each record carries the IDs of the records it is linked to, so the new CRM can rebuild
// every relationship. Each run also writes a manifest: what HubSpot said it had, and what
// was exported — the proof that nothing was lost.

const SETTINGS = {
  PART: process.env.PART || "dictionary",
  FROM_DATE: process.env.FROM_DATE || "",          // optional — export a slice, e.g. one year of emails
  TO_DATE: process.env.TO_DATE || "",
  TEST_LIMIT: Number(process.env.TEST_LIMIT || 0), // 0 = everything; e.g. 200 to check the format first
  EARLIEST: "2014-01-01",                          // nothing in HOF's HubSpot is older than this

  // ---- Excel's hard limits ----
  SHEET_ROWS: 500000,      // a new sheet every half million rows (Excel's limit is 1,048,576)
  BOOK_ROWS: 1000000,      // a new file every million rows, so each file still opens
  CELL_MAX: 32000,         // Excel's limit is 32,767 characters per cell
  BODY_PARTS: 6,           // a long body is split across this many columns, so nothing is cut

  // HTML copies of emails double the size and add nothing a CRM needs that the text
  // doesn't already have. Set true to include them.
  INCLUDE_EMAIL_HTML: false,

  // ---- HubSpot's limits ----
  SEARCH_RPS: 4,           // search is limited to about 5 a second per account
  API_RPS: 9,
  WORKERS: 3,              // how many date windows are read at once

  OUT_DIR: "out",
};

const ENGAGEMENT_LINKS = ["contacts", "companies", "deals", "tickets"];
const PARTS = {
  dictionary: [],
  records: ["companies", "contacts", "deals", "line_items", "products", "quotes", "tickets", "leads"],
  notes: ["notes"], tasks: ["tasks"], meetings: ["meetings"], calls: ["calls"], emails: ["emails"], communications: ["communications"],
  files: [],
};

// which links each record type carries, as columns of IDs
const LINKS = {
  contacts: ["companies", "deals", "tickets"],
  companies: ["deals"],
  deals: ["contacts", "companies", "line_items", "quotes"],
  line_items: ["deals"],
  products: [],
  quotes: ["deals", "contacts", "line_items"],
  tickets: ["contacts", "companies", "deals"],
  leads: ["contacts", "companies"],
  notes: ENGAGEMENT_LINKS, tasks: ENGAGEMENT_LINKS, meetings: ENGAGEMENT_LINKS,
  calls: ENGAGEMENT_LINKS, emails: ENGAGEMENT_LINKS, communications: ENGAGEMENT_LINKS,
};

// fields that can run past one Excel cell, split across part columns instead of cut
const LONG_FIELDS = ["hs_email_text", "hs_email_html", "hs_note_body", "hs_call_body", "hs_call_transcript",
  "hs_task_body", "hs_meeting_body", "hs_internal_meeting_notes", "hs_communication_body", "description", "hs_body_preview"];

// file names, in import order
const FILE_ORDER = { dictionary: "00", companies: "01", contacts: "02", deals: "03", line_items: "04", products: "05", quotes: "06",
  tickets: "07", leads: "08", notes: "10", tasks: "11", meetings: "12", calls: "13", emails: "14", communications: "15", files: "20" };

module.exports = { SETTINGS, PARTS, LINKS, LONG_FIELDS, FILE_ORDER };
