/*
 * patch.mjs — يبني نسخة معدّلة من app.asar لواجهة OpenCode Desktop.
 *
 * الاستخدام:
 *   node patch.mjs --app "<مجلد التثبيت>"            # بناء فقط إلى app.asar.new
 *   node patch.mjs --app "<مجلد التثبيت>" --apply    # بناء ثم تبديل فعلي
 *   node patch.mjs --app "<مجلد التثبيت>" --revert   # استرجاع النسخة الأصلية
 *   node patch.mjs --app "<مجلد التثبيت>" --status   # عرض الحالة
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { openAsar, closeAsar, getNode, readEntry, buildAsar, verifyAsar } from "./asar.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ASSETS = path.join(ROOT, "assets");
const I18N = path.join(ROOT, "i18n");
const STATE = path.join(ROOT, "state.json");

const MARK_CSS = 'id="oc-ar-rtl-style"';
const MARK_JS = 'id="oc-ar-rtl-script"';

/* ---------- مسار منتقي الملفات/المجلدات ---------- */
// المسار الافتراضي يُقرأ من config.json (خارج المستودع) أو من متغيّر البيئة
// OC_AR_DEFAULT_DIR، وإلا يبقى المنتقي على سلوك النظام.
const DEFAULT_DIR = String(
  (readJson(path.join(ROOT, "config.json"), {}) || {}).defaultDir || process.env.OC_AR_DEFAULT_DIR || ""
);
const DEFAULT_DIR_JS = JSON.stringify(DEFAULT_DIR);
if (DEFAULT_DIR && !fs.existsSync(DEFAULT_DIR)) {
  console.warn("تحذير: مجلد المنتقي الافتراضي غير موجود: " + DEFAULT_DIR);
}
const LAST_DIR =
  '(()=>{try{return localStorage.getItem("oc.lastDir")||' +
  DEFAULT_DIR_JS +
  "}catch(_){return " +
  DEFAULT_DIR_JS +
  "}})()";

const PICKER_PATCHES = [
  // ١) الطبقة الوسيطة كانت تُسقط defaultPath قبل تمريره للنافذة الأصلية
  [
    "openDirectoryPickerDialog:async t=>e.openDirectoryPicker({multiple:t?.multiple??!1,title:t?.title})",
    "openDirectoryPickerDialog:async t=>e.openDirectoryPicker({multiple:t?.multiple??!1,title:t?.title,defaultPath:t?.defaultPath||" +
      LAST_DIR +
      "})",
  ],
  // ٢) حفظ المجلد المختار ليصبح افتراضي المرة القادمة
  [
    "e.openDirectoryPickerDialog({title:n.title,multiple:n.multiple}).then(n.onSelect)",
    'e.openDirectoryPickerDialog({title:n.title,multiple:n.multiple}).then(t=>{try{let p=Array.isArray(t)?t[0]:t;p&&localStorage.setItem("oc.lastDir",p)}catch(_){}n.onSelect(t)})',
  ],
  // ٣) منتقي المرفقات: نفس الافتراضي عند غياب مسار الجلسة
  [
    "let i=await e.openFilePicker({multiple:t?.multiple??!1,title:t?.title,defaultPath:t?.defaultPath,extensions:t?.extensions})",
    "let i=await e.openFilePicker({multiple:t?.multiple??!1,title:t?.title,defaultPath:t?.defaultPath||" +
      LAST_DIR +
      ",extensions:t?.extensions})",
  ],
];

function findRendererEntry(a, needle, filter) {
  let hit = null;
  const walk = (node, prefix) => {
    for (const name of Object.keys(node.files || {})) {
      if (hit) return;
      const child = node.files[name];
      const p = prefix ? prefix + "/" + name : name;
      if (child.files) {
        walk(child, p);
      } else if (
        !child.unpacked &&
        p.startsWith("out/renderer/assets/") &&
        p.endsWith(".js") &&
        child.size < 4 * 1024 * 1024 &&
        (!filter || filter.test(p))
      ) {
        try {
          if (readEntry(a, p.split("/")).toString("latin1").includes(needle)) hit = p;
        } catch {}
      }
    }
  };
  walk(a.header, "");
  return hit;
}


function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const appDir = arg("app", process.env.LOCALAPPDATA + "\\Programs\\ai.opencode.desktop");
const asar = path.join(appDir, "resources", "app.asar");
const asarNew = path.join(appDir, "resources", "app.asar.new");

