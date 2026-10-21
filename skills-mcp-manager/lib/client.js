window.__ModuleLoader__.load({
  id: "@koishi/dsh-skills-mcp-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/locales.ts
var en = {
  title: "Skills & MCP",
  description: "Control DSH skill availability and MCP connections; keep source files unchanged when switching skills.",
  skills: "Skills",
  mcp: "MCP servers",
  workspace: "Skill workspace",
  global: "Global (user skills only)",
  workspaceHint: "Choose a scope explicitly: Global skill switches set this DSH profile\u2019s default; a selected workspace overrides that default only for that workspace, regardless of skill source. MCP configuration is always global.",
  refresh: "Refresh",
  loading: "Loading\u2026",
  empty: "No items found.",
  search: "Search names\u2026",
  all: "All",
  enabled: "Enabled",
  disabled: "Disabled",
  details: "Details",
  hide: "Hide",
  readOnly: "Source file read-only",
  when: "When to use",
  dshEnabled: "Enabled in DSH",
  dshDisabled: "Disabled in DSH",
  switchSupported: "Switching supported",
  skillPolicyHint: "Skill switches affect only the current DSH scope, without changing source files or links. Disabled skills are removed from subsequent model skill catalogs and agent loading entry points, not existing conversation history. Re-enabling does not override a source-level disabled policy. The manager can still preview disabled skills; this is not a security sandbox.",
  toggleConfirm: "Change availability only in the current DSH scope? No source files or links are modified. Disabling removes the skill from subsequent model skill catalogs and agent loading entry points; existing conversation history is not cleared. Re-enabling does not override the source\u2019s own disabled policy.",
  sourceDisabledHint: "The source policy disables this skill. A DSH-only enable cannot override it; the server will reject enabling until the source policy allows it.",
  trash: "Move to trash",
  trashConfirm: "Move this skill to recoverable trash?",
  trashTitle: "Recoverable trash",
  restore: "Restore",
  importTitle: "Import skills",
  directory: "Source directory",
  chooseDirectory: "Choose folder",
  scan: "Scan directory",
  importHint: "Choose a directory, scan, then select skills to copy. Existing destinations are never overwritten.",
  importSelected: "Import selected",
  selectFirst: "Select at least one scanned skill.",
  noDirectory: "Choose a source directory first.",
  imported: "Import results",
  importOk: "Imported",
  importFailed: "Not imported",
  project: "Project",
  user: "User",
  bundle: "Directory",
  file: "File",
  source: "Source",
  native: "Native \xB7 configuration read-only",
  managed: "Managed",
  loadingStatus: "Loading",
  loaded: "Tools loaded (not a health check)",
  failed: "Failed",
  stopped: "Stopped",
  external: "External / native",
  tools: "Tools",
  statusHint: "Loaded means tool discovery completed; it does not prove ongoing server health.",
  legacy: "Legacy configuration is available. It is not imported or overwritten automatically.",
  edit: "Edit",
  remove: "Delete",
  removeConfirm: "Delete this managed MCP configuration?",
  formTitle: "New / edit MCP server",
  name: "Name",
  transport: "Transport",
  command: "Local command",
  args: "Arguments (one per line)",
  cwd: "Working directory",
  url: "URL",
  envRefs: "Environment references (KEY=REFERENCE, one per line)",
  headerRefs: "Header references (HEADER=REFERENCE, one per line)",
  referencesHint: "Enter environment variable names or DSH credential references only, never secret values. Header reference results are used literally; no Bearer prefix is added.",
  commandHint: "Commands, arguments and URLs must not contain secrets. New servers are saved disabled by default.",
  enableOnSave: "Enable on save",
  save: "Save",
  saving: "Saving\u2026",
  reset: "New / reset",
  test: "Test connection",
  testing: "Testing\u2026",
  enableConfirm: "Enabling connects this server. A stdio server runs its local command with your user permissions. Continue?",
  testConfirm: "Testing connects this server now, even if disabled. A stdio server runs its local command with your user permissions. Continue?",
  saved: "Saved.",
  testOk: "Connection test passed (point-in-time only).",
  testFailed: "Connection test failed.",
  invalidRefs: "Every reference line must have a nonempty unique KEY=REFERENCE. Do not enter secret values.",
  required: "Name and command / URL are required.",
  error: "Operation failed",
  unknownError: "Unknown error"
};
var zh = {
  title: "\u6280\u80FD\u4E0E MCP",
  description: "\u63A7\u5236 DSH \u6280\u80FD\u53EF\u7528\u6027\u4E0E MCP \u8FDE\u63A5\uFF1B\u6280\u80FD\u542F\u505C\u4E0D\u4FEE\u6539\u6E90\u6587\u4EF6\u3002",
  skills: "\u6280\u80FD",
  mcp: "MCP \u670D\u52A1\u5668",
  workspace: "\u6280\u80FD\u5DE5\u4F5C\u533A",
  global: "\u5168\u5C40\uFF08\u4EC5\u7528\u6237\u7EA7\u6280\u80FD\uFF09",
  workspaceHint: "\u8BF7\u663E\u5F0F\u9009\u62E9\u8303\u56F4\uFF1A\u5168\u5C40\u6280\u80FD\u5F00\u5173\u8BBE\u7F6E\u672C DSH profile \u7684\u9ED8\u8BA4\u7B56\u7565\uFF1B\u9009\u5B9A\u5DE5\u4F5C\u533A\u7684\u5F00\u5173\u4EC5\u8986\u76D6\u8BE5\u5DE5\u4F5C\u533A\uFF0C\u4E0E\u6280\u80FD\u6765\u6E90\u65E0\u5173\u3002MCP \u914D\u7F6E\u59CB\u7EC8\u4E3A\u5168\u5C40\u3002",
  refresh: "\u5237\u65B0",
  loading: "\u52A0\u8F7D\u4E2D\u2026",
  empty: "\u672A\u53D1\u73B0\u6761\u76EE\u3002",
  search: "\u641C\u7D22\u540D\u79F0\u2026",
  all: "\u5168\u90E8",
  enabled: "\u5DF2\u542F\u7528",
  disabled: "\u5DF2\u7981\u7528",
  details: "\u8BE6\u60C5",
  hide: "\u6536\u8D77",
  readOnly: "\u6E90\u6587\u4EF6\u53EA\u8BFB",
  when: "\u9002\u7528\u65F6\u673A",
  dshEnabled: "DSH \u5DF2\u542F\u7528",
  dshDisabled: "DSH \u5DF2\u505C\u7528",
  switchSupported: "\u652F\u6301\u542F\u505C",
  skillPolicyHint: "\u6280\u80FD\u542F\u505C\u4EC5\u5F71\u54CD\u5F53\u524D DSH \u8303\u56F4\uFF0C\u4E0D\u4FEE\u6539\u6E90\u6587\u4EF6\u6216\u94FE\u63A5\u3002\u505C\u7528\u540E\u4ECE\u540E\u7EED\u6A21\u578B\u6280\u80FD\u76EE\u5F55\u4E0E Agent \u52A0\u8F7D\u5165\u53E3\u79FB\u9664\uFF0C\u4E0D\u6E05\u7406\u5DF2\u6709\u5BF9\u8BDD\u5386\u53F2\uFF1B\u91CD\u65B0\u542F\u7528\u4E0D\u8986\u76D6\u6E90\u672C\u8EAB\u7684\u7981\u7528\u7B56\u7565\u3002\u7BA1\u7406\u5668\u4ECD\u53EF\u9884\u89C8\u5DF2\u505C\u7528\u6280\u80FD\uFF1B\u8FD9\u4E0D\u662F\u5B89\u5168\u6C99\u7BB1\u3002",
  toggleConfirm: "\u4EC5\u4FEE\u6539\u5F53\u524D DSH \u8303\u56F4\u7684\u53EF\u7528\u6027\uFF1F\u4E0D\u4F1A\u4FEE\u6539\u6E90\u6587\u4EF6\u6216\u94FE\u63A5\u3002\u505C\u7528\u540E\u4ECE\u540E\u7EED\u6A21\u578B\u6280\u80FD\u76EE\u5F55\u4E0E Agent \u52A0\u8F7D\u5165\u53E3\u79FB\u9664\uFF0C\u4E0D\u6E05\u7406\u5DF2\u6709\u5BF9\u8BDD\u5386\u53F2\uFF1B\u91CD\u65B0\u542F\u7528\u4E0D\u8986\u76D6\u6E90\u672C\u8EAB\u7684\u7981\u7528\u7B56\u7565\u3002",
  sourceDisabledHint: "\u6E90\u7B56\u7565\u5DF2\u7981\u7528\u6B64\u6280\u80FD\uFF1BDSH \u542F\u7528\u4E0D\u80FD\u8986\u76D6\u8BE5\u9650\u5236\u3002\u6E90\u7B56\u7565\u5141\u8BB8\u524D\uFF0C\u670D\u52A1\u5668\u4F1A\u62D2\u7EDD\u542F\u7528\u3002",
  trash: "\u79FB\u5165\u56DE\u6536\u7AD9",
  trashConfirm: "\u5C06\u6B64\u6280\u80FD\u79FB\u5165\u53EF\u6062\u590D\u7684\u56DE\u6536\u7AD9\uFF1F",
  trashTitle: "\u53EF\u6062\u590D\u56DE\u6536\u7AD9",
  restore: "\u6062\u590D",
  importTitle: "\u5BFC\u5165\u6280\u80FD",
  directory: "\u6E90\u76EE\u5F55",
  chooseDirectory: "\u9009\u62E9\u6587\u4EF6\u5939",
  scan: "\u626B\u63CF\u76EE\u5F55",
  importHint: "\u9009\u62E9\u76EE\u5F55\u3001\u626B\u63CF\uFF0C\u518D\u52FE\u9009\u9700\u8981\u590D\u5236\u7684\u6280\u80FD\u3002\u4E0D\u4F1A\u8986\u76D6\u5DF2\u6709\u76EE\u6807\u3002",
  importSelected: "\u5BFC\u5165\u9009\u4E2D",
  selectFirst: "\u8BF7\u5148\u9009\u62E9\u626B\u63CF\u5230\u7684\u6280\u80FD\u3002",
  noDirectory: "\u8BF7\u5148\u9009\u62E9\u6E90\u76EE\u5F55\u3002",
  imported: "\u5BFC\u5165\u7ED3\u679C",
  importOk: "\u5DF2\u5BFC\u5165",
  importFailed: "\u672A\u5BFC\u5165",
  project: "\u9879\u76EE\u7EA7",
  user: "\u7528\u6237\u7EA7",
  bundle: "\u76EE\u5F55",
  file: "\u6587\u4EF6",
  source: "\u6765\u6E90",
  native: "\u539F\u751F \xB7 \u914D\u7F6E\u53EA\u8BFB",
  managed: "\u6258\u7BA1",
  loadingStatus: "\u52A0\u8F7D\u4E2D",
  loaded: "\u5DE5\u5177\u5DF2\u52A0\u8F7D\uFF08\u975E\u5065\u5EB7\u68C0\u67E5\uFF09",
  failed: "\u5931\u8D25",
  stopped: "\u5DF2\u505C\u6B62",
  external: "\u5916\u90E8 / \u539F\u751F",
  tools: "\u5DE5\u5177\u6570",
  statusHint: "\u5DF2\u52A0\u8F7D\u8868\u793A\u5DE5\u5177\u53D1\u73B0\u5B8C\u6210\uFF0C\u4E0D\u4EE3\u8868\u670D\u52A1\u5668\u6301\u7EED\u5065\u5EB7\u3002",
  legacy: "\u5B58\u5728\u65E7\u7248\u914D\u7F6E\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u5BFC\u5165\u6216\u8986\u76D6\u3002",
  edit: "\u7F16\u8F91",
  remove: "\u5220\u9664",
  removeConfirm: "\u5220\u9664\u6B64\u6258\u7BA1 MCP \u914D\u7F6E\uFF1F",
  formTitle: "\u65B0\u5EFA / \u7F16\u8F91 MCP \u670D\u52A1\u5668",
  name: "\u540D\u79F0",
  transport: "\u4F20\u8F93\u65B9\u5F0F",
  command: "\u672C\u5730\u547D\u4EE4",
  args: "\u53C2\u6570\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09",
  cwd: "\u5DE5\u4F5C\u76EE\u5F55",
  url: "URL",
  envRefs: "\u73AF\u5883\u53D8\u91CF\u5F15\u7528\uFF08KEY=REFERENCE\uFF0C\u6BCF\u884C\u4E00\u4E2A\uFF09",
  headerRefs: "\u8BF7\u6C42\u5934\u5F15\u7528\uFF08HEADER=REFERENCE\uFF0C\u6BCF\u884C\u4E00\u4E2A\uFF09",
  referencesHint: "\u4EC5\u586B\u5199\u73AF\u5883\u53D8\u91CF\u540D\u6216 DSH \u51ED\u8BC1\u5F15\u7528\uFF0C\u7981\u6B62\u586B\u5165\u79D8\u5BC6\u503C\u3002\u8BF7\u6C42\u5934\u4F7F\u7528\u5F15\u7528\u6240\u5F97\u7684\u5B8C\u6574\u5B57\u9762\u503C\uFF0C\u4E0D\u81EA\u52A8\u62FC\u63A5 Bearer \u524D\u7F00\u3002",
  commandHint: "\u547D\u4EE4\u3001\u53C2\u6570\u4E0E URL \u4E2D\u4E5F\u4E0D\u5F97\u5305\u542B\u79D8\u5BC6\u3002\u65B0\u589E\u670D\u52A1\u5668\u9ED8\u8BA4\u7981\u7528\u4FDD\u5B58\u3002",
  enableOnSave: "\u4FDD\u5B58\u65F6\u542F\u7528",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  reset: "\u65B0\u5EFA / \u91CD\u7F6E",
  test: "\u6D4B\u8BD5\u8FDE\u63A5",
  testing: "\u6D4B\u8BD5\u4E2D\u2026",
  enableConfirm: "\u542F\u7528\u5C06\u5EFA\u7ACB\u8FDE\u63A5\u3002stdio \u670D\u52A1\u5668\u4F1A\u4EE5\u4F60\u7684\u7528\u6237\u6743\u9650\u8FD0\u884C\u672C\u5730\u547D\u4EE4\u3002\u662F\u5426\u7EE7\u7EED\uFF1F",
  testConfirm: "\u6D4B\u8BD5\u4F1A\u7ACB\u5373\u5EFA\u7ACB\u8FDE\u63A5\uFF0C\u5373\u4F7F\u670D\u52A1\u5668\u5C1A\u672A\u542F\u7528\uFF1Bstdio \u670D\u52A1\u5668\u4F1A\u4EE5\u4F60\u7684\u7528\u6237\u6743\u9650\u8FD0\u884C\u672C\u5730\u547D\u4EE4\u3002\u662F\u5426\u7EE7\u7EED\uFF1F",
  saved: "\u5DF2\u4FDD\u5B58\u3002",
  testOk: "\u8FDE\u63A5\u6D4B\u8BD5\u901A\u8FC7\uFF08\u4EC5\u4EE3\u8868\u6B64\u523B\uFF09\u3002",
  testFailed: "\u8FDE\u63A5\u6D4B\u8BD5\u5931\u8D25\u3002",
  invalidRefs: "\u6BCF\u884C\u5FC5\u987B\u662F\u975E\u7A7A\u4E14\u952E\u4E0D\u91CD\u590D\u7684 KEY=REFERENCE\uFF1B\u8BF7\u52FF\u586B\u5199\u79D8\u5BC6\u503C\u3002",
  required: "\u5FC5\u987B\u586B\u5199\u540D\u79F0\u53CA\u547D\u4EE4 / URL\u3002",
  error: "\u64CD\u4F5C\u5931\u8D25",
  unknownError: "\u672A\u77E5\u9519\u8BEF"
};

// src/client/manager.tsx
var import_react = require("react");

// src/protocol.ts
var MANAGER_API = "/api/koishi-skills-mcp/action";

// src/client/api.ts
var SkillsMcpApiError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "SkillsMcpApiError";
  }
};
var SkillsMcpApi = class {
  async request(request) {
    const response = await fetch(MANAGER_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new SkillsMcpApiError("INVALID_RESPONSE", `HTTP ${response.status}`);
    }
    if (body?.ok === false && body.error && typeof body.error.message === "string") {
      throw new SkillsMcpApiError(body.error.code, body.error.message);
    }
    if (!response.ok || body?.ok !== true) throw new SkillsMcpApiError("INVALID_RESPONSE", `HTTP ${response.status}`);
    return body.value;
  }
  workspaces() {
    return this.request({ action: "workspaces" });
  }
  listSkills(cwd) {
    return this.request({ action: "skills.list", cwd });
  }
  readSkill(cwd, skill) {
    return this.request({ action: "skills.read", cwd, id: skill.id, revision: skill.revision });
  }
  toggleSkill(cwd, skill, enabled) {
    return this.request({ action: "skills.toggle", cwd, id: skill.id, revision: skill.revision, enabled });
  }
  trashSkill(cwd, skill) {
    return this.request({ action: "skills.trash", cwd, id: skill.id, revision: skill.revision });
  }
  scanSkills(cwd, dir) {
    return this.request({ action: "skills.scan", cwd, dir });
  }
  importSkills(cwd, items) {
    return this.request({ action: "skills.import", cwd, items });
  }
  listTrash(cwd) {
    return this.request({ action: "trash.list", cwd });
  }
  restoreTrash(cwd, id) {
    return this.request({ action: "trash.restore", cwd, id });
  }
  listMcp() {
    return this.request({ action: "mcp.list" });
  }
  saveMcp(server, revision) {
    return this.request({ action: "mcp.save", server, revision });
  }
  setMcpEnabled(id, enabled, revision) {
    return this.request({ action: "mcp.toggle", id, enabled, revision });
  }
  deleteMcp(id, revision) {
    return this.request({ action: "mcp.delete", id, revision });
  }
  testMcp(server) {
    return this.request({ action: "mcp.test", server });
  }
};

