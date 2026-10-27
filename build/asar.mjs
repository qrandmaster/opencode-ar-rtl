/*
 * asar.mjs — قراءة وكتابة أرشيف app.asar دون أي حزم خارجية.
 *
 * صيغة ASAR:
 *   UInt32  4              (حجم الحقل التالي)
 *   UInt32  headerSize     = 8 + حجم الـ JSON بعد المحاذاة
 *   UInt32  payloadSize    = headerSize - 4
 *   UInt32  jsonSize       = طول JSON الفعلي
 *   bytes   json           ثم حشو أصفار حتى مضاعف 4
 *   bytes   data...        تبدأ عند 8 + headerSize، والإزاحات نسبية إليها
 */
import fs from "node:fs";
import crypto from "node:crypto";

const BLOCK = 4 * 1024 * 1024;

export function openAsar(file) {
  const fd = fs.openSync(file, "r");
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(4);
  const jsonSize = head.readUInt32LE(12);
  if (headerSize < 16 || jsonSize <= 0 || jsonSize > headerSize) {
    fs.closeSync(fd);
    throw new Error("ليس أرشيف ASAR صالحاً: " + file);
  }
  const json = Buffer.alloc(jsonSize);
  fs.readSync(fd, json, 0, jsonSize, 16);
  const header = JSON.parse(json.toString("utf8"));
  return { fd, header, jsonSize, headerSize, dataStart: 8 + headerSize };
}

export function closeAsar(a) {
  try {
    fs.closeSync(a.fd);
  } catch {}
}

export function getNode(header, parts) {
  let node = header;
  for (const part of parts) {
    if (!node.files || !node.files[part]) return undefined;
    node = node.files[part];
  }
  return node;
}

export function readEntry(a, parts) {
  const node = getNode(a.header, parts);
  if (!node) throw new Error("غير موجود في الأرشيف: " + parts.join("/"));
  if (node.files) throw new Error("مسار مجلد لا ملف: " + parts.join("/"));
  if (node.unpacked) throw new Error("ملف مفكوك خارج الأرشيف: " + parts.join("/"));
  const buf = Buffer.alloc(node.size);
  if (node.size) fs.readSync(a.fd, buf, 0, node.size, a.dataStart + Number(node.offset));
  return buf;
}

