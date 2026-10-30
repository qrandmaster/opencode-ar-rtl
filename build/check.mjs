/*
 * check.mjs — فحص سريع لحالة التثبيت دون أي تعديل.
 * يطبع JSON: { appDir, exists, version, patched, stale, error? }
 *
 * stale=true يعني أن ملفات التعريب تغيّرت بعد آخر بناء (أو أن البصمة غائبة).
 *
 * الاستخدام:
 *   node check.mjs "<مجلد التثبيت>"
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { openAsar, readEntry, closeAsar } from "./asar.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const STATE = path.join(ROOT, "state.json");

// يجب أن تطابق العلامات في patch.mjs
const MARK_CSS = 'id="oc-ar-rtl-style"';
const MARK_JS = 'id="oc-ar-rtl-script"';

function assetsHash() {
  const h = crypto.createHash("sha256");
  for (const rel of ["assets/ar-rtl.js", "assets/ar-rtl.css", "i18n/ar-extra.json", "build/patch.mjs"]) {
    try {
      h.update(fs.readFileSync(path.join(ROOT, rel)));
    } catch {
      h.update("missing:" + rel);
    }
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

const appDir =
  process.argv[2] || path.join(process.env.LOCALAPPDATA, "Programs", "ai.opencode.desktop");
const asar = path.join(appDir, "resources", "app.asar");

const out = { appDir, exists: fs.existsSync(asar), version: null, patched: false, stale: false };
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

let state = null;
try {
  state = JSON.parse(fs.readFileSync(STATE, "utf8"));
} catch {}
if (out.patched) {
  out.stale = !state || state.assetsHash !== assetsHash();
  if (out.stale) out.reason = state && state.assetsHash ? "تغيّرت ملفات التعريب بعد آخر بناء" : "لا بصمة محفوظة للحزمة المثبّتة";
}
console.log(JSON.stringify(out));