// src/client/form.ts
var emptyForm = () => ({
  name: "",
  transport: "stdio",
  enabled: false,
  command: "",
  args: "",
  cwd: "",
  url: "",
  envRefs: "",
  headerRefs: ""
});
function refsText(refs) {
  return Object.entries(refs || {}).map(([key, value]) => `${key}=${value}`).join("\n");
}
function parseRefs(text, t) {
  const result = /* @__PURE__ */ Object.create(null);
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const at = line.indexOf("=");
    const key = line.slice(0, at).trim(), value = line.slice(at + 1).trim();
    if (at <= 0 || !key || !value || Object.hasOwn(result, key)) throw new Error(t("invalidRefs"));
    result[key] = value;
  }
  return result;
}
function buildMcpServer(form, t) {
  if (!form.name.trim() || !(form.transport === "stdio" ? form.command.trim() : form.url.trim())) throw new Error(t("required"));
  const base = {
    ...form.id ? { id: form.id } : {},
    name: form.name.trim(),
    transport: form.transport,
    enabled: form.enabled
  };
  if (form.transport === "streamable-http") return { ...base, url: form.url.trim(), headerRefs: parseRefs(form.headerRefs, t) };
  const cwd = form.cwd.trim();
  return {
    ...base,
    command: form.command.trim(),
    args: form.args.split("\n").filter((value) => value !== ""),
    ...cwd ? { cwd } : {},
    envRefs: parseRefs(form.envRefs, t)
  };
}

