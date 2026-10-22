import "server-only";
import { inflateRawSync } from "node:zlib";

/**
 * A spreadsheet's first sheet as a header row + data rows of text — .xlsx or
 * .csv. Small and dependency-free (an .xlsx is a zip of XML).
 */
export interface Sheet {
  headers: string[];
  rows: string[][];
}

export function readSheet(name: string, data: Buffer): Sheet {
  return /\.csv$/i.test(name) || !isZip(data) ? readCsv(data.toString("utf8")) : readXlsx(data);
}

const isZip = (b: Buffer) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;

function unzip(zip: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("Not a readable .xlsx file");
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = zip.readUInt16LE(eocd + 10); n > 0; n--) {
    const method = zip.readUInt16LE(p + 10), size = zip.readUInt32LE(p + 20), nameLen = zip.readUInt16LE(p + 28);
    const extra = zip.readUInt16LE(p + 30), comment = zip.readUInt16LE(p + 32), local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (/^xl\/(sharedStrings|workbook|worksheets\/sheet\d+)\.xml$|^xl\/_rels\/workbook\.xml\.rels$/.test(name)) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(start, start + size);
      out[name] = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
    }
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const colIndex = (col: string) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function readXlsx(data: Buffer): Sheet {
  const files = unzip(data);
  const shared = [...(files["xl/sharedStrings.xml"] ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  // the first sheet in the workbook's order
  const firstId = files["xl/workbook.xml"]?.match(/<sheet [^>]*r:id="([^"]+)"/)?.[1];
  const target = firstId && files["xl/_rels/workbook.xml.rels"]?.match(new RegExp(`Id="${firstId}"[^>]*Target="([^"]+)"`))?.[1];
  const sheetXml = (target && files[`xl/${target.replace(/^\/?xl\//, "")}`]) ?? files["xl/worksheets/sheet1.xml"];
  if (!sheetXml) throw new Error("The spreadsheet has no sheet");
  const grid: string[][] = [];
  for (const r of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = c[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[3]?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      if (v !== undefined) row[colIndex(c[1])] = /t="s"/.test(c[2]) ? shared[+v] : decode(v);
    }
    grid.push(Array.from(row, (v) => v ?? ""));
  }
  return toSheet(grid);
}

function readCsv(text: string): Sheet {
  const grid: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const sep = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); grid.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); grid.push(row); }
  return toSheet(grid);
}

function toSheet(grid: string[][]): Sheet {
  const rows = grid.filter((r) => r.some((v) => v.trim()));
  const headers = (rows.shift() ?? []).map((h) => h.replace(/^﻿/, "").trim());
  return { headers, rows };
}
