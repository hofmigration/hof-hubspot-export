// xlsx.js — writing big Excel files without running out of memory.
//
// Rows are streamed straight to disk. Every SHEET_ROWS rows starts a new sheet and every
// BOOK_ROWS rows a new file, so no sheet ever reaches Excel's 1,048,576-row limit and
// each file still opens. Every file ends with a "Columns" sheet explaining each column.
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { SETTINGS } = require("./config");

class Book {
  constructor(dir, base, cols) {
    this.dir = dir; this.base = base; this.cols = cols;
    this.files = []; this.rows = 0; this.bookRows = 0; this.sheetRows = 0; this.sheets = 0;
    this.wb = null; this.ws = null;
    fs.mkdirSync(dir, { recursive: true });
  }
  _file() { return path.join(this.dir, `${this.base}-part${this.files.length}.xlsx`); }
  async _openBook() {
    if (this.wb) await this._closeBook();
    this.files.push(null);
    const file = this._file();
    this.files[this.files.length - 1] = file;
    this.wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: false, useSharedStrings: false });
    this.bookRows = 0; this.sheetNo = 0;
    await this._openSheet();
  }
  async _openSheet() {
    if (this.ws) await this.ws.commit();
    this.sheetNo++; this.sheets++; this.sheetRows = 0;
    this.ws = this.wb.addWorksheet(`Data ${this.sheetNo}`, { views: [{ state: "frozen", ySplit: 1 }] });
    this.ws.addRow(this.cols.map((c) => c.key)).commit();
  }
  async add(cells) {
    if (!this.wb || this.bookRows >= SETTINGS.BOOK_ROWS) await this._openBook();
    else if (this.sheetRows >= SETTINGS.SHEET_ROWS) await this._openSheet();
    // empty cells are left out entirely, which keeps 700-column contact files small
    this.ws.addRow(cells.map((v) => (v === "" ? null : v))).commit();
    this.rows++; this.bookRows++; this.sheetRows++;
  }
  async _closeBook() {
    if (this.ws) { await this.ws.commit(); this.ws = null; }
    const info = this.wb.addWorksheet("Columns");
    info.addRow(["Column", "HubSpot label", "Type"]).commit();
    for (const c of this.cols) info.addRow([c.key, c.label, c.type]).commit();
    await info.commit();
    await this.wb.commit();
    this.wb = null;
  }
  async close() {
    if (!this.wb && !this.files.length) await this._openBook();   // an empty export still gets a file with headers
    if (this.wb) await this._closeBook();
    return { rows: this.rows, files: this.files.map((f) => path.basename(f)), sheets: this.sheets };
  }
}

// a small workbook of several plain tables — the dictionary and the manifest
async function tables(file, sheets) {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: false, useSharedStrings: false });
  for (const [name, rows] of sheets) {
    const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
    for (const r of rows) ws.addRow(r).commit();
    await ws.commit();
  }
  await wb.commit();
}

module.exports = { Book, tables };