function fail(msg) {
  console.error("خطأ: " + msg);
  process.exit(1);
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

// بصمة مدخلات البناء: تغيّرها يعني أن الحزمة المثبّتة قديمة وتحتاج إعادة بناء
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

/* ---------- بناء مسبق وتبديل فوري ----------
 * بناء الأرشيف يستغرق نحو ثانية، والتطبيق قد يعيد فتح نفسه خلالها فيفشل التبديل.
 * لذلك نبني app.asar.new مسبقاً (لا يمسّ app.asar)، ثم نبدّله بمجرد تحرّر الملف:
 * عملية واحدة تستغرق أجزاء من الثانية.
 */
const META = asarNew + ".json";

function readMeta() {
  return readJson(META, null);
}

function newIsValid(version) {
  const m = readMeta();
  return !!m && m.version === version && m.assetsHash === assetsHash() && fs.existsSync(asarNew);
}

function swapIn(version, meta) {
  const swap = asar + ".swap";
  fs.renameSync(asar, swap);
  try {
    fs.renameSync(asarNew, asar);
  } catch (e) {
    fs.renameSync(swap, asar);
    throw e;
  }
  fs.unlinkSync(swap);
  try {
    fs.unlinkSync(META);
  } catch {}
  fs.writeFileSync(
    STATE,
    JSON.stringify(
      {
        installed: true,
        version,
        installedAt: new Date().toISOString(),
        backup: backupName(version),
        files: meta.files,
        bytes: meta.bytes,
        translations: meta.translations,
        assetsHash: assetsHash(),
      },
      null,
      2
    )
  );
}

function versionOf(header) {
  const node = getNode(header, ["package.json"]);
  if (!node) return "unknown";
  const a = { header, dataStart: 0 };
  return "unknown";
}

function realVersion(a) {
  try {
    return JSON.parse(readEntry(a, ["package.json"]).toString("utf8")).version || "unknown";
  } catch {
    return "unknown";
  }
}

function backupName(version) {
  return path.join(path.dirname(asar), `app.asar.orig-${version}`);
}

function status() {
  const st = readJson(STATE, null);
  const installed = fs.existsSync(asar) && fs.readFileSync(asar).subarray(0, 0).length === 0 ? false : null;
  let patched = false;
  if (fs.existsSync(asar)) {
    const a = openAsar(asar);
    try {
      const html = readEntry(a, ["out", "renderer", "index.html"]).toString("utf8");
      patched = html.includes(MARK_CSS) && html.includes(MARK_JS);
    } finally {
      closeAsar(a);
    }
  }
  console.log(JSON.stringify({ asar, exists: fs.existsSync(asar), patched, state: st }, null, 2));
}

function revert() {
  const st = readJson(STATE, null);
  const candidates = fs
    .readdirSync(path.dirname(asar))
    .filter((n) => n.startsWith("app.asar.orig-"))
    .sort();
  if (candidates.length === 0) fail("لا توجد نسخة أصلية محفوظة بجانب app.asar");
  const src = path.join(path.dirname(asar), candidates[candidates.length - 1]);
  const tmp = asar + ".restore";
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, asar);
  if (fs.existsSync(asarNew)) fs.unlinkSync(asarNew);
  fs.writeFileSync(STATE, JSON.stringify({ installed: false, revertedAt: new Date().toISOString(), version: st && st.version }, null, 2));
  console.log("تم استرجاع app.asar الأصلي من " + path.basename(src));
}

