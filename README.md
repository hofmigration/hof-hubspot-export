# HubSpot full export

Exports everything in HubSpot to Excel, in the order a new CRM has to import it, with every
link between records kept, and a manifest proving nothing was lost.

Read-only. Nothing in HubSpot is changed.

**What's being exported** — counted on 19 October 2026:

| | Records | | Records |
|---|---|---|---|
| Contacts | 433,865 | Emails | 3,369,585 |
| Deals | 58,368 | Calls | 2,360,813 |
| Line items | 27,223 | Tasks | 524,881 |
| Companies | 3,948 | Notes | 352,635 |
| Tickets | 4 | Meetings | 11,053 |

Plus quotes, products, leads, WhatsApp/SMS communications, owners, users, pipelines and files.

---

## Setting it up

New **private** repo, e.g. `hof-hubspot-export`. Everything in the root, and
`hubspot-export.yml` in `.github/workflows/`. One secret: `HUBSPOT_TOKEN`.

## Running it — one part at a time, in this order

**Actions → HubSpot export → Run workflow**, choose the part, and run.

| Step | Part | Notes |
|---|---|---|
| 1 | `dictionary` | Fields, dropdown options, owners, users, pipelines, and an **Access check** |
| 2 | `records` with **test_limit `200`** | Open the files and check they look right before the long runs |
| 3 | `records` | Companies, contacts, deals, line items, products, quotes, tickets, leads |
| 4 | `notes`, `tasks`, `meetings` | One run each |
| 5 | `calls` | **Split by year** — see below |
| 6 | `emails` | **Split by year** — see below |
| 7 | `communications`, `files` | WhatsApp/SMS logged in HubSpot, and the file list |

**After step 1, open the *Access check* tab.** Any object marked **NO** is one this token
can't read. Add that object's read scope to the private app (Settings → Integrations →
Private Apps → Scopes), then carry on. Leads and Communications are the likely ones.

### Splitting emails and calls by year

A GitHub run stops after 6 hours, and 3.4 million emails is a lot of reading. So run
`emails` once per year, using the date boxes:

| Run | from_date | to_date |
|---|---|---|
| 1 | *(blank)* | `2023-12-31` |
| 2 | `2024-01-01` | `2024-12-31` |
| 3 | `2025-01-01` | `2025-12-31` |
| 4 | `2026-01-01` | *(blank)* |

Do the same for `calls`. Each year's files are named with their dates, so they never
overwrite each other.

---

## The files

Each run's files are under **Artifacts** at the bottom of the run, as one zip. **Download
it straight away — it's kept for one day only**, because this is your whole client database.

| File | What it is |
|---|---|
| `00-Dictionary.xlsx` | every field, every dropdown option, owners, users, pipelines, access check |
| `01-companies` … `08-leads` | the records, one file per type |
| `10-notes` … `15-communications` | the history |
| `20-Files.xlsx` | every file in HubSpot's file manager |
| `Manifest-<part>.xlsx` | what HubSpot said it held, against what was exported |

Big types run across several files — `14-emails-…-part1.xlsx`, `part2` and so on. Each
file holds up to a million rows, in sheets of half a million, so every one still opens in
Excel.

### Reading them

- **Row 1 is HubSpot's field names.** Every file ends with a *Columns* sheet giving each
  field's label and type.
- **`hubspot_id`** is the record's HubSpot ID. Keep it in the new CRM — it's how anything
  can be traced back.
- **`linked_contacts`, `linked_deals`…** list the IDs of linked records, separated by `; `.
  This is what lets the new CRM rebuild which email belongs to which client and which deal.
- **Dropdowns show what the team sees**, not what HubSpot stores. Age Range stores `46-50`
  for what everyone sees as **41-45**; exported raw, every age band would be wrong in the
  new CRM. The *Dropdown options* tab in the Dictionary reverses it if ever needed.
- **Owners are exported as their email**, and **pipelines and stages by name**, so the new
  CRM can match them.
- **Long text is split, never cut.** Excel holds 32,767 characters per cell, and a long email
  thread is more. So bodies run across `hs_email_text`, `hs_email_text__part2`, `__part3`…
  Join them in order to get the full text.
- **Dates are in UTC**, exactly as HubSpot stores them.
- **Email HTML is left out** — it doubles the size and the text has the content. Set
  `INCLUDE_EMAIL_HTML` to `true` in `config.js` if your developers want it.

---

## Proving it's complete

Every run writes a manifest with, for each type, **what HubSpot said it held** and **what
was exported**. They should match. A small difference on a type that's still in use means
records were added during the run; a large one means something went wrong — don't sign off
the migration until every manifest matches.

When the new CRM is loaded, compare its counts against these manifests. That's the proof
nothing was lost.

## What isn't in it

- **The attachment files themselves.** `20-Files.xlsx` lists every file, and notes and emails
  name their attachments by File ID, but the files aren't downloaded — that can be a lot of
  data. Ask if your developers need them.
- **Call recordings.** Calls carry the recording link, not the recording.
- **Workflows, sequences, templates, lists and reports.** These are HubSpot settings rather
  than data; they'll need rebuilding in the new CRM.
- **Deleted records** in HubSpot's recycle bin.

## Keeping it safe

This is the full record of every client HOF has dealt with — names, phone numbers, emails,
finances, immigration histories. So:

- the repo must stay **private**
- download each artifact as soon as the run ends, and **delete it** from GitHub
- keep the files somewhere access-controlled, such as a restricted company Drive folder —
  never email them, never put them in a shared or public folder
- once the new CRM is verified, delete working copies that are no longer needed

## Changing something

Settings are in `config.js`. `selftest.js` runs the whole export against a fake HubSpot
before every real run — conversions, splitting, links, ordering and Excel's limits —
`29 passed, 0 failed`.