function integrity(buf) {
  const blocks = [];
  for (let i = 0; i < buf.length; i += BLOCK) {
    blocks.push(crypto.createHash("sha256").update(buf.subarray(i, i + BLOCK)).digest("hex"));
  }
  if (blocks.length === 0) blocks.push(crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
  return { algorithm: "SHA256", hash: blocks[0], blockSize: BLOCK, blocks };
}

function clone(node) {
  return JSON.parse(JSON.stringify(node));
}

function ensureDir(header, parts) {
  let node = header;
  for (const part of parts) {
    if (!node.files) node.files = {};
    if (!node.files[part]) node.files[part] = { files: {} };
    node = node.files[part];
  }
  return node;
}

function collect(header) {
  const out = [];
  (function walk(node, prefix) {
    for (const name of Object.keys(node.files || {})) {
      const full = prefix ? prefix + "/" + name : name;
      const child = node.files[name];
      if (child.files) walk(child, full);
      else out.push({ path: full, node: child });
    }
  })(header, "");
  return out;
}

/**
 * يبني أرشيفاً جديداً.
 * @param {string} source ملف asar الأصلي
 * @param {string} target ملف الإخراج
 * @param {{replace?: Map<string, Buffer>, add?: Map<string, Buffer>, remove?: Set<string>}} ops
 */
export function buildAsar(source, target, ops = {}) {
  const replace = ops.replace || new Map();
  const add = ops.add || new Map();
  const remove = ops.remove || new Set();

  const a = openAsar(source);
  const header = clone(a.header);

  // الحذف
  for (const p of remove) {
    const parts = p.split("/");
    const leaf = parts.pop();
    const dir = getNode(header, parts);
    if (dir && dir.files) delete dir.files[leaf];
  }

  // الإضافة
  for (const [p, buf] of add) {
    const parts = p.split("/");
    const leaf = parts.pop();
    const dir = ensureDir(header, parts);
    dir.files[leaf] = { size: buf.length, integrity: integrity(buf) };
  }

  // الاستبدال
  for (const [p, buf] of replace) {
    const parts = p.split("/");
    const leaf = parts.pop();
    const dir = getNode(header, parts);
    if (!dir || !dir.files || !dir.files[leaf]) throw new Error("لا يمكن استبدال ملف غير موجود: " + p);
    dir.files[leaf] = { size: buf.length, integrity: integrity(buf) };
  }

  // ترتيب المحتوى: نحافظ على ترتيب الأرشيف الأصلي، والجديد يُلحق بالنهاية
  const entries = collect(header);
  const originalOrder = new Map(collect(a.header).map((e, i) => [e.path, i]));
  entries.sort((x, y) => {
    const ox = originalOrder.has(x.path) ? originalOrder.get(x.path) : Number.MAX_SAFE_INTEGER;
    const oy = originalOrder.has(y.path) ? originalOrder.get(y.path) : Number.MAX_SAFE_INTEGER;
    return ox - oy;
  });

  let offset = 0;
  const plan = [];
  for (const e of entries) {
    if (e.node.unpacked || e.node.link) {
      plan.push({ path: e.path, node: e.node, skip: true, srcOffset: undefined });
      continue;
    }
    const srcOffset = e.node.offset === undefined ? undefined : Number(e.node.offset);
    e.node.offset = String(offset);
    offset += e.node.size;
    plan.push({ path: e.path, node: e.node, skip: false, srcOffset });
  }

  const json = Buffer.from(JSON.stringify(header), "utf8");
  const padded = Math.ceil(json.length / 4) * 4;
  const headerSize = padded + 8;
  const dataStart = 16 + padded;

  const fdOut = fs.openSync(target, "w");
  const pre = Buffer.alloc(16);
  pre.writeUInt32LE(4, 0);
  pre.writeUInt32LE(headerSize, 4);
  pre.writeUInt32LE(padded + 4, 8);
  pre.writeUInt32LE(json.length, 12);
  fs.writeSync(fdOut, pre, 0, 16, 0);
  fs.writeSync(fdOut, json, 0, json.length, 16);
  if (padded > json.length) fs.writeSync(fdOut, Buffer.alloc(padded - json.length), 0, padded - json.length, 16 + json.length);

  const chunk = Buffer.alloc(4 * 1024 * 1024);
  let written = 0;
  for (const item of plan) {
    if (item.skip) continue;
    const size = item.node.size;
    const pos = dataStart + Number(item.node.offset);
    if (replace.has(item.path)) {
      fs.writeSync(fdOut, replace.get(item.path), 0, size, pos);
    } else if (add.has(item.path)) {
      fs.writeSync(fdOut, add.get(item.path), 0, size, pos);
    } else {
      let remaining = size;
      let srcPos = a.dataStart + item.srcOffset;
      let dstPos = pos;
      while (remaining > 0) {
        const n = Math.min(chunk.length, remaining);
        fs.readSync(a.fd, chunk, 0, n, srcPos);
        fs.writeSync(fdOut, chunk, 0, n, dstPos);
        srcPos += n;
        dstPos += n;
        remaining -= n;
      }
    }
    written += size;
  }

  fs.fsyncSync(fdOut);
  fs.closeSync(fdOut);
  closeAsar(a);

  return { files: plan.length, bytes: written, headerSize, dataStart };
}

/** فحص بنيوي: كل ملف في الفهرس موجود فعلياً بالحجم الصحيح. */
export function verifyAsar(file) {
  const a = openAsar(file);
  const entries = collect(a.header);
  let bytes = 0;
  for (const e of entries) {
    if (e.node.unpacked || e.node.link) continue;
    if (e.node.offset === undefined) throw new Error("ملف بلا إزاحة: " + e.path);
    bytes += e.node.size;
  }
  const expected = a.dataStart + bytes;
  const actual = fs.statSync(file).size;
  closeAsar(a);
  if (actual !== expected) throw new Error(`حجم الأرشيف غير متوقع: ${actual} != ${expected}`);
  return { files: entries.length, bytes };
}