// src/client/capabilities.ts
function skillCapabilities(skill) {
  return {
    toggle: skill.toggleable ?? skill.writable,
    trash: skill.writable,
    sourceDisabled: skill.sourceEnabled === false
  };
}
function mcpCapabilities(server) {
  const writable = server.writable && server.source === "managed";
  return {
    toggle: !server.cleanupPending && (server.toggleable ?? server.writable),
    edit: writable && !server.cleanupPending,
    remove: writable
  };
}

// src/client/settings-card.module.css
var settings_card_default = {
  sectionPage: "settings_card_sectionPage",
  pageHeading: "settings_card_pageHeading",
  manager: "settings_card_manager",
  panel: "settings_card_panel",
  section: "settings_card_section",
  form: "settings_card_form",
  tabs: "settings_card_tabs",
  tab: "settings_card_tab",
  tabActive: "settings_card_tabActive",
  h: "settings_card_h",
  hGrow: "settings_card_hGrow",
  inline: "settings_card_inline",
  row: "settings_card_row",
  main: "settings_card_main",
  name: "settings_card_name",
  desc: "settings_card_desc",
  note: "settings_card_note",
  fieldName: "settings_card_fieldName",
  error: "settings_card_error",
  switch: "settings_card_switch",
  btn: "settings_card_btn",
  btnPrimary: "settings_card_btnPrimary",
  btnDanger: "settings_card_btnDanger",
  input: "settings_card_input",
  inputGrow: "settings_card_inputGrow",
  filterSelect: "settings_card_filterSelect",
  fieldLabel: "settings_card_fieldLabel",
  detail: "settings_card_detail",
  pre: "settings_card_pre"
};

