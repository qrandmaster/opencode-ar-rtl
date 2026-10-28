/*
 * check.mjs — فحص سريع لحالة التثبيت دون أي تعديل.
 * يطبع JSON: { appDir, exists, version, patched, error? }
 *
 * الاستخدام:
 *   node check.mjs "<مجلد التثبيت>"
 */
import fs from "node:fs";
import path from "node:path";
import { openAsar, readEntry, closeAsar } from "./asar.mjs";

// يجب أن تطابق العلامات في patch.mjs
const MARK_CSS = 'id="oc-ar-rtl-style"';
const MARK_JS = 'id="oc-ar-rtl-script"';

const appDir =
  process.argv[2] || process.env.LOCALAPPDATA + "\\Programs\\ai.opencode.desktop";
const asar = path.join(appDir, "resources", "app.asar");

const out = { appDir, exists: fs.existsSync(asar), version: null, patched: false };
if (out.exists) {
  let a = null;
  try {
    a = openAsar(asar);
    try {
      out.version = JSON.parse(readEntry(a, ["package.json"]).toString("utf8")).version || null;
    } catch {}
    const html = readEntry(a, ["out", "renderer", "index.html"]).toString("utf8");
    out.patched = html.includes(MARK_CSS) && html.includes(MARK_JS);
  } catch (e) {
    out.error = String((e && e.message) || e);
  } finally {
    try {
      closeAsar(a);
    } catch {}
  }
}
console.log(JSON.stringify(out));
