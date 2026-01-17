import * as vscode from "vscode";
import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as nls from "vscode-nls";

const localize = nls.loadMessageBundle();

type Hunk = {
  id: string;
  file: string;
  fileHeader: string[];   // diff --git ... + index/---/+++ + meta lines (until first @@)
  hunkLines: string[];    // starts with @@ ... and includes +/-/ context lines
  patchText: string;      // fileHeader + this hunk
  stats: { add: number; del: number };
};

type FileOpKind = "add" | "delete" | "rename" | "copy" | "binary" | "typechange";

type FileOp = {
  id: string;
  kind: FileOpKind;
  path: string;
  origPath?: string; // rename/copy için
};

type PlanCommit = {
  message: string;
  body?: string;
  hunks: string[];
  ops?: string[];
};

type Plan = { commits: PlanCommit[] };


const CFG_SECTION = "autoCommitSplitter";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("autoCommitSplitter.selectModel", async () => {
      await selectModelInteractive();
    }),
    vscode.commands.registerCommand("autoCommitSplitter.splitAndCommit", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: localize('autoCommitSplitter.title', 'Auto Commit Splitter'), cancellable: true },
        async (progress, token) => {
          progress.report({ message: localize('preparing', 'Preparing…') });
          await splitAndCommit(progress, token);
        }
      );
    })
  );
}

export function deactivate() {}

async function splitAndCommit(progress: vscode.Progress<{ message?: string }>, token: vscode.CancellationToken) {
  const repoRoot = await getRepoRoot();
  if (!repoRoot) {
    vscode.window.showErrorMessage(localize('noRepository', 'No git repository found in the current workspace.'));
    return;
  }

  progress.report({ message: localize('checkingRepoState', 'Checking repo state…') });

  try {
    await ensureNoStagedChanges(repoRoot);
  } catch (e: any) {
    vscode.window.showErrorMessage(e?.message ?? String(e));
    return;
  }

  if (token.isCancellationRequested) {
    return;
  }

  progress.report({ message: localize('collectingChanges', 'Collecting changes…') });

  const snapshot = await collectWorkingTreeSnapshot(repoRoot);
  const { hunks, ops } = snapshot;

  if (!hunks.length && !ops.length) {
    vscode.window.showInformationMessage(localize('noChanges', 'No changes to split (working tree is clean).'));
    return;
  }

  progress.report({ message: localize('selectingModel', 'Selecting model…') });
  const model = await getOrPickModel();
  if (!model) {
    vscode.window.showErrorMessage(
      'No model available. Please run "Auto Commit Splitter: Select Model" first and ensure you have a language model provider installed (e.g., GitHub Copilot).'
    );
    return;
  }

  if (token.isCancellationRequested) {
    return;
  }

  progress.report({ message: localize('askingModel', 'Asking model for a commit plan…') });
  const plan = await generatePlan(model, hunks, ops, token);

  await showPlanPreview(plan, hunks, ops);

  const cfg = vscode.workspace.getConfiguration(CFG_SECTION);
  const autoApply = cfg.get<boolean>("autoApply") ?? false;

  if (!autoApply) {
    const pick = await vscode.window.showWarningMessage(
      localize('planGenerated', 'Plan generated. Apply & create commits now?'),
      { modal: true },
      localize('applyButton', 'Apply')
    );
    if (pick !== localize('applyButton', 'Apply')) {
      return;
    }
  }

  progress.report({ message: localize('applyingPlan', 'Applying plan…') });
  await applyPlan(repoRoot, plan, hunks, ops, token);

  vscode.window.showInformationMessage(localize('doneMessage', 'Done. Commits created.'));
}
async function collectWorkingTreeSnapshot(repoRoot: string): Promise<{ hunks: Hunk[]; ops: FileOp[] }> {
  const cfg = vscode.workspace.getConfiguration(CFG_SECTION);
  const includeUntracked = cfg.get<boolean>("includeUntracked") ?? true;

  const untrackedFlag = includeUntracked ? "--untracked-files=all" : "--untracked-files=no";

  const statusRaw = await runGit(repoRoot, [
    "--no-optional-locks",
    "status",
    "--porcelain=v2",
    "-z",
    untrackedFlag
  ]);

  const { ops: statusOps, unsplittablePaths, hasUnmerged } = parsePorcelainV2Z(statusRaw);
  if (hasUnmerged) {
    throw new Error(localize('unmergedNotSupported', 'Unmerged/conflicted changes detected. Resolve conflicts first.'));
  }
const headExists = await hasHead(repoRoot);

const diffArgs = headExists
  ? ["--no-optional-locks", "diff", "--patch", "--no-color", "--no-ext-diff", "HEAD"]
  : ["--no-optional-locks", "diff", "--patch", "--no-color", "--no-ext-diff"]; // index’e karşı

const diff = await runGit(repoRoot, diffArgs);

  const binaryOps = extractBinaryOpsFromDiff(diff);
  const opsAll = dedupeOps([...statusOps, ...binaryOps]);

  for (const op of opsAll) {
    // yeni dosya/rename/delete/binary/typechange gibi ops'lar hunk split’e girmez
    unsplittablePaths.add(op.path);
  }

  // Hunks’ı parse et ve unsplittable dosyaları filtrele
  const allHunks = parseUnifiedDiff(diff);
  const hunks = allHunks.filter(h => !unsplittablePaths.has(h.file));

  return { hunks, ops: opsAll };
}