// src/client/manager.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var api = new SkillsMcpApi();
var errorText = (error) => error instanceof Error ? error.message : String(error);
function useResource(loader) {
  const [state, setState] = (0, import_react.useState)({ loading: true, error: "" });
  const serial = (0, import_react.useRef)(0);
  const reload = (0, import_react.useCallback)(async () => {
    const request = ++serial.current;
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const value = await loader();
      if (request === serial.current) setState({ value, loading: false, error: "" });
    } catch (error) {
      if (request === serial.current) setState({ loading: false, error: errorText(error) });
    }
  }, [loader]);
  (0, import_react.useEffect)(() => {
    void reload();
    return () => {
      serial.current++;
    };
  }, [reload]);
  return { ...state, reload };
}
function useOperation() {
  const lock = (0, import_react.useRef)(false);
  const mounted = (0, import_react.useRef)(true);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [message, setMessage] = (0, import_react.useState)("");
  (0, import_react.useEffect)(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (operation) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await operation();
    } catch (error) {
      if (mounted.current) setMessage(errorText(error));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { busy, message, setMessage, run };
}
function SkillsMcpManager({ t, pickDirectory }) {
  const [tab, setTab] = (0, import_react.useState)("skills");
  const [cwd, setCwd] = (0, import_react.useState)("");
  const workspaces = useResource((0, import_react.useCallback)(() => api.workspaces(), []));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.manager, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: settings_card_default.tabs, role: "tablist", "aria-label": t("title"), children: ["skills", "mcp"].map((key) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        role: "tab",
        "aria-selected": tab === key,
        className: tab === key ? settings_card_default.tabActive : settings_card_default.tab,
        onClick: () => setTab(key),
        children: t(key)
      },
      key
    )) }),
    tab === "skills" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: settings_card_default.fieldLabel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("workspace") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { className: settings_card_default.input, value: cwd, onChange: (event) => setCwd(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "", children: t("global") }),
          (workspaces.value || []).map((workspace) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: workspace.path, children: [
            workspace.title,
            " \xB7 ",
            workspace.path
          ] }, workspace.id))
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: settings_card_default.note, children: t("workspaceHint") }),
      workspaces.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorMessage, { message: workspaces.error, t }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { className: settings_card_default.btn, type: "button", disabled: workspaces.loading, onClick: () => void workspaces.reload(), children: [
        t("refresh"),
        " \xB7 ",
        t("workspace")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkillsPanel, { cwd, t, pickDirectory }, cwd)
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(McpPanel, { t })
  ] });
}
function SkillsPanel({ cwd, t, pickDirectory }) {
  const skills = useResource((0, import_react.useCallback)(() => api.listSkills(cwd), [cwd]));
  const trash = useResource((0, import_react.useCallback)(() => api.listTrash(cwd), [cwd]));
  const op = useOperation();
  const [query, setQuery] = (0, import_react.useState)("");
  const [filter, setFilter] = (0, import_react.useState)("all");
  const [detail, setDetail] = (0, import_react.useState)(null);
  const detailSerial = (0, import_react.useRef)(0);
  (0, import_react.useEffect)(() => () => {
    detailSerial.current++;
  }, []);
  const [dir, setDir] = (0, import_react.useState)("");
  const [scanned, setScanned] = (0, import_react.useState)(null);
  const [selected, setSelected] = (0, import_react.useState)(/* @__PURE__ */ new Set());
  const [results, setResults] = (0, import_react.useState)([]);
  const refresh = async () => {
    detailSerial.current++;
    setDetail(null);
    await Promise.all([skills.reload(), trash.reload()]);
  };
  const view = async (skill) => {
    const request = ++detailSerial.current;
    if (detail?.id === skill.id) {
      setDetail(null);
      return;
    }
    setDetail({ id: skill.id });
    try {
      const value = await api.readSkill(cwd, skill);
      if (request === detailSerial.current) setDetail({ id: skill.id, value });
    } catch (error) {
      if (request === detailSerial.current) setDetail({ id: skill.id, error: errorText(error) });
    }
  };
  const changeDir = (value) => {
    setDir(value);
    setScanned(null);
    setSelected(/* @__PURE__ */ new Set());
    setResults([]);
  };
  const items = (skills.value || []).filter((skill) => skill.name.toLowerCase().includes(query.trim().toLowerCase()) && (filter === "all" || filter === "enabled" === skill.enabled));
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: settings_card_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.inline, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: settings_card_default.hGrow, children: t("skills") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: settings_card_default.btn, disabled: op.busy || skills.loading, onClick: () => void refresh(), children: t("refresh") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: settings_card_default.note, children: t("skillPolicyHint") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.inline, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { className: settings_card_default.inputGrow, "aria-label": t("search"), placeholder: t("search"), value: query, onChange: (e) => setQuery(e.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", { className: settings_card_default.filterSelect, "aria-label": t("enabled"), value: filter, onChange: (e) => setFilter(e.target.value), children: ["all", "enabled", "disabled"].map((key) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: key, children: t(key) }, key)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorMessage, { message: op.message || skills.error, t }),
      skills.loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: t("loading") }) : items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("empty") }) : items.map((skill) => {
        const capabilities = skillCapabilities(skill);
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.row, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.main, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: settings_card_default.name, children: skill.name }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: settings_card_default.desc, children: skill.description }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.note, children: [
                t(skill.level),
                " \xB7 ",
                skill.source,
                " \xB7 ",
                skill.path
              ] }),
              !skill.writable ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.note, children: [
                t("readOnly"),
                skill.readOnlyReason ? ` \xB7 ${skill.readOnlyReason}` : ""
              ] }) : null,
              capabilities.sourceDisabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: settings_card_default.note, children: t("sourceDisabledHint") }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: settings_card_default.switch, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "input",
                {
                  type: "checkbox",
                  role: "switch",
                  "aria-checked": skill.enabled,
                  "aria-label": `${t("dshEnabled")} \xB7 ${skill.name}`,
                  checked: skill.enabled,
                  disabled: op.busy || !capabilities.toggle,
                  onChange: () => {
                    if (!capabilities.toggle || !window.confirm(t("toggleConfirm"))) return;
                    void op.run(async () => {
                      await api.toggleSkill(cwd, skill, !skill.enabled);
                      setDetail(null);
                      await refresh();
                    });
                  }
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t(skill.enabled ? "dshEnabled" : "dshDisabled") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: settings_card_default.btn, type: "button", onClick: () => void view(skill), children: t(detail?.id === skill.id ? "hide" : "details") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: settings_card_default.btnDanger, type: "button", disabled: op.busy || !capabilities.trash, onClick: () => {
              if (capabilities.trash && window.confirm(t("trashConfirm"))) void op.run(async () => {
                await api.trashSkill(cwd, skill);
                setDetail(null);
                await refresh();
              });
            }, children: t("trash") })
          ] }),
          detail?.id === skill.id ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: settings_card_default.detail, children: detail.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorMessage, { message: detail.error, t }) : detail.value ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.note, children: [
              t("when"),
              ": ",
              detail.value.whenToUse
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { className: settings_card_default.pre, children: detail.value.content })
          ] }) : t("loading") }) : null
        ] }, skill.id);
      })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: settings_card_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: settings_card_default.h, children: t("importTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: settings_card_default.note, children: t("importHint") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.inline, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { className: settings_card_default.inputGrow, "aria-label": t("directory"), value: dir, disabled: op.busy, placeholder: t("directory"), onChange: (e) => changeDir(e.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: settings_card_default.btn, type: "button", disabled: op.busy, onClick: () => void op.run(async () => {
          const path = await pickDirectory();
          if (path) changeDir(path);
        }), children: t("chooseDirectory") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: settings_card_default.btn, type: "button", disabled: op.busy, onClick: () => void op.run(async () => {
          if (!dir.trim()) throw new Error(t("noDirectory"));
          setScanned(null);
          setSelected(/* @__PURE__ */ new Set());
          setResults([]);
          setScanned(await api.scanSkills(cwd, dir.trim()));
        }), children: t("scan") })
      ] }),
      scanned?.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("empty") }) : scanned?.map((skill) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: settings_card_default.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", disabled: op.busy, checked: selected.has(skill.id), onChange: (e) => setSelected((previous) => {
          const next = new Set(previous);
          if (e.target.checked) next.add(skill.id);
          else next.delete(skill.id);
          return next;
        }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: settings_card_default.main, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: settings_card_default.name, children: [
            skill.name,
            " \xB7 ",
            t(skill.kind)
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: settings_card_default.note, children: [
            " ",
            skill.sourcePath
          ] })
        ] })
      ] }, skill.id)),
      scanned?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { className: settings_card_default.btn, type: "button", disabled: op.busy || !selected.size, onClick: () => void op.run(async () => {
        const chosen = scanned.filter((skill) => selected.has(skill.id)).map(({ id, revision }) => ({ id, revision }));
        if (!chosen.length) throw new Error(t("selectFirst"));
        setResults(await api.importSkills(cwd, chosen));
        setSelected(/* @__PURE__ */ new Set());
        setScanned(null);
        await refresh();
      }), children: [
        t("importSelected"),
        " (",
        selected.size,
        ")"
      ] }) : null,
      results.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { role: "status", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { className: settings_card_default.h, children: t("imported") }),
        results.map((result, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          result.name,
          ": ",
          t(result.ok ? "importOk" : "importFailed"),
          result.reason ? ` \xB7 ${result.reason}` : ""
        ] }, index))
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: settings_card_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: settings_card_default.h, children: t("trashTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorMessage, { message: trash.error, t }),
      trash.loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("loading") }) : !trash.value?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("empty") }) : trash.value.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.row, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.main, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: settings_card_default.name, children: item.name }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.note, children: [
            item.originalPath,
            " \xB7 ",
            item.deletedAt
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: settings_card_default.btn, disabled: op.busy, onClick: () => void op.run(async () => {
          await api.restoreTrash(cwd, item.id);
          await refresh();
        }), children: t("restore") })
      ] }, item.id))
    ] })
  ] });
}
var statusKeys = {
  loading: "loadingStatus",
  loaded: "loaded",
  failed: "failed",
  stopped: "stopped",
  external: "external"
};
function McpPanel({ t }) {
  const list = useResource((0, import_react.useCallback)(() => api.listMcp(), []));
  const op = useOperation();
  const [form, setForm] = (0, import_react.useState)(emptyForm);
  const [query, setQuery] = (0, import_react.useState)("");
  const [note, setNote] = (0, import_react.useState)("");
  const patch = (change) => {
    setForm((previous) => ({ ...previous, ...change }));
    setNote("");
  };
  const edit = (server) => {
    if (!mcpCapabilities(server).edit || !list.value) return;
    setForm({
      id: server.id,
      revision: list.value.revision,
      name: server.name,
      transport: server.transport,
      enabled: server.enabled,
      command: server.command || "",
      args: (server.args || []).join("\n"),
      cwd: server.cwd || "",
      url: server.url || "",
      envRefs: refsText(server.envRefs),
      headerRefs: refsText(server.headerRefs)
    });
    setNote("");
    op.setMessage("");
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.panel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: settings_card_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.inline, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: settings_card_default.hGrow, children: t("mcp") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: settings_card_default.btn, type: "button", disabled: op.busy || list.loading, onClick: () => void list.reload(), children: t("refresh") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: settings_card_default.note, children: t("statusHint") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { className: settings_card_default.input, "aria-label": t("search"), placeholder: t("search"), value: query, onChange: (e) => setQuery(e.target.value) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorMessage, { message: list.error || op.message, t }),
      list.value?.legacyAvailable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: settings_card_default.note, children: t("legacy") }) : null,
      list.loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: t("loading") }) : !list.value?.servers.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("empty") }) : list.value.servers.filter((server) => server.name.toLowerCase().includes(query.trim().toLowerCase())).map((server) => {
        const capabilities = mcpCapabilities(server);
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.row, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.main, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: settings_card_default.name, children: server.name }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.note, children: [
              t(server.source === "native" ? "native" : "managed"),
              server.source === "native" && capabilities.toggle ? ` \xB7 ${t("switchSupported")}` : "",
              " \xB7 ",
              t(statusKeys[server.status]),
              " \xB7 ",
              t("tools"),
              ": ",
              server.toolCount
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.desc, children: [
              server.transport,
              " \xB7 ",
              server.transport === "stdio" ? server.command : server.url
            ] }),
            server.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorMessage, { message: server.error, t }) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: settings_card_default.switch, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", role: "switch", "aria-checked": server.enabled, "aria-label": `${t("enabled")} \xB7 ${server.name}`, checked: server.enabled, disabled: !capabilities.toggle || op.busy || list.loading, onChange: () => {
              if (!capabilities.toggle || !list.value || !server.enabled && !window.confirm(t("enableConfirm"))) return;
              const revision = list.value.revision;
              void op.run(async () => {
                await api.setMcpEnabled(server.id, !server.enabled, revision);
                await list.reload();
              });
            } }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t(server.enabled ? "enabled" : "disabled") })
          ] }),
          capabilities.remove ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: settings_card_default.btn, type: "button", disabled: !capabilities.edit || op.busy || list.loading, onClick: () => edit(server), children: t("edit") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: settings_card_default.btnDanger, type: "button", disabled: op.busy || list.loading, onClick: () => {
              if (!capabilities.remove || !list.value || !window.confirm(t("removeConfirm"))) return;
              const revision = list.value.revision;
              void op.run(async () => {
                await api.deleteMcp(server.id, revision);
                if (form.id === server.id) setForm(emptyForm());
                await list.reload();
              });
            }, children: t("remove") })
          ] }) : null
        ] }, server.id);
      })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: settings_card_default.section, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: settings_card_default.h, children: t("formTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: settings_card_default.note, children: t("referencesHint") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: settings_card_default.note, children: t("commandHint") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { className: settings_card_default.form, disabled: op.busy, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("name"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { className: settings_card_default.input, maxLength: 32, value: form.name, onChange: (e) => patch({ name: e.target.value }) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("transport"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { className: settings_card_default.input, value: form.transport, onChange: (e) => patch({ transport: e.target.value }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "stdio", children: "stdio" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "streamable-http", children: "streamable-http" })
        ] }) }),
        form.transport === "stdio" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("command"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { className: settings_card_default.input, value: form.command, onChange: (e) => patch({ command: e.target.value }) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("args"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { className: settings_card_default.input, rows: 3, value: form.args, onChange: (e) => patch({ args: e.target.value }) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("cwd"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { className: settings_card_default.input, value: form.cwd, onChange: (e) => patch({ cwd: e.target.value }) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("envRefs"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { className: settings_card_default.input, rows: 3, autoComplete: "off", spellCheck: false, value: form.envRefs, onChange: (e) => patch({ envRefs: e.target.value }) }) })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("url"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { className: settings_card_default.input, value: form.url, onChange: (e) => patch({ url: e.target.value }) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, { label: t("headerRefs"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { className: settings_card_default.input, rows: 3, autoComplete: "off", spellCheck: false, value: form.headerRefs, onChange: (e) => patch({ headerRefs: e.target.value }) }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: settings_card_default.switch, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", checked: form.enabled, onChange: (e) => patch({ enabled: e.target.checked }) }),
          t("enableOnSave")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: settings_card_default.inline, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: settings_card_default.btnPrimary, type: "button", disabled: !list.value || list.loading, onClick: () => void op.run(async () => {
            const server = buildMcpServer(form, t);
            if (server.enabled && !window.confirm(t("enableConfirm"))) return;
            const revision = form.revision ?? list.value?.revision;
            if (revision === void 0) return;
            await api.saveMcp(server, revision);
            setForm(emptyForm());
            setNote("saved");
            await list.reload();
          }), children: t(op.busy ? "saving" : "save") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: settings_card_default.btn, type: "button", onClick: () => void op.run(async () => {
            const server = buildMcpServer(form, t);
            if (!window.confirm(t("testConfirm"))) return;
            const result = await api.testMcp(server);
            if (!result.ok) throw new Error(`${t("testFailed")} ${result.error || ""}`);
            setNote("testOk");
          }), children: t(op.busy ? "testing" : "test") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: settings_card_default.btn, type: "button", onClick: () => {
            setForm(emptyForm());
            setNote("");
            op.setMessage("");
          }, children: t("reset") })
        ] })
      ] }),
      note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: settings_card_default.note, role: "status", children: t(note) }) : null
    ] })
  ] });
}
function Field({ label, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: settings_card_default.fieldLabel, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: settings_card_default.fieldName, children: label }),
    children
  ] });
}
function ErrorMessage({ message, t }) {
  return message ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: settings_card_default.error, role: "alert", children: [
    t("error"),
    ": ",
    message
  ] }) : null;
}

