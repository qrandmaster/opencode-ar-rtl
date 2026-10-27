/* ==========================================================================
   opencode-ar-rtl — تهيئة العربية والاتجاه لواجهة OpenCode Desktop
   يعمل في سياق الـ renderer فقط، بلا صلاحيات ولا شبكة.
   ========================================================================== */
(function () {
  "use strict";

  var LANG_KEY = "opencode.global.dat:language";
  var MARK = "data-oc-ar-rtl";

  /* ---------------------------------------------------------------------
     1) اللغة الافتراضية: العربية
     لا نكتب فوق اختيار المستخدم — فقط عندما لا يوجد اختيار محفوظ.
     --------------------------------------------------------------------- */
  try {
    if (window.localStorage && localStorage.getItem(LANG_KEY) == null) {
      localStorage.setItem(LANG_KEY, JSON.stringify({ locale: "ar" }));
    }
  } catch (e) {
    /* التخزين معطّل — يتجاهل التطبيق القيمة ويعود للنظام */
  }

  function mark() {
    try {
      document.documentElement.setAttribute(MARK, "1");
    } catch (e) {}
  }

  /* ---------------------------------------------------------------------
     2) اتجاه الكتلة حسب لغة النص الغالبة
     السبب: unicode-bidi: plaintext يجعل السطر يبدأ من اليسار عندما يبدأ
     بإنجليزية، بينما تبقى النقطة/الرقم على اليمين — فتنفصل عن نصها.
     الحل: نضبط dir على العنصر نفسه؛ فيتبع الاتجاه النقطةُ والمحاذاةُ معاً.
     - عربية غالباً → rtl
     - بلا عربية      → ltr (تبقى علامات الترقيم في موضعها الصحيح)
     - داخل pre/code أو محرر النص: لا نتدخل
     --------------------------------------------------------------------- */
  var AR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;
  var LAT_RE = /[A-Za-z]/g;
  var BLOCK = {
    P: 1, LI: 1, DT: 1, DD: 1, BLOCKQUOTE: 1, FIGCAPTION: 1, SUMMARY: 1,
    UL: 1, OL: 1, TD: 1, TH: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1
  };
  var BLOCK_SEL = "p,li,dt,dd,blockquote,figcaption,summary,ul,ol,td,th,h1,h2,h3,h4,h5,h6";

  function hasArabic(text) {
    return !!text.match(AR_RE);
  }

  function closestList(el) {
    var p = el.parentElement;
    while (p && p.tagName !== "UL" && p.tagName !== "OL") p = p.parentElement;
    return p;
  }

  function dirFor(el) {
    if (el.closest && el.closest("pre, code, textarea, [contenteditable]")) return null;
    /* العناوين تتبع الواجهة العربية دائماً (حتى لو كانت إنجليزية) */
    if (el.tagName.charAt(0) === "H" && el.tagName.length === 2) return "rtl";

    var text = el.textContent || "";

    /* القائمة كلها وحدة واحدة: عنصرها الإنجليزي يبقى في جهة بقية العناصر.
       يصبح LTR فقط إذا كانت كل عناصر القائمة بلا عربية. */
    if (el.tagName === "UL" || el.tagName === "OL") {
      if (hasArabic(text)) return "rtl";
      return text.match(LAT_RE) ? "ltr" : null;
    }
    if (el.tagName === "LI") {
      var list = closestList(el);
      if (list && hasArabic(list.textContent || "")) return "rtl";
      /* قائمة إنجليزية بالكامل: يتبع العنصر محتواه */
      return text.match(LAT_RE) ? "ltr" : null;
    }

    if (!hasArabic(text)) return text.match(LAT_RE) ? "ltr" : null;
    /* وجود أي عربية يجعل الكتلة RTL — الإنجليزية في وسط الجملة لا تقلبها */
    return "rtl";
  }

  function applyDir(el) {
    var d = dirFor(el);
    if (d && el.getAttribute("dir") !== d) el.setAttribute("dir", d);
  }

  function closestBlock(node) {
    var el = node && node.nodeType === 1 ? node : node ? node.parentElement : null;
    while (el && el !== document.body) {
      if (BLOCK[el.tagName]) return el;
      el = el.parentElement;
    }
    return null;
  }

  /* ---------------------------------------------------------------------
     3) معالجة النص داخل الكتل العربية (نصًّا فقط، بلا تغليف عناصر DOM
     حتى لا نُفسد تحديثات الإطار أثناء البث):
     أ) عزل الأقواس الإنجليزية الملتصقة بكلمة لاتينية بـ FSI/PDI
        سبب: "(2.58 GB)" بعد "D" يُحسب امتدادًا لنفس السلسلة اللاتينية،
        فيُدفع الاثنان إلى الطرف الأيسر بدل أن يبقى القوس ملاصقًا للكلمة.
     ب) قلب الأسهم التي تشير عكس اتجاه القراءة (‎→‎ تصبح ‎←‎)
        سبب: U+2192 غير قابل للانعكاس في Unicode، فيبقى شكله إلى اليمين
        بينما القراءة العربية تسير إلى اليسار.
     --------------------------------------------------------------------- */
  var FSI = "\u2068";
  var PDI = "\u2069";
  var AR_ONE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  var LAT_ONE = /[A-Za-z]/;
  var ARROW_MAP = {
    "\u2192": "\u2190",
    "\u21D2": "\u21D0",
    "\u27F6": "\u27F5"
  };
  var ARROW_RE = /[\u2192\u21D2\u27F6]/;

  function afterLatin(text, openIndex) {
    var k = openIndex - 1;
    while (k >= 0 && (text.charAt(k) === " " || text.charAt(k) === "\u00A0")) k--;
    if (k < 0) return false;
    return /[A-Za-z0-9]/.test(text.charAt(k));
  }

  /* أقوى حرف في جهة معيّنة: true = لاتيني، false = عربي، null = لا شيء */
  function strongSideIsLatin(text, from, step) {
    for (var k = from + step; k >= 0 && k < text.length; k += step) {
      var ch = text.charAt(k);
      if (LAT_ONE.test(ch)) return true;
      if (AR_ONE.test(ch)) return false;
    }
    return null;
  }

  function isolateParensIn(text) {
    if (text.indexOf("(") < 0) return text;
    var out = "", last = 0, changed = false;
    var i = text.indexOf("(");
    while (i >= 0) {
      if (i > 0 && text.charAt(i - 1) === FSI) { i = text.indexOf("(", i + 1); continue; }
      var close = text.indexOf(")", i + 1);
      if (close < 0) break;
      var inner = text.slice(i + 1, close);
      if (inner.indexOf("(") >= 0 || AR_ONE.test(inner) || !afterLatin(text, i)) {
        i = text.indexOf("(", close + 1);
        continue;
      }
      out += text.slice(last, i) + FSI + text.slice(i, close + 1) + PDI;
      last = close + 1;
      changed = true;
      i = text.indexOf("(", last);
    }
    if (!changed) return text;
    return out + text.slice(last);
  }

  function flipArrowsIn(text) {
    if (!ARROW_RE.test(text)) return text;
    var out = "";
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      var target = ARROW_MAP[ch];
      if (!target) { out += ch; continue; }
      /* السهم بين كلمتين لاتينيتين يخصّ سلسلة LTR فلا نقلبه */
      var left = strongSideIsLatin(text, i, -1);
      var right = strongSideIsLatin(text, i, 1);
      out += (left === true && right === true) ? ch : target;
    }
    return out;
  }

  /* القلب في اتجاه واحد فقط: "→" تصبح "←". أما "←" المكتوبة أصلًا
     فتبقى كما هي، فلا يتكرر القلب ولا يحدث تبادل مع MutationObserver. */
  function fixTextNode(node) {
    var text = node.nodeValue;
    if (!text) return false;
    var out = flipArrowsIn(isolateParensIn(text));
    if (out === text) return false;
    node.nodeValue = out;
    return true;
  }

  var TEXT_SKIP = "pre, code, textarea, [contenteditable], script, style, noscript, template";

  function processText(root) {
    if (!root || !root.querySelectorAll) return;
    if (typeof document.createTreeWalker !== "function") return;
    var walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */, null, false);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var parent = node.parentElement;
      if (!parent) continue;
      if (!parent.closest('[dir="rtl"]')) continue;
      if (parent.closest(TEXT_SKIP)) continue;
      fixTextNode(node);
    }
  }

  /* ---------------------------------------------------------------------
     4) ضبط العناصر التي لا يكفيها CSS
     - pre: اتجاه LTR صريح ليقرأه محرر الشيفرة والمحوّل النحوي
     - textarea / contenteditable: dir=auto ليتبع لغة الكتابة نفسها
     --------------------------------------------------------------------- */
  function fixElement(el) {
    if (!el || el.nodeType !== 1) return;

    var tag = el.tagName;
    if (tag === "PRE") {
      if (el.getAttribute("dir") !== "ltr") el.setAttribute("dir", "ltr");
      return;
    }

    if (tag === "TEXTAREA" || el.isContentEditable) {
      if (!el.hasAttribute("dir")) el.setAttribute("dir", "auto");
      return;
    }

    if (BLOCK[tag]) applyDir(el);

    if (el.querySelectorAll) {
      var blocks = el.querySelectorAll(BLOCK_SEL);
      for (var b = 0; b < blocks.length; b++) applyDir(blocks[b]);

      var pres = el.getElementsByTagName("pre");
      for (var i = 0; i < pres.length; i++) {
        if (pres[i].getAttribute("dir") !== "ltr") pres[i].setAttribute("dir", "ltr");
      }
      var areas = el.querySelectorAll("textarea, [contenteditable]");
      for (var j = 0; j < areas.length; j++) {
        if (!areas[j].hasAttribute("dir")) areas[j].setAttribute("dir", "auto");
      }
    }

    processText(el);
  }

  var queued = false;
  var pending = [];

  function flush() {
    queued = false;
    var list = pending;
    pending = [];
    for (var i = 0; i < list.length; i++) {
      try {
        fixElement(list[i]);
      } catch (e) {}
    }
  }

  function schedule(node) {
    pending.push(node);
    if (queued) return;
    queued = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
    else setTimeout(flush, 16);
  }

  function boot() {
    mark();
    fixElement(document.body);

    if (typeof MutationObserver !== "function") return;
    var observer = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];

        /* نصّ يتغيّر أثناء البث: أعد تقييم الكتلة التي يحويها */
        if (rec.type === "characterData") {
          var block = closestBlock(rec.target.parentElement);
          if (block) schedule(block);
          continue;
        }

        var added = rec.addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType === 1) schedule(node);
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