function dedupeOps(ops: FileOp[]): FileOp[] {
  const map = new Map<string, FileOp>();
  for (const op of ops) {
    map.set(op.id, op);
  }
  return [...map.values()];
}

function parsePorcelainV2Z(raw: string): {
  ops: FileOp[];
  unsplittablePaths: Set<string>;
  hasUnmerged: boolean;
} {
  const tokens = raw.split("\0").filter(Boolean);
  const ops: FileOp[] = [];
  const unsplittablePaths = new Set<string>();
  let hasUnmerged = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t || t.startsWith("#")) {
      continue;
    }

    const kind = t[0];

    if (kind === "?") {
      const p = t.slice(2);
      ops.push(makeOp("add", p));
      unsplittablePaths.add(p);
      continue;
    }

    if (kind === "u") {
      hasUnmerged = true;
      continue;
    }

    if (kind === "1") {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = t.split(" ");
      if (parts.length < 9) {
        continue;
      }

      const xy = parts[1] ?? "..";
      const x = xy[0] ?? ".";
      const y = xy[1] ?? ".";

      const path = parts.slice(8).join(" ");
      // delete / typechange / add gibi ops’ları yakala (MVP: delete + typechange)
      if (x === "D" || y === "D") {
        ops.push(makeOp("delete", path));
        unsplittablePaths.add(path);
      } else if (x === "T" || y === "T") {
        ops.push(makeOp("typechange", path));
        unsplittablePaths.add(path);
      }
      continue;
    }

    if (kind === "2") {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><NUL><origPath>
      const parts = t.split(" ");
      if (parts.length < 10) {
        continue;
      }

      const xScore = parts[8] ?? "";
      const action = xScore[0]; // R or C
      const path = parts.slice(9).join(" ");
      const origPath = tokens[i + 1]; // -z => bir sonraki token

      if (origPath) {
        i++;
      }

      if (action === "R") {
        ops.push(makeOp("rename", path, origPath));
        unsplittablePaths.add(path);
      } else if (action === "C") {
        ops.push(makeOp("copy", path, origPath));
        unsplittablePaths.add(path);
      } else {
        // bilinmeyen => güvenli tarafta kal
        ops.push(makeOp("rename", path, origPath));
        unsplittablePaths.add(path);
      }

      continue;
    }
  }

  return { ops, unsplittablePaths, hasUnmerged };
}
async function hasHead(repoRoot: string): Promise<boolean> {
  try {
    await runGit(repoRoot, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function makeOp(kind: FileOpKind, path: string, origPath?: string): FileOp {
  const base = `${kind}|${origPath ?? ""}|${path}`;
  const id = "op" + crypto.createHash("sha1").update(base).digest("hex").slice(0, 10);
  return { id, kind, path, origPath };
}
function extractBinaryOpsFromDiff(diff: string): FileOp[] {
  const lines = diff.split(/\r?\n/);
  const ops: FileOp[] = [];

  let currentFile: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    if (l.startsWith("diff --git ")) {
      currentFile = undefined;
      continue;
    }

    if (l.startsWith("+++ b/")) {
      currentFile = l.substring("+++ b/".length);
      continue;
    }

    if (l.startsWith("Binary files ")) {
      // Örn: Binary files a/foo and b/foo differ
      const m = / and b\/(.+?) differ$/.exec(l);
      const path = (m?.[1] ?? currentFile)?.trim();
      if (path) {
        ops.push(makeOp("binary", path));
      }
      continue;
    }
  }

  return ops;
}

async function selectModelInteractive() {
  try {
    // Check if Language Model API is available
    if (!vscode.lm) {
      vscode.window.showErrorMessage(
        'Language Model API is not available in this VS Code version. Please update to VS Code 1.90.0 or newer.'
      );
      return;
    }

    const models = await vscode.lm.selectChatModels({});
    if (!models.length) {
      vscode.window.showErrorMessage(
        localize('noModels', 'No language models available. Install/enable a provider (e.g., GitHub Copilot Chat) and try again.')
      );
      return;
    }

    const items = models.map(m => ({
      label: m.name ?? m.id,
      description: `${m.vendor ?? ""} ${m.family ?? ""} ${m.version ?? ""}`.trim() || 'Language Model',
      model: m
    }));

    const selected = await vscode.window.showQuickPick(items, {
      title: localize('selectModelTitle', 'Select a model for Auto Commit Splitter'),
      placeHolder: 'Choose a language model to analyze your commits'
    });

    if (!selected) {
      return;
    }

    await vscode.workspace.getConfiguration(CFG_SECTION).update("modelId", selected.model.id, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(localize('selectedModel', 'Selected model: {0}', selected.label));
  } catch (error) {
    console.error('Error selecting model:', error);
    vscode.window.showErrorMessage(
      `Error selecting model: ${error instanceof Error ? error.message : String(error)}. Please ensure you have a language model provider installed (e.g., GitHub Copilot).`
    );
  }
}

async function getOrPickModel() {
  try {
    if (!vscode.lm) {
      vscode.window.showErrorMessage(
        'Language Model API is not available in this VS Code version. Please update to VS Code 1.90.0 or newer.'
      );
      return undefined;
    }

    const cfg = vscode.workspace.getConfiguration(CFG_SECTION);
    const modelId = (cfg.get<string>("modelId") ?? "").trim();

    // Try to get models - with proper error handling for user consent
    let models: readonly vscode.LanguageModelChat[] = [];
    try {
      models = modelId
        ? await vscode.lm.selectChatModels({ id: modelId })
        : await vscode.lm.selectChatModels({});
    } catch (error) {
      console.warn('Error accessing language models, trying interactive selection:', error);
    }

    if (!models.length) {
      // fall back to interactive selection
      await selectModelInteractive();
      const modelId2 = (vscode.workspace.getConfiguration(CFG_SECTION).get<string>("modelId") ?? "").trim();
      if (!modelId2) {
        return undefined;
      }
      try {
        const models2 = await vscode.lm.selectChatModels({ id: modelId2 });
        return models2[0];
      } catch (error) {
        console.error('Error getting model after selection:', error);
        return undefined;
      }
    }

    return models[0];
  } catch (error) {
    console.error('Error in getOrPickModel:', error);
    vscode.window.showErrorMessage(
      `Error accessing language model: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

async function generatePlan(
  model: vscode.LanguageModelChat,
  hunks: Hunk[],
  ops: FileOp[],
  token: vscode.CancellationToken
): Promise<Plan> {
  const hunkPayload = hunks.map(h => ({
    id: h.id,
    file: h.file,
    header: h.hunkLines[0],
    stats: h.stats,
    patchExcerpt: h.hunkLines.slice(0, 60).join("\n")
  }));

  const opPayload = ops.map(o => ({
    id: o.id,
    kind: o.kind,
    path: o.path,
    origPath: o.origPath ?? null
  }));

  const prompt = [
    `You are an expert software engineer.`,
    `Task: Split the following changes into logical, reviewable commits.`,
    `Rules:`,
    `- Use Conventional Commits: type(scope?): subject`,
    `- Types: feat, fix, refactor, perf, docs, test, chore, build, ci`,
    `- Subject <= 72 chars, imperative, no trailing period`,
    `- Each commit cohesive; never mix unrelated items.`,
    `- Every hunk/op id MUST appear exactly once across commits.`,
    ``,
    `Output MUST be valid JSON ONLY with this schema:`,
    `{ "commits": [ { "message": "type(scope): subject", "body": "optional", "hunks": ["h1"], "ops": ["op1"] } ] }`,
    ``,
    `Ops (file operations, atomic): ${JSON.stringify(opPayload)}`,
    `Hunks (splittable text diffs): ${JSON.stringify(hunkPayload)}`
  ].join("\n");

  const response = await model.sendRequest(
    [vscode.LanguageModelChatMessage.User(prompt)],
    {},
    token
  );

  const text = await readResponseText(response);
  const json = extractJsonObjectBalanced(text);
  const plan = JSON.parse(json) as Plan;

  validatePlan(plan, hunks, ops);
  return plan;
}

function extractJsonObjectBalanced(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error(localize('modelDidNotReturnJson', 'Model did not return JSON.'));
  }

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === "\"") { inStr = false; continue; }
      continue;
    }

    if (ch === "\"") { inStr = true; continue; }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1).trim();
      }
    }
  }

  throw new Error(localize('modelDidNotReturnJson', 'Model did not return JSON.'));
}


async function applyPlan(
  repoRoot: string,
  plan: Plan,
  hunks: Hunk[],
  ops: FileOp[],
  token: vscode.CancellationToken
) {
  const hunkById = new Map(hunks.map(h => [h.id, h]));
  const opById = new Map(ops.map(o => [o.id, o]));

  for (const [i, c] of plan.commits.entries()) {
    if (token.isCancellationRequested) {
      return;
    }

    // 1) hunks stage
    const patchesByFile = new Map<string, { header: string[]; hunks: string[][] }>();

    for (const hunkId of c.hunks ?? []) {
      const h = hunkById.get(hunkId);
      if (!h) {
        throw new Error(localize('unknownHunkIdInPlan', 'Unknown hunk id in plan: {0}', hunkId));
      }

      const entry = patchesByFile.get(h.file) ?? { header: h.fileHeader, hunks: [] };
      entry.hunks.push(h.hunkLines);
      patchesByFile.set(h.file, entry);
    }

    const patchParts: string[] = [];
    for (const [, entry] of patchesByFile) {
      patchParts.push(entry.header.join("\n"));
      for (const hl of entry.hunks) {
        patchParts.push(hl.join("\n"));
      }
      patchParts.push("");
    }

    const patchText = patchParts.join("\n").replace(/\n{3,}/g, "\n\n");
    if (patchText.trim()) {
      await runGitWithStdin(repoRoot, ["apply", "--cached", "--3way", "--whitespace=nowarn", "-"], patchText);
    }

    // 2) ops stage
    for (const opId of c.ops ?? []) {
      const op = opById.get(opId);
      if (!op) {
        throw new Error(localize('unknownOpIdInPlan', 'Unknown op id in plan: {0}', opId));
      }

      switch (op.kind) {
        case "add":
        case "binary":
        case "typechange":
          await runGit(repoRoot, ["add", "--", op.path]);
          break;
        case "delete":
          await runGit(repoRoot, ["add", "-u", "--", op.path]);
          break;
        case "rename":
          if (!op.origPath) {
            throw new Error(localize('renameMissingOrig', 'Rename op missing origPath: {0}', op.id));
          }
          await runGit(repoRoot, ["add", "-A", "--", op.origPath, op.path]);
          break;
        case "copy":
          await runGit(repoRoot, ["add", "--", op.path]);
          break;
      }
    }

    // 3) commit
    const commitArgs = ["commit", "-m", c.message];
    if (c.body && c.body.trim()) {
      commitArgs.push("-m", c.body.trim());
    }

	const staged = (await runGit(repoRoot, ["diff", "--cached", "--name-only"])).trim();
if (!staged) {
  throw new Error(localize(
    'nothingStaged',
    'Nothing staged for commit "{0}". Refusing to create an empty commit.',
    c.message
  ));
}

    await runGit(repoRoot, commitArgs);

    // 4) temizle (kalan değişiklikler working tree’de kalır)
    await runGit(repoRoot, ["reset"]);
    console.log(localize('createdCommit', 'Created commit {0}/{1}: {2}', i + 1, plan.commits.length, c.message));
  }
}


function parseUnifiedDiff(diff: string): Hunk[] {
  const lines = diff.split(/\r?\n/);
  const hunks: Hunk[] = [];

  let fileHeader: string[] = [];
  let currentFile = "";

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("diff --git ")) {
      fileHeader = [line];
      currentFile = "";
      i++;

      // meta lines
      while (i < lines.length && !lines[i].startsWith("diff --git ") && !lines[i].startsWith("@@ ")) {
        const l = lines[i];
        fileHeader.push(l);
        if (l.startsWith("+++ b/")) {
          currentFile = l.substring("+++ b/".length);
        }
        i++;
      }
      continue;
    }

    if (line.startsWith("@@ ")) {
      const hunkLines: string[] = [];
      hunkLines.push(line);
      i++;

      while (i < lines.length && !lines[i].startsWith("diff --git ") && !lines[i].startsWith("@@ ")) {
        hunkLines.push(lines[i]);
        i++;
      }

      const stats = calcStats(hunkLines);
      const file = currentFile || guessFileFromDiffHeader(fileHeader) || "UNKNOWN";
      const id = "h" + crypto.createHash("sha1").update(file + "\n" + hunkLines.join("\n")).digest("hex").slice(0, 10);

      hunks.push({
        id,
        file,
        fileHeader: [...fileHeader],
        hunkLines,
        patchText: [...fileHeader, ...hunkLines].join("\n"),
        stats
      });
      continue;
    }

    i++;
  }

  return hunks;
}


function guessFileFromDiffHeader(fileHeader: string[]): string | undefined {
  const diffLine = fileHeader.find(l => l.startsWith("diff --git "));
  if (!diffLine) {
    return undefined;
  }
  // diff --git a/foo b/foo
  const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(diffLine);
  return m?.[2];
}

function calcStats(hunkLines: string[]) {
  let add = 0, del = 0;
  for (const l of hunkLines) {
    if (l.startsWith("+++ ") || l.startsWith("--- ")) {
      continue;
    }
    if (l.startsWith("+")) {
      add++;
    } else if (l.startsWith("-")) {
      del++;
    }
  }
  return { add, del };
}

async function showPlanPreview(plan: Plan, hunks: Hunk[], ops: FileOp[]) {
  const hunkById = new Map(hunks.map(h => [h.id, h]));
  const opById = new Map(ops.map(o => [o.id, o]));

  const md: string[] = [];
  md.push(localize('planTitle', '# Auto Commit Splitter Plan'));
  md.push(``);
  md.push(`File Operations: ${ops.length ? ops.map(o => `${o.kind}:${o.path}`).join(", ") : localize('none', '(none)')}`);
  md.push(``);

  plan.commits.forEach((c, idx) => {
    md.push(`## ${idx + 1}) ${c.message}`);
    if (c.body?.trim()) {
      md.push(``);
      md.push(c.body.trim());
      md.push(``);
    }
    md.push(localize('hunks', 'Hunks:'));
    for (const id of c.hunks ?? []) {
      const h = hunkById.get(id);
      md.push(`- ${id} — ${h ? `${h.file} (${h.stats.add}+/${h.stats.del}-) ${h.hunkLines[0]}` : "UNKNOWN"}`);
    }
    md.push(`Operations:`);
    for (const id of c.ops ?? []) {
      const op = opById.get(id);
      md.push(`- ${id} — ${op ? `${op.kind}: ${op.path}` : "UNKNOWN"}`);
    }
    md.push(``);
  });

  const doc = await vscode.workspace.openTextDocument({ content: md.join("\n"), language: "markdown" });
  await vscode.window.showTextDocument(doc, { preview: true });
}
function validatePlan(plan: Plan, hunks: Hunk[], ops: FileOp[]) {
  if (!plan?.commits?.length) {
    throw new Error(localize('emptyPlan', 'Model returned an empty plan.'));
  }

  const allHunks = new Set(hunks.map(h => h.id));
  const allOps = new Set(ops.map(o => o.id));

  const seenHunks = new Set<string>();
  const seenOps = new Set<string>();

  for (const c of plan.commits) {
    if (!c.message?.trim()) {
      throw new Error(localize('emptyCommitMessage', 'A commit has an empty message.'));
    }
 const hasAny = (c.hunks?.length ?? 0) + (c.ops?.length ?? 0) > 0;
  if (!hasAny) {
    throw new Error(localize('emptyCommitNotAllowed', 'Plan contains an empty commit: {0}', c.message));
  }
    for (const id of c.hunks ?? []) {
      if (!allHunks.has(id)) {
        throw new Error(localize('unknownHunkId', 'Plan references unknown hunk id: {0}', id));
      }
      if (seenHunks.has(id)) {
        throw new Error(localize('duplicateHunkId', 'Hunk id appears multiple times: {0}', id));
      }
      seenHunks.add(id);
    }

    for (const id of c.ops ?? []) {
      if (!allOps.has(id)) {
        throw new Error(localize('unknownOpId', 'Plan references unknown op id: {0}', id));
      }
      if (seenOps.has(id)) {
        throw new Error(localize('duplicateOpId', 'Op id appears multiple times: {0}', id));
      }
      seenOps.add(id);
    }

    if (!isConventionalCommitHeader(c.message)) {
      throw new Error(localize('notConventionalCommit', 'Commit message is not Conventional Commits: "{0}"', c.message));
    }
  }

  const missingHunks = [...allHunks].filter(id => !seenHunks.has(id));
  const missingOps = [...allOps].filter(id => !seenOps.has(id));

  if (missingHunks.length || missingOps.length) {
    throw new Error(localize(
      'missingItems',
      'Plan did not cover all items. Missing hunks: {0} Missing ops: {1}',
      missingHunks.join(", ") || "(none)",
      missingOps.join(", ") || "(none)"
    ));
  }
}


function isConventionalCommitHeader(s: string) {
  // type(scope)?: subject
  return /^[a-z]+(\([^)]+\))?:\s.{1,72}$/.test((s ?? "").trim());
}

async function getGitTopLevel(cwd: string): Promise<string | undefined> {
  try {
    const out = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
    const p = out.trim();
    return p ? p : undefined;
  } catch {
    return undefined;
  }
}
async function getRepoRoot(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }

  const active = vscode.window.activeTextEditor?.document?.uri;
  const base = active
    ? (vscode.workspace.getWorkspaceFolder(active)?.uri.fsPath ?? folders[0].uri.fsPath)
    : folders[0].uri.fsPath;

  return (await getGitTopLevel(base)) ?? undefined;
}

async function ensureNoStagedChanges(repoRoot: string) {
  // if 'git diff --cached --quiet' exits with 1 -> staged changes exist
  try {
    await runGit(repoRoot, ["diff", "--cached", "--quiet"]);
  } catch {
    throw new Error(localize('stagedChangesError', 'Staged changes detected. Please commit/stash them first (MVP requires a clean index).'));
  }
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, { cwd, shell: false });
    let out = "";
    let err = "";
    p.stdout.on("data", d => (out += d.toString("utf8")));
    p.stderr.on("data", d => (err += d.toString("utf8")));
    p.on("error", reject);
    p.on("close", code => {
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(localize('gitCommandFailed', 'git {0} failed ({1}). {2}', args.join(" "), code, err)));
      }
    });
  });
}

function runGitWithStdin(cwd: string, args: string[], stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, { cwd, shell: false });
    let out = "";
    let err = "";
    p.stdout.on("data", d => (out += d.toString("utf8")));
    p.stderr.on("data", d => (err += d.toString("utf8")));
    p.on("error", reject);
    p.stdin.write(stdin, "utf8");
    p.stdin.end();
    p.on("close", code => {
      if (code === 0) {
        resolve(out);
      } else {
        reject(new Error(localize('gitCommandFailed', 'git {0} failed ({1}). {2}', args.join(" "), code, err)));
      }
    });
  });
}

async function readResponseText(response: vscode.LanguageModelChatResponse): Promise<string> {
  // response.text is an AsyncIterable in current LM API examples. :contentReference[oaicite:3]{index=3}
  let s = "";
  for await (const part of response.text) {
    s += part;
  }
  return s;
}