function build() {
  if (!fs.existsSync(asar)) fail("لم يُعثر على app.asar في " + path.dirname(asar));

  const a = openAsar(asar);
  const version = realVersion(a);
  let html = readEntry(a, ["out", "renderer", "index.html"]).toString("utf8");

  if (html.includes(MARK_CSS) || html.includes(MARK_JS)) {
    closeAsar(a);
    fail("الحزمة مثبّتة مسبقاً على هذا الإصدار. استخدم --revert قبل إعادة التثبيت.");
  }

  const css = fs.readFileSync(path.join(ASSETS, "ar-rtl.css"), "utf8");
  const js = fs.readFileSync(path.join(ASSETS, "ar-rtl.js"), "utf8");
  const extra = readJson(path.join(I18N, "ar-extra.json"), {});

  if (css.includes("</style")) fail("CSS يحوي </style");
  if (js.includes("</script")) fail("JS يحوي </script");

  const injection =
    "\n<style " + MARK_CSS + ">\n" + css + "\n</style>\n" +
    "<script " + MARK_JS + ">\n" + js + "\n</script>\n";

  if (!html.includes("</head>")) fail("index.html بلا </head>");
  html = html.replace("</head>", injection + "</head>");

  // دمج الترجمات الإضافية في قاموس العربية (اسم الملف يحوي hash يتغيّر)
  const dictPath = findRendererEntry(a, "desktop.dialog.chooseFolder", /^out\/renderer\/assets\/ar-[^/]+\.js$/);
  if (!dictPath) fail("لم يُعثر على قاموس العربية (out/renderer/assets/ar-*.js)");
  const dictParts = dictPath.split("/");
  const dict = readEntry(a, dictParts).toString("utf8");
  const keys = Object.keys(extra);
  if (keys.length === 0) fail("ملف الترجمات ar-extra.json فارغ");

  const at = dict.lastIndexOf("export{");
  if (at < 0) fail("تعذّر العثور على تصدير قاموس العربية");
  const exported = /export\{([A-Za-z_$][\w$]*)\s+as\s+dict\}/.exec(dict.slice(at));
  const dictVar = exported ? exported[1] : "e";
  const merged =
    dict.slice(0, at) + ";" + "Object.assign(" + dictVar + "," + JSON.stringify(extra) + ");\n" + dict.slice(at);

  // ٣) مسار افتراضي لمنتقيات الملفات/المجلدات
  //    التطبيق لا يمرّر defaultPath لمنتقي المجلدات، فيفتح على آخر مسار
  //    استخدمه النظام داخل العملية (مسار قديم). هنا نمرّره صريحاً:
  //    آخر مسار اختاره المستخدم، وإلا مجلد المشروع الثابت.
  let pickerEntry = null;
  let pickerBuf = null;
  const found = findRendererEntry(a, "openDirectoryPickerDialog:async");
  if (found) {
    let src = readEntry(a, found.split("/")).toString("utf8");
    const before = src;
    for (const [from, to] of PICKER_PATCHES) if (src.includes(from)) src = src.split(from).join(to);
    if (src !== before) {
      pickerEntry = found;
      pickerBuf = Buffer.from(src, "utf8");
      console.log("تعديل مسار المنتقي: " + found);
    } else {
      console.log("تحذير: تعذّرت مطابقة كود المنتقي — تُرك كما هو.");
    }
  } else {
    console.log("تحذير: لم يُعثر على ملف المنتقي داخل الحزمة — تُرك كما هو.");
  }


  closeAsar(a);

  const replace = new Map();
  replace.set("out/renderer/index.html", Buffer.from(html, "utf8"));
  replace.set(dictParts.join("/"), Buffer.from(merged, "utf8"));
  if (pickerBuf) replace.set(pickerEntry, pickerBuf);

  // تبديل فوري بلا إعادة بناء (يُستدعى لحظة تحرّر app.asar)
  if (arg("swap", false) === true) {
    if (!newIsValid(version)) {
      closeAsar(a);
      fail("لا يوجد app.asar.new صالح لهذا الإصدار — شغّل البناء المسبق أولاً");
    }
    const meta = readMeta();
    closeAsar(a);
    swapIn(version, meta);
    console.log("تم التبديل الفوري إلى الحزمة الجاهزة — الإصدار " + version);
    return;
  }

  console.log("بناء أرشيف جديد… (الإصدار " + version + ")");
  const started = Date.now();
  let meta = null;
  if (newIsValid(version)) {
    meta = readMeta();
    console.log("إعادة استخدام app.asar.new الجاهز (بصمة مطابقة)");
  } else {
    const info = buildAsar(asar, asarNew, { replace });
    const check = verifyAsar(asarNew);
    console.log(
      `تم البناء: ${check.files} ملفاً، ${(check.bytes / 1048576).toFixed(1)} م.ب، ` +
        `${((Date.now() - started) / 1000).toFixed(1)} ثانية`
    );

    // تحقق من المحتوى بعد البناء
    const v = openAsar(asarNew);
    const newHtml = readEntry(v, ["out", "renderer", "index.html"]).toString("utf8");
    const newDict = readEntry(v, dictParts).toString("utf8");
    const newPicker = pickerEntry ? readEntry(v, pickerEntry.split("/")).toString("utf8") : null;
    closeAsar(v);
    if (!newHtml.includes(MARK_CSS) || !newHtml.includes(MARK_JS)) fail("فشل الحقن في index.html");
    if (!newDict.includes("Object.assign(")) fail("فشل دمج الترجمات");
    if (pickerEntry && !newPicker.includes("oc.lastDir")) fail("فشل تعديل مسار المنتقي");

    meta = {
      version,
      assetsHash: assetsHash(),
      files: check.files,
      bytes: check.bytes,
      translations: keys.length,
    };
    fs.writeFileSync(META, JSON.stringify(meta, null, 2));
  }

  const backup = backupName(version);
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(asar, backup);
    console.log("نسخة أصلية: " + path.basename(backup));
  }

  if (arg("apply", false) !== true) {
    console.log("جاهز: " + path.basename(asarNew) + " (لم يُطبَّق — أضف --apply)");
    return;
  }

  swapIn(version, meta);
  console.log("تم التثبيت على الإصدار " + version);
}

if (arg("status", false) === true) status();
else if (arg("revert", false) === true) revert();
else build();
