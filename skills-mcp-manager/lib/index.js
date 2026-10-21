// src/index.ts
import z from "@deepseek-ai/schemastery";
import { homedir as homedir2 } from "node:os";
import { join as join4, dirname as dirname3, isAbsolute as isAbsolute5 } from "node:path";

// src/skills.ts
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isMap, isScalar, parseDocument } from "yaml";
var queues = /* @__PURE__ */ new Map();
var MAX_FILE = 8 * 1024 * 1024;
var MAX_TOTAL = 64 * 1024 * 1024;
var hash = (value) => createHash("sha256").update(value).digest("hex");
var inside = (root, path) => {
  const r = relative(root, path);
  return r === "" || !r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r);
};
function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}
function missing(e) {
  return e.code === "ENOENT";
}
async function exists(path) {
  try {
    await fs.lstat(path);
    return true;
  } catch (e) {
    if (missing(e)) return false;
    throw e;
  }
}
async function links(path) {
  let current = resolve(path);
  for (; ; ) {
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) return true;
    } catch (e) {
      if (!missing(e)) throw e;
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
async function regularRead(path) {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat2 = await handle.stat();
    if (!stat2.isFile() || stat2.size > MAX_FILE) fail("UNSAFE_FILE", "Expected a regular file of at most 8 MiB");
    const data = await handle.readFile();
    if (data.length > MAX_FILE) fail("UNSAFE_FILE", "File grew beyond the size limit");
    return data;
  } finally {
    await handle.close();
  }
}
async function exclusiveWrite(path, bytes, mode) {
  const handle = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(mode);
  } finally {
    await handle.close();
  }
}
function documentText(bytes) {
  const raw = bytes.toString("utf8");
  if (!Buffer.from(raw, "utf8").equals(bytes)) fail("INVALID_SKILL", "Skill document must be valid UTF-8");
  return raw;
}
function frontmatter(raw) {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(raw);
  if (!opening) fail("INVALID_SKILL", "Skill must start with YAML frontmatter");
  const rest = raw.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (!closing) fail("INVALID_SKILL", "Missing frontmatter closing delimiter");
  const start = opening[0].length;
  const end = start + closing.index;
  const doc = parseDocument(raw.slice(start, end), { keepSourceTokens: true, uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents)) fail("INVALID_SKILL", "Malformed YAML frontmatter");
  let data;
  try {
    data = doc.toJS({ maxAliasCount: 50 });
  } catch {
    fail("INVALID_SKILL", "Unsafe or unresolved YAML aliases");
  }
  if (typeof data.name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name) || typeof data.description !== "string" || !data.description.trim()) fail("INVALID_SKILL", "Skill requires a lowercase kebab-case name and description");
  return { doc, data, start, end, body: raw.slice(end + closing[0].length), eol: opening[0].endsWith("\r\n") ? "\r\n" : "\n" };
}
function invocationBool(value, fallback) {
  if (value === void 0) return fallback;
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  if (typeof value === "string") {
    if (/^(true|yes|on|1)$/i.test(value)) return true;
    if (/^(false|no|off|0)$/i.test(value)) return false;
  }
  fail("INVALID_SKILL", "Invocation flags must be booleans, 0/1, or recognized boolean strings");
}
function parse(raw) {
  const fm = frontmatter(raw);
  const disabled = invocationBool(fm.data["disable-model-invocation"], false);
  const user = invocationBool(fm.data["user-invocable"], true);
  return { name: fm.data.name, description: fm.data.description, whenToUse: typeof fm.data.whenToUse === "string" ? fm.data.whenToUse : "", enabled: !disabled || user, content: fm.body };
}
function invocation(raw, enabled) {
  const fm = frontmatter(raw);
  const replacements = [];
  const additions = [];
  for (const [key, value] of [["disable-model-invocation", !enabled], ["user-invocable", enabled]]) {
    const node = fm.doc.get(key, true);
    if (node === void 0) {
      additions.push(`${key}: ${value}${fm.eol}`);
      continue;
    }
    if (!isScalar(node) || !node.range) fail("UNSAFE_YAML", "Invocation flags must be scalar values, not aliases or collections");
    replacements.push({ start: fm.start + node.range[0], end: fm.start + node.range[1], text: String(value) });
  }
  if (additions.length) replacements.push({ start: fm.end, end: fm.end, text: additions.join("") });
  for (const edit of replacements.sort((a, b) => b.start - a.start)) raw = raw.slice(0, edit.start) + edit.text + raw.slice(edit.end);
  frontmatter(raw);
  return raw;
}
var SkillsManager = class {
  options;
  grants = /* @__PURE__ */ new Map();
  constructor(options) {
    this.options = { ...options, stateDir: resolve(options.stateDir), dshHome: resolve(options.dshHome), agentsHome: resolve(options.agentsHome) };
  }
  ordered(fn) {
    const key = this.options.stateDir;
    const task = (queues.get(key) ?? Promise.resolve()).catch(() => void 0).then(fn);
    const tail = task.catch(() => void 0);
    queues.set(key, tail);
    void tail.finally(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return task;
  }
  async roots(cwd) {
    const roots = [];
    if (cwd !== void 0) {
      if (!isAbsolute(cwd)) fail("INVALID_WORKSPACE", "Workspace must be an absolute registered path");
      const selected = resolve(cwd);
      if (!this.options.workspacePaths().some((path) => resolve(path) === selected)) fail("INVALID_WORKSPACE", "Workspace is not registered");
      if (!(await fs.stat(selected)).isDirectory()) fail("INVALID_WORKSPACE", "Workspace is not a directory");
      roots.push({ path: join(selected, ".dsh", "skills"), source: "project-dsh" }, { path: join(selected, ".agents", "skills"), source: "project-agents" });
    }
    roots.push({ path: join(this.options.dshHome, "skills"), source: "user-dsh" }, { path: join(this.options.agentsHome, "skills"), source: "user-agents" });
    return roots;
  }
  async snapshot(root, target, kind, capture = false) {
    if (!inside(root, target) || target === root) fail("UNSAFE_PATH", "Target is outside its authorized root");
    const realRoot = await fs.realpath(root);
    const realTarget = await fs.realpath(target);
    if (!inside(realRoot, realTarget) || realTarget === realRoot) fail("UNSAFE_PATH", "Symlink escapes the authorized root");
    let linked = await links(target);
    let total = 0;
    let count2 = 0;
    const records = [];
    const files = [];
    const directories = [];
    let raw = "";
    const skillFile = kind === "bundle" ? join(target, "SKILL.md") : target;
    const walk = async (path) => {
      if (++count2 > 4096) fail("UNSAFE_FILE", "Skill contains too many entries");
      const realPath = await fs.realpath(path);
      if (!inside(realRoot, realPath)) fail("UNSAFE_PATH", "Path escaped its authorized root during scanning");
      const stat2 = await fs.lstat(path);
      if (stat2.isSymbolicLink()) {
        linked = true;
        const real = await fs.realpath(path);
        if (!inside(realRoot, real)) fail("UNSAFE_PATH", "Symlink escapes the authorized root");
        const targetStat = await fs.stat(path);
        if (targetStat.isDirectory()) {
          records.push(`${relative(target, path)}\0linkdir\0${await fs.readlink(path)}`);
          if (path === target) for (const name2 of (await fs.readdir(path)).sort()) await walk(join(path, name2));
        } else if (targetStat.isFile()) {
          const bytes = await regularRead(real);
          total += bytes.length;
          records.push(`${relative(target, path)}\0link\0${await fs.readlink(path)}\0${hash(bytes)}`);
          if (path === skillFile) raw = documentText(bytes);
        } else fail("UNSAFE_FILE", "Linked special filesystem objects cannot be managed");
      } else if (stat2.isDirectory()) {
        records.push(`${relative(target, path)}\0dir`);
        directories.push(relative(target, path));
        for (const name2 of (await fs.readdir(path)).sort()) await walk(join(path, name2));
      } else if (stat2.isFile()) {
        const bytes = await regularRead(path);
        total += bytes.length;
        const mode = 384 | stat2.mode & 73;
        records.push(`${relative(target, path)}\0file\0${mode}\0${hash(bytes)}`);
        if (capture) files.push({ path: relative(target, path), bytes, mode });
        if (path === skillFile) raw = documentText(bytes);
      } else fail("UNSAFE_FILE", "Special filesystem objects cannot be managed");
      if (total > MAX_TOTAL) fail("UNSAFE_FILE", "Skill exceeds the 64 MiB size limit");
    };
    await walk(target);
    if (!raw) fail("INVALID_SKILL", "Missing skill document");
    parse(raw);
    return { revision: hash(records.join("\n")), raw, linked, files, directories };
  }
  /** An explicitly linked skill is readable even outside the managed root.
   * Only its instruction file is opened; linked resources are not traversed.
   * This snapshot is never eligible for mutation or import.
   */
  async linkedSnapshot(root, target, kind) {
    if (dirname(target) !== root || !inside(root, target) || target === root) fail("UNSAFE_PATH", "Linked skill must be a direct entry of an authorized root");
    const instruction = kind === "bundle" ? join(target, "SKILL.md") : target;
    const realTarget = await fs.realpath(target);
    const realInstruction = await fs.realpath(instruction);
    const bytes = await regularRead(realInstruction);
    if (await fs.realpath(target) !== realTarget || await fs.realpath(instruction) !== realInstruction) fail("UNSAFE_PATH", "Linked skill changed while reading");
    const raw = documentText(bytes);
    parse(raw);
    return { revision: hash(`linked\0${kind}\0${realTarget}\0${realInstruction}\0${hash(bytes)}`), raw, linked: true, files: [], directories: [] };
  }
  async discover(cwd) {
    const result = [];
    const seen = /* @__PURE__ */ new Set();
    for (const root of await this.roots(cwd)) {
      let names;
      try {
        names = await fs.readdir(root.path);
      } catch (e) {
        if (missing(e)) continue;
        throw e;
      }
      for (const name2 of names.sort()) {
        if (name2.startsWith(".")) continue;
        const target = join(root.path, name2);
        let linked = false;
        try {
          linked = await links(target);
          const stat2 = await fs.stat(target);
          const kind = stat2.isDirectory() ? "bundle" : stat2.isFile() && name2.endsWith(".md") ? "file" : void 0;
          if (!kind) continue;
          const path = kind === "bundle" ? join(target, "SKILL.md") : target;
          linked = linked || await links(path);
          const snapshot = linked ? await this.linkedSnapshot(root.path, target, kind) : await this.snapshot(root.path, target, kind);
          if (seen.has(path)) continue;
          seen.add(path);
          const { content: _content, ...parsed } = parse(snapshot.raw);
          const id = hash(`${root.source}\0${root.path}\0${name2}`);
          result.push({ summary: { ...parsed, id, revision: snapshot.revision, source: root.source, level: root.source.startsWith("project-") ? "project" : "user", kind, path, writable: !snapshot.linked, ...snapshot.linked ? { readOnlyReason: "Symlinked paths are read-only" } : {} }, root, target, snapshot });
        } catch (e) {
          const code = e.code;
          if (linked && ["EACCES", "EPERM", "ENOTDIR"].includes(code ?? "")) continue;
          if (!["ENOENT", "ELOOP", "UNSAFE_PATH", "UNSAFE_FILE", "INVALID_SKILL", "UNSAFE_YAML"].includes(code ?? "")) throw e;
        }
      }
    }
    return result.sort((a, b) => a.summary.level === b.summary.level ? a.summary.name.localeCompare(b.summary.name) : a.summary.level === "project" ? -1 : 1);
  }
  async find(id, cwd) {
    if (!/^[a-f0-9]{64}$/.test(id)) fail("NOT_FOUND", "Unknown skill ID");
    const found = (await this.discover(cwd)).find((item) => item.summary.id === id);
    if (!found) fail("NOT_FOUND", "Skill is no longer present in an authorized root");
    return found;
  }
  async checked(found, revision2) {
    if (!found.summary.writable) fail("READ_ONLY", "Symlinked skills are read-only");
    const next = await this.snapshot(found.root.path, found.target, found.summary.kind);
    if (next.linked) fail("READ_ONLY", "Symlinked skills are read-only");
    if (next.revision !== revision2) fail("REVISION_CONFLICT", "Skill changed; refresh before retrying");
    return next;
  }
  listSkills(cwd) {
    return this.ordered(async () => (await this.discover(cwd)).map((item) => item.summary));
  }
  readSkill(id, cwd) {
    return this.ordered(async () => {
      const found = await this.find(id, cwd);
      return { ...found.summary, content: parse(found.snapshot.raw).content };
    });
  }
  statePath() {
    return join(this.options.stateDir, "skills-state.json");
  }
  async loadState() {
    try {
      if (await links(this.options.stateDir) || await links(this.statePath())) fail("UNSAFE_STATE", "State paths must not contain symlinks");
      const bytes = await regularRead(this.statePath());
      const state = JSON.parse(bytes.toString("utf8"));
      if (state.version !== 1 || !state.backups || typeof state.backups !== "object" || Array.isArray(state.backups) || !Array.isArray(state.trash)) throw new Error("invalid shape");
      for (const backup of Object.values(state.backups)) if (!backup || typeof backup.original !== "string" || typeof backup.disabled !== "string") throw new Error("invalid backup");
      for (const item of state.trash) {
        if (!item || !/^[a-f0-9-]{36}$/.test(item.id) || item.payload !== join(this.options.stateDir, "trash", item.id) || !item.root || !isAbsolute(item.root.path) || !inside(item.root.path, item.target) || item.target === item.root.path || dirname(item.target) !== item.root.path || !["bundle", "file"].includes(item.kind) || typeof item.revision !== "string" || item.originalPath !== item.target) throw new Error("invalid trash entry");
      }
      return { state, revision: hash(bytes) };
    } catch (e) {
      if (missing(e)) return { state: { version: 1, backups: {}, trash: [] }, revision: null };
      if (e.code === "UNSAFE_STATE") throw e;
      fail("CORRUPT_STATE", "Skills state is corrupt; refusing to write");
    }
  }
  async saveState(state, revision2) {
    const current = await this.loadState();
    if (current.revision !== revision2) fail("REVISION_CONFLICT", "Skills state changed in another process");
    const path = this.statePath();
    const temp = join(this.options.stateDir, `.state-${randomUUID()}`);
    const raw = JSON.stringify(state);
    if (Buffer.byteLength(raw) > MAX_FILE) fail("STATE_LIMIT", "Skills state exceeds the safe size limit; no files were changed");
    const handle = await fs.open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 384);
    try {
      await handle.writeFile(raw);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      if ((await this.loadState()).revision !== revision2 || await links(this.options.stateDir)) fail("REVISION_CONFLICT", "Skills state changed before commit");
      await fs.rename(temp, path);
    } finally {
      if (await exists(temp)) await fs.unlink(temp);
    }
    return hash(raw);
  }
  async mutation(fn) {
    return this.ordered(async () => {
      if (await links(this.options.stateDir)) fail("UNSAFE_STATE", "State paths must not contain symlinks");
      await fs.mkdir(this.options.stateDir, { recursive: true, mode: 448 });
      if (await links(this.options.stateDir)) fail("UNSAFE_STATE", "State directory changed");
      const lockPath = join(this.options.stateDir, ".skills.lock");
      let lock;
      try {
        lock = await fs.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 384);
      } catch (e) {
        if (e.code === "EEXIST") fail("BUSY", "Another Skills operation is active; retry after it finishes (stale locks require manual review)");
        throw e;
      }
      try {
        await lock.writeFile(String(process.pid));
        const { state, revision: revision2 } = await this.loadState();
        return await fn(state, revision2);
      } finally {
        await lock.close();
        await fs.unlink(lockPath);
      }
    });
  }
  setSkillEnabled(id, enabled, revision2, cwd) {
    return this.mutation(async (state, stateRevision) => {
      const found = await this.find(id, cwd);
      const current = await this.checked(found, revision2);
      const backup = state.backups[id];
      let next;
      if (enabled && backup) {
        if (hash(current.raw) !== backup.disabled && current.raw !== backup.original) fail("BACKUP_CONFLICT", "Disabled skill was edited; refusing to overwrite those edits");
        next = backup.original;
      } else if (enabled === parse(current.raw).enabled) return;
      else next = invocation(current.raw, enabled);
      if (!enabled && !backup) state.backups[id] = { original: current.raw, disabled: hash(next) };
      stateRevision = await this.saveState(state, stateRevision);
      const temp = join(found.root.path, `.skill-${randomUUID()}`);
      const mode = (await fs.stat(found.summary.path)).mode & 511;
      const handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
      try {
        await handle.writeFile(next);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await this.checked(found, revision2);
        await fs.rename(temp, found.summary.path);
      } finally {
        if (await exists(temp)) await fs.unlink(temp);
      }
      if (enabled && backup) {
        delete state.backups[id];
        await this.saveState(state, stateRevision);
      }
    });
  }
  deleteSkill(id, revision2, cwd) {
    return this.mutation(async (state, stateRevision) => {
      const found = await this.find(id, cwd);
      await this.checked(found, revision2);
      const trashDir = join(this.options.stateDir, "trash");
      if (await links(trashDir)) fail("UNSAFE_STATE", "Trash must not contain symlinks");
      await fs.mkdir(trashDir, { recursive: true, mode: 448 });
      const trashId = randomUUID();
      const item = { id: trashId, name: found.summary.name, originalPath: found.target, deletedAt: (/* @__PURE__ */ new Date()).toISOString(), root: found.root, target: found.target, payload: join(trashDir, trashId), revision: revision2, kind: found.summary.kind };
      state.trash.push(item);
      stateRevision = await this.saveState(state, stateRevision);
      try {
        await this.checked(found, revision2);
        await fs.rename(found.target, item.payload);
      } catch (e) {
        state.trash = state.trash.filter((entry) => entry.id !== trashId);
        await this.saveState(state, stateRevision);
        throw e;
      }
    });
  }
  listTrash() {
    return this.ordered(async () => {
      const { state } = await this.loadState();
      const result = [];
      for (const item of state.trash) if (await exists(item.payload)) result.push({ id: item.id, name: item.name, originalPath: item.originalPath, deletedAt: item.deletedAt });
      return result;
    });
  }
  restoreSkill(id) {
    return this.mutation(async (state, stateRevision) => {
      const item = state.trash.find((entry) => entry.id === id);
      if (!item) fail("NOT_FOUND", "Unknown trash ID");
      const roots = await this.roots();
      if (item.root.source.startsWith("project-")) {
        const marker = item.root.source === "project-dsh" ? ".dsh" : ".agents";
        const workspace2 = this.options.workspacePaths().find((path) => join(resolve(path), marker, "skills") === item.root.path);
        if (!workspace2) fail("UNSAFE_PATH", "Original workspace is no longer registered");
        roots.push(...await this.roots(resolve(workspace2)));
      }
      if (!roots.some((root) => root.path === item.root.path && root.source === item.root.source)) fail("UNSAFE_PATH", "Original workspace is no longer registered");
      if (await links(item.root.path) || await links(item.payload)) fail("READ_ONLY", "Restore paths must not contain symlinks");
      if (await exists(item.target)) fail("ALREADY_EXISTS", "Restore would overwrite an existing skill");
      const snap = await this.snapshot(join(this.options.stateDir, "trash"), item.payload, item.kind);
      if (snap.linked || snap.revision !== item.revision) fail("REVISION_CONFLICT", "Trash payload changed");
      await fs.mkdir(item.root.path, { recursive: true });
      if (await links(item.root.path) || await exists(item.target)) fail("UNSAFE_PATH", "Restore destination changed");
      const latest = await this.snapshot(join(this.options.stateDir, "trash"), item.payload, item.kind);
      if (latest.linked || latest.revision !== item.revision) fail("REVISION_CONFLICT", "Trash payload changed before restore");
      if (await links(item.root.path)) fail("READ_ONLY", "Restore destination changed");
      if (item.kind === "file") {
        await fs.link(item.payload, item.target);
        const [payloadStat, targetStat] = await Promise.all([fs.lstat(item.payload), fs.lstat(item.target)]);
        if (payloadStat.ino !== targetStat.ino || payloadStat.dev !== targetStat.dev) fail("REVISION_CONFLICT", "Restore destination changed; trash backup retained");
        await fs.unlink(item.payload);
      } else {
        await fs.mkdir(item.target, { mode: 448 });
        const reserved = await fs.lstat(item.target);
        try {
          await fs.rename(item.payload, item.target);
        } catch (error) {
          const current = await fs.lstat(item.target).catch(() => void 0);
          if (current?.ino === reserved.ino && current.dev === reserved.dev) await fs.rmdir(item.target).catch(() => void 0);
          throw error;
        }
      }
      state.trash = state.trash.filter((entry) => entry.id !== id);
      await this.saveState(state, stateRevision);
    });
  }
  scanSkills(dir) {
    return this.ordered(async () => {
      if (!isAbsolute(dir)) fail("UNSAFE_PATH", "Scan directory must be absolute");
      const root = await fs.realpath(dir);
      if (!(await fs.stat(root)).isDirectory()) fail("UNSAFE_PATH", "Scan target is not a directory");
      const output = [];
      for (const name2 of (await fs.readdir(root)).sort()) {
        if (name2.startsWith(".")) continue;
        const target = join(root, name2);
        try {
          const stat2 = await fs.lstat(target);
          const kind = stat2.isDirectory() ? "bundle" : stat2.isFile() && name2.endsWith(".md") ? "file" : void 0;
          if (!kind) continue;
          const snap = await this.snapshot(root, target, kind);
          if (snap.linked) continue;
          const parsed = parse(snap.raw);
          const id = randomUUID();
          if (this.grants.size >= 2048) this.grants.delete(this.grants.keys().next().value);
          this.grants.set(id, { root, target, kind, revision: snap.revision, name: parsed.name });
          output.push({ id, revision: snap.revision, name: parsed.name, description: parsed.description, sourcePath: target, kind });
        } catch (e) {
          if (!["ENOENT", "UNSAFE_PATH", "UNSAFE_FILE", "INVALID_SKILL"].includes(e.code ?? "")) throw e;
        }
      }
      return output;
    });
  }
  importSkills(items) {
    return this.mutation(async () => {
      const output = [];
      const destRoot = join(this.options.dshHome, "skills");
      for (const item of items) {
        const grant = this.grants.get(item.id);
        const name2 = grant?.name ?? "Unknown skill";
        try {
          if (!grant) fail("INVALID_SCAN", "Unknown or expired scan ID; scan again");
          if (await links(grant.root) || await fs.realpath(grant.root) !== grant.root) fail("UNSAFE_PATH", "Scan root changed; scan again");
          const snap = await this.snapshot(grant.root, grant.target, grant.kind, true);
          if (snap.linked || snap.revision !== item.revision || snap.revision !== grant.revision) fail("REVISION_CONFLICT", "Scanned source changed; scan again");
          if (await links(destRoot)) fail("READ_ONLY", "Import destination must not contain symlinks");
          await fs.mkdir(destRoot, { recursive: true });
          const dest = join(destRoot, basename(grant.target));
          if (await exists(dest)) fail("ALREADY_EXISTS", "A skill with this filename already exists");
          if (grant.kind === "file") {
            const bytes = snap.files[0].bytes;
            const latest = await this.snapshot(grant.root, grant.target, grant.kind);
            if (latest.linked || latest.revision !== snap.revision) fail("REVISION_CONFLICT", "Source changed before import");
            if (await links(destRoot)) fail("READ_ONLY", "Import destination changed");
            await exclusiveWrite(dest, bytes, snap.files[0].mode);
          } else {
            const staging = join(destRoot, `.import-${randomUUID()}`);
            await fs.mkdir(staging, { mode: 448 });
            for (const directory of snap.directories) if (directory) await fs.mkdir(join(staging, directory), { mode: 448 });
            for (const file of snap.files) await exclusiveWrite(join(staging, file.path), file.bytes, file.mode);
            const copied = await this.snapshot(destRoot, staging, "bundle");
            const current = await this.snapshot(grant.root, grant.target, "bundle");
            if (copied.linked || current.linked || copied.revision !== snap.revision || current.revision !== snap.revision) fail("REVISION_CONFLICT", "Source changed during import");
            if (await links(destRoot)) fail("READ_ONLY", "Import destination changed");
            await fs.mkdir(dest, { mode: 448 });
            for (const entry of await fs.readdir(staging)) await fs.rename(join(staging, entry), join(dest, entry));
            await fs.rmdir(staging);
          }
          output.push({ name: name2, ok: true });
        } catch (e) {
          output.push({ name: name2, ok: false, reason: e.message });
        }
      }
      return output;
    });
  }
};