// src/client/SettingsCard.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function SkillsMcpSection(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: settings_card_default.sectionPage, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { className: settings_card_default.pageHeading, children: props.t("title") }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: settings_card_default.note, children: props.t("description") }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(SkillsMcpManager, { t: props.t, pickDirectory: props.pickDirectory })
  ] });
}

// src/client/index.ts
var NS = "koishi-skills-mcp-manager";
var inject = ["slots", "locale", "uiWorkspace"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }));
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "koishi-skills-mcp-manager",
    order: 20,
    label: () => ctx.locale.bind(NS)("title"),
    locale: NS,
    inject: () => ({ pickDirectory: () => ctx.uiWorkspace.pickDirectory() })
  }, SkillsMcpSection));
}

    var original = module.exports;
    return Object.assign({}, original, {
      apply: function(ctx) {
        ctx.effect(function() {
          var style = document.createElement("style");
          style.dataset.pluginCss = "@koishi/dsh-skills-mcp-manager";
          style.textContent = "/* src/client/settings-card.module.css */\n.settings_card_sectionPage {\n  color: var(--dsw-alias-label-primary);\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  min-width: 0;\n  font-size: 13px;\n}\n.settings_card_sectionPage p {\n  margin: 0;\n}\n.settings_card_pageHeading {\n  margin: 0;\n  font-size: 16px;\n  font-weight: 600;\n}\n.settings_card_manager,\n.settings_card_panel,\n.settings_card_section,\n.settings_card_form {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  min-width: 0;\n}\n.settings_card_panel {\n  gap: 24px;\n}\n.settings_card_form {\n  border: 0;\n  margin: 0;\n  padding: 0;\n}\n.settings_card_tabs {\n  display: flex;\n  gap: 4px;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n.settings_card_tab,\n.settings_card_tabActive {\n  background: none;\n  border: 0;\n  border-bottom: 2px solid transparent;\n  padding: 8px 14px;\n  cursor: pointer;\n  font: inherit;\n  color: var(--dsw-alias-label-secondary);\n}\n.settings_card_tabActive {\n  border-bottom-color: var(--dsw-alias-brand-primary);\n  color: var(--dsw-alias-label-primary);\n  font-weight: 600;\n}\n.settings_card_h,\n.settings_card_hGrow {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n}\n.settings_card_hGrow {\n  flex: 1 1 auto;\n}\n.settings_card_inline {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n.settings_card_row {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 10px;\n  padding: 10px;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1);\n}\n.settings_card_main {\n  flex: 1 1 220px;\n  min-width: 0;\n}\n.settings_card_name {\n  font-weight: 600;\n  overflow-wrap: anywhere;\n}\n.settings_card_desc,\n.settings_card_note,\n.settings_card_fieldName {\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  overflow-wrap: anywhere;\n  line-height: 1.5;\n}\n.settings_card_error {\n  color: var(--dsw-alias-state-error-primary);\n  font-size: 12px;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n}\n.settings_card_switch {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 12px;\n}\n.settings_card_sectionPage input[type=checkbox] {\n  accent-color: var(--dsw-alias-brand-primary);\n}\n.settings_card_btn,\n.settings_card_btnPrimary,\n.settings_card_btnDanger {\n  font: inherit;\n  font-size: 12px;\n  padding: 5px 10px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-primary);\n  cursor: pointer;\n  white-space: nowrap;\n  align-self: flex-start;\n}\n.settings_card_btn:hover,\n.settings_card_btnPrimary:hover,\n.settings_card_btnDanger:hover {\n  background: var(--dsw-alias-bg-layer-2);\n}\n.settings_card_btnPrimary {\n  border-color: var(--dsw-alias-brand-primary);\n  font-weight: 600;\n}\n.settings_card_btnDanger {\n  color: var(--dsw-alias-state-error-primary);\n}\n.settings_card_sectionPage button:disabled,\n.settings_card_sectionPage input:disabled,\n.settings_card_sectionPage fieldset:disabled {\n  opacity: .55;\n  cursor: default;\n}\n.settings_card_sectionPage :focus-visible {\n  outline: 2px solid var(--dsw-alias-brand-primary);\n  outline-offset: 2px;\n}\n.settings_card_input,\n.settings_card_inputGrow,\n.settings_card_filterSelect {\n  font: inherit;\n  padding: 6px 8px;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-base);\n  color: var(--dsw-alias-label-primary);\n  box-sizing: border-box;\n  width: 100%;\n  min-width: 0;\n}\n.settings_card_inputGrow {\n  flex: 1 1 220px;\n  width: auto;\n}\n.settings_card_filterSelect {\n  width: auto;\n}\n.settings_card_input::placeholder,\n.settings_card_inputGrow::placeholder {\n  color: var(--dsw-alias-label-secondary);\n}\ntextarea.settings_card_input {\n  resize: vertical;\n}\n.settings_card_fieldLabel {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n.settings_card_detail {\n  padding: 10px;\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-1);\n}\n.settings_card_pre {\n  margin: 8px 0 0;\n  padding: 8px;\n  border-radius: 6px;\n  background: var(--dsw-alias-bg-layer-2);\n  font-family:\n    ui-monospace,\n    SFMono-Regular,\n    Menlo,\n    monospace;\n  font-size: 12px;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  max-height: 320px;\n  overflow: auto;\n}\n";
          document.head.appendChild(style);
          return function() { style.remove(); };
        });
        return original.apply(ctx);
      }
    });
  }
});