// src/mcp.ts
import { constants as constants2 } from "node:fs";
import { access, mkdir as mkdir2, open as open2, rename as rename2, unlink as unlink2 } from "node:fs/promises";
import { randomUUID as randomUUID2 } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute as isAbsolute2, join as join2, resolve as resolve2 } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
var McpManagerError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "McpManagerError";
  }
};
function fail2(code, message) {
  throw new McpManagerError(code, message);
}
var badKeys = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
var configKeys = /* @__PURE__ */ new Set(["id", "name", "transport", "enabled", "command", "args", "envRefs", "cwd", "url", "headerRefs"]);
var MAX_BYTES = 1048576;
var CLEANUP_GRACE_MS = 1e3;
function record(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function text(value, max, empty = false) {
  return typeof value === "string" && (empty || value.length > 0) && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
}
function refs(value, header) {
  if (!record(value) || Object.keys(value).length > 128) fail2("INVALID_INPUT", "Invalid credential references");
  const out = {};
  const seen = /* @__PURE__ */ new Set();
  for (const [key, ref] of Object.entries(value)) {
    if (badKeys.has(key) || key.length > 128 || !(header ? /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/ : /^[A-Za-z_][A-Za-z0-9_]*$/).test(key) || !text(ref, 256) || !/^[A-Za-z_][A-Za-z0-9_.:/-]*$/.test(ref) || badKeys.has(ref)) fail2("INVALID_INPUT", "Invalid credential reference");
    if (seen.has(header ? key.toLowerCase() : key)) fail2("INVALID_INPUT", "Duplicate credential reference key");
    seen.add(header ? key.toLowerCase() : key);
    out[key] = ref;
  }
  return out;
}
function normalizeMcpServer(input) {
  if (!record(input) || Object.keys(input).some((key) => !configKeys.has(key))) fail2("INVALID_INPUT", "Unknown server fields (raw env/headers are forbidden)");
  if (!text(input.name, 32) || !/^[A-Za-z0-9_-]+$/.test(input.name) || badKeys.has(input.name)) fail2("INVALID_INPUT", "Invalid server name");
  if (input.id !== void 0 && (!text(input.id, 128) || !/^[A-Za-z0-9_-]+$/.test(input.id) || badKeys.has(input.id))) fail2("INVALID_INPUT", "Invalid server ID");
  if (typeof input.enabled !== "boolean") fail2("INVALID_INPUT", "enabled must be boolean");
  const out = { ...input.id === void 0 ? {} : { id: input.id }, name: input.name, transport: input.transport, enabled: input.enabled };
  if (input.transport === "stdio") {
    if (!text(input.command, 4096) || input.command.trim() !== input.command || input.command.length === 0) fail2("INVALID_INPUT", "Invalid command");
    if (input.url !== void 0 || input.headerRefs !== void 0) fail2("INVALID_INPUT", "Unexpected HTTP configuration");
    out.command = input.command;
    if (input.args !== void 0) {
      if (!Array.isArray(input.args) || input.args.length > 256 || ![...input.args].every((arg) => text(arg, 8192, true))) fail2("INVALID_INPUT", "Invalid command arguments");
      out.args = [...input.args];
    }
    if (input.cwd !== void 0) {
      if (!text(input.cwd, 4096) || !isAbsolute2(input.cwd)) fail2("INVALID_INPUT", "cwd must be an absolute path");
      out.cwd = input.cwd;
    }
    if (input.envRefs !== void 0) out.envRefs = refs(input.envRefs, false);
  } else if (input.transport === "streamable-http") {
    if (input.command !== void 0 || input.args !== void 0 || input.cwd !== void 0 || input.envRefs !== void 0) fail2("INVALID_INPUT", "Unexpected stdio configuration");
    if (!text(input.url, 8192) || input.url.trim() !== input.url) fail2("INVALID_INPUT", "Invalid HTTP URL");
    let url;
    try {
      url = new URL(input.url);
    } catch {
      fail2("INVALID_INPUT", "Invalid HTTP URL");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) fail2("INVALID_INPUT", "Only HTTP(S) URLs without userinfo or fragments are supported");
    out.url = input.url;
    if (input.headerRefs !== void 0) out.headerRefs = refs(input.headerRefs, true);
  } else fail2("INVALID_INPUT", "Invalid transport");
  return out;
}
function count(handle) {
  try {
    const n = handle?.toolCount() ?? 0;
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
var McpManager = class {
  target;
  lock;
  live = /* @__PURE__ */ new Map();
  probes = /* @__PURE__ */ new Set();
  probeTasks = /* @__PURE__ */ new Set();
  pendingCleanup = /* @__PURE__ */ new Set();
  queue = Promise.resolve();
  disposed = false;
  timeout;
  opts;
  constructor(opts) {
    this.opts = opts;
    this.target = join2(resolve2(opts.stateDir), "mcp.json");
    this.lock = `${this.target}.lock`;
    this.timeout = opts.connectTimeoutMs ?? 15e3;
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 3e5) fail2("INVALID_INPUT", "Invalid connection deadline");
  }
  serial(fn) {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => {
    });
    return task;
  }
  active() {
    if (this.disposed) fail2("DISPOSED", "MCP manager is disposed");
  }
  async readDocument() {
    try {
      const handle = await open2(this.target, constants2.O_RDONLY | constants2.O_NOFOLLOW);
      let raw;
      try {
        const stat2 = await handle.stat();
        if (!stat2.isFile() || stat2.size > MAX_BYTES) fail2("CORRUPT_CONFIG", "Invalid MCP configuration document");
        raw = await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
      const data = JSON.parse(raw);
      if (!record(data) || Object.keys(data).some((key) => !["schemaVersion", "revision", "servers"].includes(key)) || data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.servers) || data.servers.length > 256) throw new Error();
      const ids = /* @__PURE__ */ new Set(), names = /* @__PURE__ */ new Set();
      const servers = data.servers.map((value) => {
        const s = normalizeMcpServer(value);
        if (!s.id || ids.has(s.id) || names.has(s.name)) throw new Error();
        ids.add(s.id);
        names.add(s.name);
        return s;
      });
      return { schemaVersion: 1, revision: data.revision, servers };
    } catch (e) {
      if (e.code === "ENOENT") return { schemaVersion: 1, revision: 0, servers: [] };
      fail2("CORRUPT_CONFIG", "MCP configuration is unreadable or corrupt; no changes were made");
    }
  }
  async natives() {
    let input;
    try {
      input = await this.opts.nativeServers();
    } catch {
      fail2("NATIVE_UNAVAILABLE", "Native MCP inventory unavailable");
    }
    return input.map((s) => ({ id: s.id, name: s.name, transport: s.transport, enabled: s.enabled, status: "external", toolCount: Number.isSafeInteger(s.toolCount) && s.toolCount >= 0 ? s.toolCount : 0, source: "native", writable: false, toggleable: !!this.opts.nativeSetEnabled && s.toggleable === true }));
  }
  async list() {
    const [doc, native] = await Promise.all([this.readDocument(), this.natives()]);
    const servers = doc.servers.map((s) => {
      const live = this.live.get(s.id);
      const same = live && JSON.stringify(live.config) === JSON.stringify(s);
      const blocked = live?.status === "failed" && live.controller.signal.aborted;
      return { ...s, id: s.id, status: blocked ? "failed" : s.enabled && same ? live.status : "stopped", ...(same || blocked) && live?.error ? { error: live.error } : {}, toolCount: same ? count(live.handle) : 0, source: "managed", writable: true };
    });
    const persisted = new Set(doc.servers.map((s) => s.id));
    for (const [id, entry] of this.live) {
      if (persisted.has(id)) continue;
      servers.push({
        ...entry.config,
        id,
        enabled: false,
        status: "failed",
        cleanupPending: true,
        error: "Saved deletion; cleanup pending. Retry removal.",
        toolCount: count(entry.handle),
        source: "managed",
        writable: true
      });
    }
    let legacyAvailable = false;
    try {
      await access(this.opts.legacyPath ?? join2(homedir(), ".dsh", "mcp.json"));
      legacyAvailable = true;
    } catch {
    }
    return { revision: doc.revision, servers: [...servers, ...native], legacyAvailable };
  }
  async locked(fn) {
    await mkdir2(resolve2(this.opts.stateDir), { recursive: true, mode: 448 });
    const deadline = Date.now() + 5e3;
    let handle;
    while (!handle) {
      try {
        handle = await open2(this.lock, "wx", 384);
      } catch (e) {
        if (e.code !== "EEXIST") fail2("WRITE_FAILED", "Unable to lock MCP configuration");
        if (Date.now() >= deadline) fail2("LOCKED", "MCP configuration is locked; retry later");
        await delay(20);
      }
    }
    try {
      return await fn();
    } finally {
      await handle.close();
      await unlink2(this.lock);
    }
  }
  async writeDocument(doc) {
    const temp = `${this.target}.${randomUUID2()}.tmp`;
    let created = false;
    try {
      const payload = JSON.stringify(doc, null, 2) + "\n";
      if (Buffer.byteLength(payload) > MAX_BYTES) fail2("INVALID_INPUT", "MCP configuration is too large");
      const h = await open2(temp, "wx", 384);
      created = true;
      try {
        await h.writeFile(payload);
        await h.sync();
      } finally {
        await h.close();
      }
      await rename2(temp, this.target);
      created = false;
    } catch (e) {
      if (e instanceof McpManagerError) throw e;
      fail2("WRITE_FAILED", "Unable to save MCP configuration");
    } finally {
      if (created) await unlink2(temp).catch(() => {
      });
    }
  }
  mutate(revision2, change) {
    return this.serial(async () => {
      this.active();
      if (!Number.isSafeInteger(revision2) || revision2 < 0) fail2("CONFLICT", "A current numeric revision is required");
      const doc = await this.locked(async () => {
        const current = await this.readDocument();
        if (current.revision !== revision2) fail2("CONFLICT", "MCP configuration changed; refresh and retry");
        if (current.revision >= Number.MAX_SAFE_INTEGER) fail2("INVALID_INPUT", "MCP configuration limit reached");
        const native = await this.natives();
        await change(current, native);
        if (current.servers.length > 256) fail2("INVALID_INPUT", "MCP configuration limit reached");
        current.revision++;
        await this.writeDocument(current);
        return current;
      });
      await this.sync(doc.servers, await this.natives());
    });
  }
  save(input, revision2) {
    let server;
    try {
      server = normalizeMcpServer(input);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.mutate(revision2, (doc, native) => {
      if (server.id !== void 0 && native.some((s) => s.id === server.id)) fail2("READ_ONLY", "Native MCP servers are read-only");
      if (native.some((s) => s.name === server.name)) fail2("CONFLICT", "Choose a name distinct from native MCP servers");
      const index = server.id === void 0 ? -1 : doc.servers.findIndex((s) => s.id === server.id);
      if (server.id !== void 0 && index < 0) fail2("NOT_FOUND", "Managed MCP server not found");
      if (doc.servers.some((s) => s.name === server.name && s.id !== server.id)) fail2("CONFLICT", "MCP server name already exists");
      server = normalizeMcpServer({ ...server, id: server.id ?? randomUUID2() });
      if (index < 0) doc.servers.push(server);
      else doc.servers[index] = server;
    });
  }
  setEnabled(id, enabled, revision2) {
    let nativeChanged = false;
    return this.mutate(revision2, async (doc, native) => {
      if (typeof enabled !== "boolean") fail2("INVALID_INPUT", "enabled must be boolean");
      const external = native.find((s) => s.id === id);
      if (external) {
        if (!external.toggleable || !this.opts.nativeSetEnabled) fail2("READ_ONLY", "Native MCP enablement is not manageable in this profile");
        try {
          await this.opts.nativeSetEnabled(id, enabled);
        } catch (error) {
          const code = error instanceof McpManagerError ? error.code : "";
          if (code === "NATIVE_RESTART_REQUIRED") fail2(code, "Native MCP change was saved but requires restart; refresh before retrying");
          if (code === "READ_ONLY" || code === "NOT_FOUND") fail2(code, "Native MCP entry is unavailable or no longer manageable; refresh before retrying");
          fail2("NATIVE_APPLY_FAILED", "Native MCP change did not finish live; its saved state may have changed. Refresh before retrying");
        }
        nativeChanged = true;
        return;
      }
      const server = doc.servers.find((s) => s.id === id);
      if (!server) fail2("NOT_FOUND", "Managed MCP server not found");
      if (enabled && native.some((s) => s.name === server.name)) fail2("CONFLICT", "MCP server name conflicts with a native server");
      server.enabled = enabled;
    }).catch((error) => {
      if (nativeChanged) fail2("NATIVE_STATE_CHANGED", "Native MCP state was updated, but the manager revision or lifecycle could not be saved. Refresh before retrying");
      throw error;
    });
  }
  delete(id, revision2) {
    return this.mutate(revision2, (doc, native) => {
      if (native.some((s) => s.id === id)) fail2("READ_ONLY", "Native MCP servers are read-only");
      const index = doc.servers.findIndex((s) => s.id === id);
      if (index < 0) {
        if (this.live.has(id)) return;
        fail2("NOT_FOUND", "Managed MCP server not found");
      }
      doc.servers.splice(index, 1);
    });
  }
  reload() {
    return this.serial(async () => {
      this.active();
      await this.sync((await this.readDocument()).servers, await this.natives());
    });
  }
  async resolveRefs(server, controller) {
    const env = {}, headers = {};
    controller.signal.throwIfAborted();
    for (const [mapping, target] of [[server.envRefs, env], [server.headerRefs, headers]]) {
      for (const [key, ref] of Object.entries(mapping ?? {})) {
        controller.signal.throwIfAborted();
        const value = await this.opts.resolveCredential(ref);
        controller.signal.throwIfAborted();
        if (typeof value !== "string" || value.length > 65536 || value.includes("\0") || target === headers && /[\r\n]/.test(value)) throw new Error("credential unavailable");
        target[key] = value;
      }
    }
    return { env, headers };
  }
  async awaitCleanup(tasks) {
    if (!tasks.length) return;
    let timer;
    try {
      await Promise.race([
        Promise.all(tasks),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("cleanup deadline")), CLEANUP_GRACE_MS);
        })
      ]);
    } catch {
      fail2("DISPOSE_FAILED", "MCP cleanup did not finish; no replacement was started");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async connection(server, controller, probe, track) {
    const signal = controller.signal;
    let adapterStarted = false;
    let timer;
    let onAbort = () => {
    };
    let abandoned = false;
    const cancelled = new Promise((_, reject) => {
      onAbort = () => {
        abandoned = true;
        reject(new Error("Connection cancelled"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      timer = setTimeout(() => controller.abort(), this.timeout);
    });
    const pending = (async () => {
      const resolved = await this.resolveRefs(server, controller);
      signal.throwIfAborted();
      adapterStarted = true;
      const handle = await this.opts.connect(normalizeMcpServer(server), { ...resolved, signal }, probe);
      let disposal;
      return { toolCount: () => handle.toolCount(), dispose: () => disposal ??= Promise.resolve().then(() => handle.dispose()) };
    })();
    const cleanup = pending.then(async (handle) => {
      if (abandoned) await handle.dispose();
    }, () => {
    });
    this.pendingCleanup.add(cleanup);
    void cleanup.then(() => this.pendingCleanup.delete(cleanup), () => this.pendingCleanup.delete(cleanup));
    track?.(cleanup, () => adapterStarted);
    try {
      return await Promise.race([pending, cancelled]);
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }
  async stop(id, entry) {
    entry.controller.abort();
    await entry.task;
    try {
      await this.awaitCleanup([entry.cleanup]);
    } catch (e) {
      entry.status = "failed";
      entry.error = "MCP cleanup pending or failed; replacement blocked";
      throw e;
    }
    if (entry.handle) {
      try {
        await entry.handle.dispose();
      } catch {
        entry.status = "failed";
        entry.error = "MCP unload failed; replacement blocked";
        fail2("DISPOSE_FAILED", "Unable to unload MCP server; no replacement was started");
      }
      entry.handle = void 0;
    }
    if (this.live.get(id) === entry) this.live.delete(id);
  }
  async sync(servers, native) {
    const desired = new Map(servers.filter((s) => !this.disposed && s.enabled && !native.some((n) => n.name === s.name || n.id === s.id)).map((s) => [s.id, s]));
    for (const [id, entry] of this.live) {
      const next = desired.get(id);
      if (!next || JSON.stringify(next) !== JSON.stringify(entry.config) || entry.status === "failed") await this.stop(id, entry);
    }
    for (const [id, config] of desired) {
      if (this.live.has(id)) continue;
      const entry = { config, controller: new AbortController(), status: "loading", task: Promise.resolve(), cleanup: Promise.resolve() };
      this.live.set(id, entry);
      entry.task = this.connection(config, entry.controller, false, (cleanup) => {
        entry.cleanup = cleanup;
      }).then(async (handle) => {
        if (this.disposed || entry.controller.signal.aborted || this.live.get(id) !== entry) {
          await handle.dispose();
          return;
        }
        entry.handle = handle;
        entry.status = "loaded";
      }).catch(() => {
        if (!entry.controller.signal.aborted && this.live.get(id) === entry) {
          entry.status = "failed";
          entry.error = "MCP connection failed (sensitive details hidden)";
        } else if (!this.disposed && this.live.get(id) === entry) {
          entry.status = "failed";
          entry.error = "MCP connection cancelled or timed out";
        }
      });
    }
  }
  async testConnect(input, signal) {
    this.active();
    let server;
    try {
      server = normalizeMcpServer(input);
    } catch {
      return { ok: false, error: "Invalid MCP server configuration" };
    }
    const controller = new AbortController();
    const aborted = () => controller.abort();
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) controller.abort();
    this.probes.add(controller);
    const task = (async () => {
      let handle;
      let cleanup = Promise.resolve();
      let adapterStarted = () => false;
      try {
        handle = await this.connection(server, controller, true, (pending, started) => {
          cleanup = pending;
          adapterStarted = started;
        });
        controller.signal.throwIfAborted();
        return { ok: true };
      } catch {
        return { ok: false, error: "MCP connection failed or timed out (sensitive details hidden)" };
      } finally {
        controller.abort();
        if (handle) await handle.dispose();
        if (adapterStarted()) await this.awaitCleanup([cleanup]);
      }
    })().catch(() => ({ ok: false, error: "MCP probe cleanup failed (sensitive details hidden)" }));
    this.probeTasks.add(task);
    try {
      return await task;
    } finally {
      signal?.removeEventListener("abort", aborted);
      this.probes.delete(controller);
      this.probeTasks.delete(task);
    }
  }
  dispose() {
    this.disposed = true;
    for (const probe of this.probes) probe.abort();
    for (const entry of this.live.values()) entry.controller.abort();
    return this.serial(async () => {
      await Promise.all([...this.probeTasks]);
      const cleanup = this.awaitCleanup([...this.pendingCleanup]).then(() => true, () => false);
      const stopped = await Promise.all([...this.live].map(async ([id, entry]) => {
        try {
          await this.stop(id, entry);
          return true;
        } catch {
          return false;
        }
      }));
      if (!await cleanup || stopped.some((ok) => !ok)) fail2("DISPOSE_FAILED", "Unable to unload every MCP server; cleanup remains tracked");
    });
  }
};

// src/service.ts
import { createHash as createHash2 } from "node:crypto";
var actions = /* @__PURE__ */ new Set(["workspaces", "skills.list", "skills.read", "skills.toggle", "skills.trash", "skills.scan", "skills.import", "trash.list", "trash.restore", "mcp.list", "mcp.save", "mcp.toggle", "mcp.delete", "mcp.test"]);
var safeKeys = /* @__PURE__ */ new Set(["action", "cwd", "id", "revision", "enabled", "dir", "items", "server"]);
var mutations = /* @__PURE__ */ new Set(["skills.toggle", "skills.trash", "skills.import", "trash.restore", "mcp.save", "mcp.toggle", "mcp.delete", "mcp.test"]);
var ManagerError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ManagerError";
  }
};
function requiresApproval(action) {
  return mutations.has(action);
}
function text2(value, label) {
  if (typeof value !== "string" || !value || value.length > 8192 || value.includes("\0")) throw new ManagerError("INVALID_INPUT", `${label} is required`);
  return value;
}
function revision(value, kind) {
  if (kind === "skill" && typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) return value;
  if (kind === "mcp" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new ManagerError("INVALID_INPUT", "A fresh revision from the list is required");
}
function parseRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ManagerError("INVALID_INPUT", "Expected an action object");
  const record2 = value;
  if (Object.keys(record2).some((key) => !safeKeys.has(key))) throw new ManagerError("INVALID_INPUT", "Unknown request field");
  if (typeof record2.action !== "string" || !actions.has(record2.action)) throw new ManagerError("INVALID_INPUT", "Unknown action");
  if (record2.cwd !== void 0 && (typeof record2.cwd !== "string" || record2.cwd.length > 8192 || record2.cwd.includes("\0"))) throw new ManagerError("INVALID_INPUT", "Invalid workspace");
  return record2;
}
var ManagerService = class {
  deps;
  constructor(deps) {
    this.deps = deps;
  }
  policyView(skill, cwd) {
    const policy = this.deps.policy;
    return {
      ...skill,
      sourceEnabled: skill.enabled,
      enabled: skill.enabled && policy.isEnabled(skill.name, cwd || void 0),
      toggleable: true,
      revision: createHash2("sha256").update(`${skill.revision}:${policy.snapshot().revision}`).digest("hex")
    };
  }
  async execute(input, signal, caller = "ui", actorCwd) {
    signal?.throwIfAborted();
    const r = parseRequest(input);
    const { skills, mcp } = this.deps;
    switch (r.action) {
      case "workspaces":
        return this.deps.workspaces();
      case "skills.list": {
        await this.deps.policy.load();
        return (await skills.listSkills(r.cwd || void 0)).map((s) => this.policyView(s, r.cwd));
      }
      case "skills.read": {
        await this.deps.policy.load();
        const skill = await skills.readSkill(text2(r.id, "id"), r.cwd || void 0);
        if (caller === "agent" && (!actorCwd || !this.deps.policy.isEnabled(skill.name, actorCwd) || !this.deps.policy.isEnabled(skill.name, r.cwd || void 0))) throw new ManagerError("POLICY_DISABLED", "This skill is disabled for the agent or selected DSH scope; its body is only available in the manager UI preview");
        return this.policyView(skill, r.cwd);
      }
      case "skills.toggle": {
        if (typeof r.enabled !== "boolean") throw new ManagerError("INVALID_INPUT", "enabled must be boolean");
        await this.deps.policy.load();
        const skill = await skills.readSkill(text2(r.id, "id"), r.cwd || void 0);
        if (this.policyView(skill, r.cwd).revision !== revision(r.revision, "skill")) throw new ManagerError("REVISION_CONFLICT", "Skill or DSH visibility changed; refresh and retry");
        if (r.enabled && !skill.enabled) throw new ManagerError("SOURCE_DISABLED", "The source skill itself is disabled; enabling in DSH cannot override its source invocation policy");
        signal?.throwIfAborted();
        await this.deps.policy.setEnabled(skill.name, r.enabled, this.deps.policy.snapshot().revision, r.cwd || void 0);
        return null;
      }
      case "skills.trash": {
        await this.deps.policy.load();
        const skill = await skills.readSkill(text2(r.id, "id"), r.cwd || void 0);
        if (this.policyView(skill, r.cwd).revision !== revision(r.revision, "skill")) throw new ManagerError("REVISION_CONFLICT", "Skill or DSH visibility changed; refresh and retry");
        await skills.deleteSkill(skill.id, skill.revision, r.cwd || void 0);
        return null;
      }
      case "skills.scan":
        return skills.scanSkills(text2(r.dir, "dir"));
      case "skills.import":
        if (!Array.isArray(r.items) || !r.items.length || r.items.length > 100 || r.items.some((i) => !i || typeof i !== "object" || Object.keys(i).some((k) => k !== "id" && k !== "revision") || typeof i.id !== "string" || typeof i.revision !== "string")) throw new ManagerError("INVALID_INPUT", "Select between 1 and 100 scanned items");
        return skills.importSkills(r.items);
      case "trash.list":
        return skills.listTrash();
      case "trash.restore":
        await skills.restoreSkill(text2(r.id, "id"));
        return null;
      case "mcp.list":
        return mcp.list();
      case "mcp.save":
        if (!r.server) throw new ManagerError("INVALID_INPUT", "server is required");
        await mcp.save(r.server, revision(r.revision, "mcp"));
        return null;
      case "mcp.toggle":
        if (typeof r.enabled !== "boolean") throw new ManagerError("INVALID_INPUT", "enabled must be boolean");
        await mcp.setEnabled(text2(r.id, "id"), r.enabled, revision(r.revision, "mcp"));
        return null;
      case "mcp.delete":
        await mcp.delete(text2(r.id, "id"), revision(r.revision, "mcp"));
        return null;
      case "mcp.test":
        if (!r.server) throw new ManagerError("INVALID_INPUT", "server is required");
        return mcp.testConnect(r.server, signal);
    }
  }
};
var publicErrors = /* @__PURE__ */ new Set(["INVALID_INPUT", "BODY_TOO_LARGE", "APPROVAL_REQUIRED", "CONFLICT", "REVISION_CONFLICT", "BACKUP_CONFLICT", "READ_ONLY", "NOT_FOUND", "INVALID_WORKSPACE", "INVALID_SCAN", "INVALID_SKILL", "UNSAFE_YAML", "UNSAFE_PATH", "UNSAFE_FILE", "UNSAFE_STATE", "CORRUPT_STATE", "CORRUPT_CONFIG", "STATE_LIMIT", "BUSY", "LOCKED", "ALREADY_EXISTS", "NATIVE_UNAVAILABLE", "WRITE_FAILED", "DISPOSE_FAILED", "DISPOSED", "POLICY_DISABLED", "SOURCE_DISABLED", "NATIVE_RESTART_REQUIRED", "NATIVE_APPLY_FAILED", "NATIVE_STATE_CHANGED"]);
function safeError(error) {
  const e = error;
  const code = typeof e?.code === "string" && publicErrors.has(e.code) ? e.code : "OPERATION_FAILED";
  if (code === "OPERATION_FAILED") return { code, message: "Operation failed; no changes are implied. Refresh the list and check the configuration." };
  return { code, message: typeof e.message === "string" ? e.message.slice(0, 1e3) : code };
}

// src/protocol.ts
var MANAGER_API = "/api/koishi-skills-mcp/action";
var MANAGER_TOOL = "skills_mcp_manager";
var MANAGER_ID = "koishi-skills-mcp-manager";

// src/routes.ts
var MAX_BODY = 1024 * 1024;
function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(value));
}
async function body(req) {
  const size = Number(req.headers["content-length"]);
  if (Number.isFinite(size) && size > MAX_BODY) throw new ManagerError("BODY_TOO_LARGE", "Request exceeds 1 MiB");
  let length = 0;
  const buffers = [];
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_BODY) throw new ManagerError("BODY_TOO_LARGE", "Request exceeds 1 MiB");
    buffers.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(buffers).toString("utf8"));
  } catch {
    throw new ManagerError("INVALID_INPUT", "Invalid JSON");
  }
}
function makeRoute(deps) {
  return {
    kind: "exact",
    path: MANAGER_API,
    handler: async (req, res) => {
      const address = req.socket.remoteAddress;
      const local = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
      let localAuthority = false;
      try {
        const authority = new URL(`http://${req.headers.host || ""}`);
        localAuthority = ["127.0.0.1", "localhost", "[::1]"].includes(authority.hostname) && !authority.username && !authority.password && authority.pathname === "/";
      } catch {
      }
      const rejection = deps.requestRejection(req);
      if (!local || !localAuthority || rejection || req.headers["sec-fetch-site"] === "cross-site") {
        json(res, rejection || 403, { ok: false, error: { code: "FORBIDDEN", message: "Authenticated local access required" } });
        return;
      }
      if (req.method !== "POST") {
        json(res, 405, { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
        json(res, 415, { ok: false, error: { code: "INVALID_INPUT", message: "application/json required" } });
        return;
      }
      const controller = new AbortController();
      const closed = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.once("close", closed);
      try {
        const value = await deps.service.execute(await body(req), controller.signal);
        json(res, 200, { ok: true, value: value ?? null });
      } catch (error) {
        const safe = safeError(error);
        const status = /CONFLICT|BUSY/.test(safe.code) ? 409 : safe.code === "BODY_TOO_LARGE" ? 413 : /NOT_FOUND/.test(safe.code) ? 404 : /INVALID|READ_ONLY|FORBIDDEN/.test(safe.code) ? 400 : 500;
        if (!res.destroyed) json(res, status, { ok: false, error: safe });
      } finally {
        res.off("close", closed);
      }
    }
  };
}

// src/host.ts
import { createScope } from "@deepseek-ai/dsh-scope";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";

// src/native-mcp.ts
var MCP_MODULE = "@deepseek-ai/dsh-mcp-client";
function manageable(entry) {
  return entry.moduleName === MCP_MODULE && !entry.readOnlyReason && typeof entry.patchId === "string" && entry.patchId.length > 0;
}
async function listToggleableNativeIds(ctx) {
  if (!ctx.pluginManager) return /* @__PURE__ */ new Set();
  try {
    const entries = await ctx.pluginManager.listPlugins();
    return new Set(entries.filter(manageable).map((entry) => `native:${entry.entryId}`));
  } catch {
    throw new McpManagerError("NATIVE_UNAVAILABLE", "Native MCP management inventory is unavailable");
  }
}
async function setNativeMcpEnabled(ctx, id, enabled) {
  if (typeof enabled !== "boolean" || typeof id !== "string" || !id.startsWith("native:") || id.length <= "native:".length || id.length > 4096 || /[\x00-\x1f\x7f]/.test(id)) {
    throw new McpManagerError("INVALID_INPUT", "Invalid native MCP enablement request");
  }
  const manager = ctx.pluginManager;
  if (!manager) throw new McpManagerError("READ_ONLY", "Native MCP management is unavailable in this profile");
  let entries;
  try {
    entries = await manager.listPlugins();
  } catch {
    throw new McpManagerError("NATIVE_UNAVAILABLE", "Native MCP management inventory is unavailable");
  }
  const entry = entries.find((candidate) => `native:${candidate.entryId}` === id);
  if (!entry || entry.moduleName !== MCP_MODULE) throw new McpManagerError("NOT_FOUND", "Native MCP entry not found");
  if (!manageable(entry)) throw new McpManagerError("READ_ONLY", "Native MCP entry cannot be managed through this profile");
  let result;
  try {
    result = await manager.setPluginEnabled(entry.entryId, enabled);
  } catch {
    throw new McpManagerError("NATIVE_APPLY_FAILED", "Native MCP change failed; its saved state may have changed. Refresh before retrying");
  }
  if (result.application === "restart-required") {
    throw new McpManagerError("NATIVE_RESTART_REQUIRED", "Native MCP change was saved but requires restart; refresh before retrying");
  }
  if (result.application !== "applied" || result.error || result.enabled !== void 0 && result.enabled !== enabled) {
    throw new McpManagerError("NATIVE_APPLY_FAILED", "Native MCP change was not applied live; its saved state may have changed. Refresh before retrying");
  }
}

// src/host.ts
import { relative as relative2, resolve as resolve3, isAbsolute as isAbsolute3, sep as sep2 } from "node:path";
function workspaces(ctx) {
  return ctx.workspaceRegistry.list().map((w) => ({ id: w.id, path: w.path, title: w.title }));
}
function policyWorkspace(ctx, cwd) {
  if (!cwd) return void 0;
  const path = resolve3(cwd);
  return workspaces(ctx).map((w) => resolve3(w.path)).filter((root) => {
    const rest = relative2(root, path);
    return rest === "" || !isAbsolute3(rest) && rest !== ".." && !rest.startsWith(`..${sep2}`);
  }).sort((a, b) => b.length - a.length)[0] || path;
}
async function nativeServers(ctx) {
  const toggleableIds = await listToggleableNativeIds(ctx);
  return ctx.configEditor.entries().filter((entry) => entry.options.name === "@deepseek-ai/dsh-mcp-client").map((entry) => {
    const config = entry.fiber?.config || entry.options.config;
    const c = config && typeof config === "object" ? config : {};
    const name2 = typeof c.serverName === "string" ? c.serverName : entry.id;
    return {
      id: `native:${entry.id}`,
      name: name2,
      transport: c.transport === "streamable-http" ? "streamable-http" : "stdio",
      enabled: !entry.disabled,
      status: "external",
      source: "native",
      writable: false,
      toggleable: toggleableIds.has(`native:${entry.id}`),
      toolCount: ctx.tools.schemas().filter((t) => t.name.startsWith(`mcp__${name2}__`)).length
    };
  });
}
async function connectMcp(ctx, config, resolved, probe) {
  const key = {};
  const scope = probe ? createScope(ctx, key) : void 0;
  const owner = scope?.ctx || ctx;
  const base = { serverName: config.name, toolCallTimeoutMs: 6e4, failOnStartupError: true, reconnect: { enabled: !probe, initialDelayMs: 500, maxDelayMs: 3e4, maxAttempts: 10 } };
  const actual = config.transport === "stdio" ? { ...base, transport: "stdio", command: config.command, args: config.args || [], env: resolved.env, cwd: config.cwd || "" } : { ...base, transport: "streamable-http", url: config.url, headers: resolved.headers };
  let fiber;
  let cleanup;
  const dispose = () => cleanup ??= (async () => {
    resolved.signal?.removeEventListener("abort", aborted);
    try {
      await fiber?.dispose();
    } finally {
      await scope?.dispose();
    }
  })();
  const aborted = () => {
    void dispose().catch(() => {
    });
  };
  try {
    resolved.signal?.throwIfAborted();
    fiber = owner.plugin(mcpClient, actual);
    resolved.signal?.addEventListener("abort", aborted, { once: true });
    if (resolved.signal?.aborted) {
      await dispose();
      resolved.signal.throwIfAborted();
    }
    await fiber;
    resolved.signal?.throwIfAborted();
    return { dispose, toolCount: () => owner.tools.schemas(probe ? key : void 0).filter((t) => t.name.startsWith(`mcp__${config.name}__`)).length };
  } catch (error) {
    await dispose();
    throw error;
  }
}

// src/skill-policy.ts
import { constants as constants3 } from "node:fs";
import * as fs2 from "node:fs/promises";
import { createHash as createHash3, randomUUID as randomUUID3 } from "node:crypto";
import { dirname as dirname2, isAbsolute as isAbsolute4, join as join3, resolve as resolve4 } from "node:path";
var queues2 = /* @__PURE__ */ new Map();
var MAX_BYTES2 = 1024 * 1024;
var MAX_RULES = 4096;
var digest = (bytes) => createHash3("sha256").update(bytes).digest("hex");
function fail3(code, message) {
  throw Object.assign(new Error(message), { code });
}
var missing2 = (error) => error.code === "ENOENT";
function validName(name2) {
  if (typeof name2 !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name2)) fail3("INVALID_INPUT", "A valid skill name is required");
}
function workspace(cwd) {
  if (cwd === void 0) return void 0;
  if (typeof cwd !== "string" || cwd.length > 8192 || cwd.includes("\0") || !isAbsolute4(cwd)) fail3("INVALID_INPUT", "Workspace must be an absolute path");
  return resolve4(cwd);
}
async function noLinks(path) {
  for (let current = resolve4(path); ; current = dirname2(current)) {
    try {
      if ((await fs2.lstat(current)).isSymbolicLink()) fail3("UNSAFE_STATE", "Skill policy paths must not contain symlinks");
    } catch (error) {
      if (!missing2(error)) throw error;
    }
    if (dirname2(current) === current) break;
  }
}
var copy = (value) => ({ revision: value.revision, rules: value.rules.map((rule) => ({ ...rule })) });
var SkillPolicyStore = class {
  stateDir;
  current;
  diskHash = null;
  listeners = /* @__PURE__ */ new Set();
  constructor(options) {
    this.stateDir = resolve4(options.stateDir);
  }
  path() {
    return join3(this.stateDir, "skill-policy.json");
  }
  ordered(operation) {
    const task = (queues2.get(this.stateDir) ?? Promise.resolve()).catch(() => void 0).then(operation);
    const tail = task.catch(() => void 0);
    queues2.set(this.stateDir, tail);
    void tail.finally(() => {
      if (queues2.get(this.stateDir) === tail) queues2.delete(this.stateDir);
    });
    return task;
  }
  ready() {
    if (!this.current) fail3("CORRUPT_STATE", "Skill policy is not loaded; refusing to assume skills are enabled");
    return this.current;
  }
  async observe() {
    await noLinks(this.path());
    let handle;
    try {
      handle = await fs2.open(this.path(), constants3.O_RDONLY | constants3.O_NOFOLLOW | constants3.O_NONBLOCK);
    } catch (error) {
      if (missing2(error)) return { document: { schemaVersion: 1, revision: 0, rules: [] }, hash: null };
      throw error;
    }
    let bytes;
    try {
      const stat2 = await handle.stat();
      if (!stat2.isFile() || stat2.size > MAX_BYTES2) fail3("CORRUPT_STATE", "Skill policy is not a safe regular JSON file");
      bytes = await handle.readFile();
      if (bytes.length > MAX_BYTES2) fail3("CORRUPT_STATE", "Skill policy exceeds the size limit");
    } finally {
      await handle.close();
    }
    let value;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      fail3("CORRUPT_STATE", "Skill policy JSON is corrupt; refusing to overwrite it");
    }
    const d = value;
    if (!d || typeof d !== "object" || Array.isArray(d) || Object.keys(d).some((key) => !["schemaVersion", "revision", "rules"].includes(key)) || d.schemaVersion !== 1 || !Number.isSafeInteger(d.revision) || d.revision < 0 || !Array.isArray(d.rules) || d.rules.length > MAX_RULES) fail3("CORRUPT_STATE", "Skill policy schema is invalid; refusing to overwrite it");
    const seen = /* @__PURE__ */ new Set();
    for (const rule of d.rules) {
      if (!rule || typeof rule !== "object" || Array.isArray(rule) || Object.keys(rule).some((key2) => !["name", "cwd", "enabled"].includes(key2)) || typeof rule.enabled !== "boolean") fail3("CORRUPT_STATE", "Skill policy contains an invalid rule");
      try {
        validName(rule.name);
        if (rule.cwd !== void 0 && workspace(rule.cwd) !== rule.cwd) throw new Error("noncanonical path");
      } catch {
        fail3("CORRUPT_STATE", "Skill policy contains an invalid name or workspace");
      }
      const key = JSON.stringify([rule.name, rule.cwd ?? null]);
      if (seen.has(key)) fail3("CORRUPT_STATE", "Skill policy contains duplicate rules");
      seen.add(key);
    }
    return { document: { schemaVersion: 1, ...copy(d) }, hash: digest(bytes) };
  }
  /** Startup read only: absent policy is revision zero and creates no files or directories. */
  load() {
    return this.ordered(async () => {
      const observed = await this.observe();
      if (this.diskHash !== null && observed.hash === null) fail3("CORRUPT_STATE", "Previously loaded skill policy disappeared; retaining the last-good policy");
      const changed = this.current !== void 0 && JSON.stringify(this.current) !== JSON.stringify(observed.document);
      this.current = observed.document;
      this.diskHash = observed.hash;
      if (changed) this.notify();
    });
  }
  snapshot() {
    return copy(this.ready());
  }
  isEnabled(name2, cwd) {
    validName(name2);
    const selected = workspace(cwd);
    const rules = this.ready().rules;
    const local = selected === void 0 ? void 0 : rules.find((rule) => rule.name === name2 && rule.cwd === selected);
    return local?.enabled ?? rules.find((rule) => rule.name === name2 && rule.cwd === void 0)?.enabled ?? true;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  notify() {
    for (const listener of [...this.listeners]) try {
      void Promise.resolve(listener()).catch(() => void 0);
    } catch {
    }
  }
  setEnabled(name2, enabled, expectedRevision, cwd) {
    return this.ordered(async () => {
      validName(name2);
      if (typeof enabled !== "boolean" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail3("INVALID_INPUT", "A boolean state and fresh policy revision are required");
      const selected = workspace(cwd);
      const current = this.ready();
      if (current.revision !== expectedRevision) fail3("CONFLICT", "Skill policy changed; refresh before retrying");
      await noLinks(this.stateDir);
      await fs2.mkdir(this.stateDir, { recursive: true, mode: 448 });
      await noLinks(this.stateDir);
      const directory = await fs2.open(this.stateDir, constants3.O_RDONLY | constants3.O_DIRECTORY | constants3.O_NOFOLLOW);
      try {
        await directory.chmod(448);
      } finally {
        await directory.close();
      }
      const lockPath = join3(this.stateDir, ".skill-policy.lock");
      let lock;
      try {
        lock = await fs2.open(lockPath, constants3.O_WRONLY | constants3.O_CREAT | constants3.O_EXCL | constants3.O_NOFOLLOW, 384);
      } catch (error) {
        if (error.code === "EEXIST") fail3("BUSY", "Another skill policy writer is active; stale locks require manual review");
        throw error;
      }
      const lockStat = await lock.stat();
      let temp;
      try {
        await lock.writeFile(String(process.pid));
        const observed = await this.observe();
        if (this.diskHash !== null && observed.hash === null) fail3("CORRUPT_STATE", "Previously loaded skill policy disappeared; refusing to recreate it");
        if (observed.document.revision !== expectedRevision || observed.hash !== this.diskHash) fail3("CONFLICT", "Skill policy changed on disk; refusing to overwrite it");
        const rules = current.rules.map((rule) => ({ ...rule }));
        const existing = rules.find((rule) => rule.name === name2 && rule.cwd === selected);
        if (existing?.enabled === enabled) return;
        if (existing) existing.enabled = enabled;
        else rules.push({ name: name2, ...selected === void 0 ? {} : { cwd: selected }, enabled });
        if (rules.length > MAX_RULES || current.revision >= Number.MAX_SAFE_INTEGER) fail3("STATE_LIMIT", "Skill policy exceeds its safe limits");
        rules.sort((a, b) => a.name.localeCompare(b.name) || (a.cwd ?? "").localeCompare(b.cwd ?? ""));
        const next = { schemaVersion: 1, revision: current.revision + 1, rules };
        const raw = `${JSON.stringify(next)}
`;
        if (Buffer.byteLength(raw) > MAX_BYTES2) fail3("STATE_LIMIT", "Skill policy exceeds its size limit");
        temp = join3(this.stateDir, `.skill-policy-${randomUUID3()}.tmp`);
        const output = await fs2.open(temp, constants3.O_WRONLY | constants3.O_CREAT | constants3.O_EXCL | constants3.O_NOFOLLOW, 384);
        try {
          await output.chmod(384);
          await output.writeFile(raw);
          await output.sync();
        } finally {
          await output.close();
        }
        if ((await this.observe()).hash !== observed.hash) fail3("CONFLICT", "Skill policy changed before commit");
        await noLinks(this.stateDir);
        await fs2.rename(temp, this.path());
        temp = void 0;
        this.current = next;
        this.diskHash = digest(raw);
        this.notify();
      } finally {
        try {
          if (temp) await fs2.unlink(temp).catch((error) => {
            if (!missing2(error)) throw error;
          });
        } finally {
          await lock.close();
          const now = await fs2.lstat(lockPath).catch(() => void 0);
          if (now?.ino === lockStat.ino && now.dev === lockStat.dev) await fs2.unlink(lockPath);
        }
      }
    });
  }
};

// src/skill-policy-runtime.ts
var PROVIDER = "koishi-skill-policy";
async function quiesce(fiber) {
  await fiber.dispose();
  while (fiber.inertia) await fiber.inertia;
}
async function mountSkillPolicy(ctx, policy, options = {}) {
  policy.snapshot();
  const resolveCwd = options.resolveCwd ?? ((cwd) => cwd);
  let active = true;
  const registrations = /* @__PURE__ */ new Map();
  const controls = /* @__PURE__ */ new Set();
  let mappingRevision = options.mappingRevision?.();
  const invalidate = () => {
    for (const control of controls) if (!control.signal.aborted) control.invalidate();
  };
  const refreshMapping = () => {
    if (!options.mappingRevision) return;
    const revision2 = options.mappingRevision();
    if (revision2 === mappingRevision) return;
    mappingRevision = revision2;
    invalidate();
  };
  const isLive = (agent) => active && agent.ctx.fiber.uid !== null && ctx.agents.get(agent.id) === agent;
  const attach = async (agent) => {
    if (!isLive(agent)) return;
    const previous = registrations.get(agent);
    if (previous) return previous.ready;
    let dependency;
    let releaseOwner;
    let closing;
    let installed = false;
    const disposeChild = () => closing ??= (async () => {
      try {
        if (dependency) await quiesce(dependency);
      } finally {
        if (registrations.get(agent) === entry) registrations.delete(agent);
      }
    })();
    const entry = {
      ready: Promise.resolve(),
      close: async () => {
        await disposeChild();
        if (releaseOwner) await releaseOwner();
      }
    };
    registrations.set(agent, entry);
    entry.ready = (async () => {
      try {
        dependency = agent.ctx.inject(["skills"], (scoped) => {
          if (!active) return;
          const remove2 = scoped.skills.registerProvider((control) => {
            controls.add(control);
            control.signal.addEventListener("abort", () => {
              controls.delete(control);
            }, { once: true });
            return {
              name: PROVIDER,
              async list(lookup) {
                lookup.signal?.throwIfAborted();
                if (!active || control.signal.aborted) return [];
                const snapshot = policy.snapshot();
                const names = new Set(snapshot.rules.map((rule) => rule.name));
                const cwd = resolveCwd(lookup.cwd);
                const candidates = [];
                for (const name2 of names) if (!policy.isEnabled(name2, cwd)) candidates.push({
                  name: name2,
                  description: "Disabled in DSH",
                  invocation: { modelInvocable: false, userInvocable: false },
                  source: "custom",
                  provider: PROVIDER,
                  rank: -Number.MAX_VALUE,
                  locator: { name: name2, revision: snapshot.revision }
                });
                return candidates;
              },
              async get() {
                return void 0;
              }
            };
          });
          installed = true;
          scoped.effect(() => () => {
            installed = false;
          }, "koishi.skillPolicy.dependency");
          return remove2;
        });
        releaseOwner = agent.ctx.effect(() => disposeChild, "koishi.skillPolicy.agent");
        await dependency;
        if (!isLive(agent)) {
          await entry.close();
          return;
        }
        if (!installed) throw new Error("Skill policy dependency did not become ready");
      } catch (error) {
        const skip = !isLive(agent);
        await entry.close();
        if (!skip) throw error;
      }
    })();
    await entry.ready;
  };
  const unsubscribe = policy.subscribe(invalidate);
  const off = ctx.on("agent/created", async ({ agent, signal }) => {
    signal?.throwIfAborted();
    await attach(agent);
    signal?.throwIfAborted();
    return void 0;
  });
  const offDomain = ctx.on("domain/changed", (change) => {
    if (change.domain === "workspace") invalidate();
  });
  const offStep = ctx.on("agent/pre-step", (_payload, next) => {
    refreshMapping();
    return next();
  }, { prepend: true });
  const offTool = ctx.on("tools/pre-execute", (_execution, next) => {
    refreshMapping();
    return next();
  }, { prepend: true });
  let cleanup;
  const dispose = () => cleanup ??= (async () => {
    active = false;
    off();
    offDomain();
    offStep();
    offTool();
    unsubscribe();
    const entries = [...registrations.values()];
    const results = await Promise.allSettled(entries.map((entry) => entry.close()));
    registrations.clear();
    controls.clear();
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  })();
  const remove = ctx.effect(() => dispose, "koishi.skillPolicy");
  try {
    for (const agent of ctx.agents.list()) await attach(agent);
  } catch (error) {
    await dispose();
    await remove();
    throw error;
  }
  return async () => {
    await dispose();
    await remove();
  };
}

// src/index.ts
var name = MANAGER_ID;
var inject = ["webServer", "connection", "tools", "credentials", "approval", "workspaceRegistry", "configEditor", "agents", "skills", "pluginManager", "workingDirectory"];
var Config = z.object({ stateDir: z.string().default("") });
function boundedValue(value) {
  if (Array.isArray(value) && value.length > 100) return { items: value.slice(0, 100), total: value.length, truncated: true, note: "Use the Settings manager to browse the complete list." };
  if (value && typeof value === "object" && typeof value.content === "string") {
    const v = value;
    if (v.content.length > 16e3) return { ...v, content: v.content.slice(0, 16e3), truncated: true, note: "Open the Settings manager for the complete skill body." };
  }
  return value;
}
async function apply(ctx, config = {}) {
  const dshHome = process.env.DSH_HOME || join4(homedir2(), ".dsh");
  const stateDir = config.stateDir || join4(dirname3(ctx.configEditor.documentPath), "data", MANAGER_ID);
  if (!isAbsolute5(stateDir)) throw new Error("stateDir must be absolute");
  const skills = new SkillsManager({ stateDir: join4(stateDir, "skills"), dshHome, agentsHome: process.env.DSH_AGENTS_HOME || join4(homedir2(), ".agents"), workspacePaths: () => workspaces(ctx).map((w) => w.path) });
  const policy = new SkillPolicyStore({ stateDir });
  await policy.load();
  await mountSkillPolicy(ctx, policy, {
    resolveCwd: (cwd) => policyWorkspace(ctx, cwd),
    mappingRevision: () => JSON.stringify(workspaces(ctx).map((w) => w.path).sort())
  });
  const mcp = new McpManager({
    stateDir,
    legacyPath: join4(dshHome, "mcp.json"),
    resolveCredential: async (ref) => (await ctx.credentials.resolve(ref))?.value,
    nativeServers: () => nativeServers(ctx),
    nativeSetEnabled: (id, enabled) => setNativeMcpEnabled(ctx, id, enabled),
    connect: (server, resolved, probe) => connectMcp(ctx, server, resolved, probe)
  });
  const service = new ManagerService({ skills, policy, mcp, workspaces: () => workspaces(ctx) });
  ctx.provide("koishiSkillsMcpManager", service);
  ctx.effect(() => ctx.webServer.register(makeRoute({ service, requestRejection: (req) => ctx.connection.requestRejection(req) })), "koishi manager authenticated route");
  ctx.effect(() => () => mcp.dispose(), "koishi manager connections");
  ctx.tools.register({
    name: MANAGER_TOOL,
    description: "Browse or manage local skills and MCP connections. Start with workspaces, skills.list or mcp.list; mutations require a fresh list revision and approval. Skills switches change DSH-only visibility without editing source files; workspace rules override profile defaults. Trash is recoverable. Native MCP entries support toggling but not editing or deleting. MCP secrets must be existing credential/environment references, never literal values. Settings \u2192 Skills & MCP provides the same operations.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["workspaces", "skills.list", "skills.read", "skills.toggle", "skills.trash", "skills.scan", "skills.import", "trash.list", "trash.restore", "mcp.list", "mcp.save", "mcp.toggle", "mcp.delete", "mcp.test"] },
        cwd: { type: "string", description: "Exact registered workspace path; omit for user-level skills." },
        id: { type: "string", description: "Object id returned by the corresponding list." },
        revision: { oneOf: [{ type: "string" }, { type: "integer" }], description: "Skill list revision or the MCP list revision. Required for toggle, trash, save and delete." },
        enabled: { type: "boolean" },
        dir: { type: "string", description: "Directory explicitly selected for a read-only import scan." },
        items: { type: "array", items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, revision: { type: "string" } }, required: ["id", "revision"] }, description: "Up to 100 items returned by skills.scan." },
        server: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, name: { type: "string" }, transport: { type: "string", enum: ["stdio", "streamable-http"] }, enabled: { type: "boolean" }, command: { type: "string" }, args: { type: "array", items: { type: "string" } }, cwd: { type: "string" }, url: { type: "string" }, envRefs: { type: "object", description: "Child environment names mapped to credential/environment reference names." }, headerRefs: { type: "object", description: "Header names mapped to references containing complete header values." } }, required: ["name", "transport", "enabled"] }
      },
      required: ["action"]
    },
    output: { schema: {}, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    isConcurrencySafe: (args) => {
      try {
        return !requiresApproval(parseRequest(args).action);
      } catch {
        return false;
      }
    },
    async execute(args, exec) {
      const request = parseRequest(args);
      if (requiresApproval(request.action)) {
        if (!exec.agent) throw new ManagerError("APPROVAL_REQUIRED", "A live agent and explicit approval are required");
        const outcome = await ctx.approval.request({ agent: exec.agent, toolName: MANAGER_TOOL, callId: exec.callId, signal: exec.signal, reason: `Manage skills/MCP: ${request.action}`, displayReason: { en: "This operation changes local skills/MCP state or launches a connection probe.", zh: "\u6B64\u64CD\u4F5C\u5C06\u4FEE\u6539\u672C\u5730\u6280\u80FD/MCP \u72B6\u6001\uFF0C\u6216\u542F\u52A8\u771F\u5B9E\u8FDE\u63A5\u6D4B\u8BD5\u3002" } });
        if (outcome !== "allowed-once") throw new ManagerError("APPROVAL_REQUIRED", "Operation was not approved; use the manager UI or ask the user to change approval policy");
      }
      try {
        const actorCwd = request.action === "skills.read" && exec.agent ? policyWorkspace(ctx, await ctx.workingDirectory.ensure(exec.agent, exec.signal)) : void 0;
        return JSON.parse(JSON.stringify(boundedValue(await service.execute(request, exec.signal, "agent", actorCwd)) ?? null));
      } catch (error) {
        const safe = safeError(error);
        throw new ManagerError(safe.code, safe.message);
      }
    }
  });
  await mcp.reload();
}
export {
  Config,
  apply,
  boundedValue,
  inject,
  name
};
