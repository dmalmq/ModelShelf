#!/usr/bin/env node
// Compare local Wayfinder tickets with GitHub issues. GitHub issue state is
// authoritative. `node scripts/sync-tickets.ts` prints the diff. `--apply`
// writes Status (and a missing Answer) into the local working copies.

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ISSUES_DIR = join(REPO_ROOT, ".scratch", "modelshelf-prototype", "issues");
const APPLY = process.argv.includes("--apply");

const TICKET_MARK = /<!--\s*modelshelf-local-ticket:(\d+)\s*-->/;

type LocalTicket = {
  id: string;
  file: string;
  title: string;
  status: string;
  text: string;
  hasAnswer: boolean;
};

type GithubIssue = {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  body: string;
};

function githubNumber(localId: number): number {
  if (localId >= 1 && localId <= 18) return localId + 2;
  if (localId >= 19 && localId <= 34) return localId + 21;
  throw new Error(`no GitHub mapping for local ticket ${localId}`);
}

function parseLocal(file: string): LocalTicket | undefined {
  const text = readFileSync(join(ISSUES_DIR, file), "utf8");
  const id = /^ID:\s+(\d+)/m.exec(text)?.[1];
  const status = /^Status:\s+(\S+)/m.exec(text)?.[1];
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
  if (!id || !status || !title) return undefined;
  return {
    id: id.padStart(2, "0"),
    file,
    title,
    status,
    text,
    hasAnswer: /^## Answer\s*$/m.test(text),
  };
}

function gh<T>(args: string[]): T {
  const result = spawnSync("gh", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as T;
}

function localStatusFor(state: GithubIssue["state"]): string {
  return state === "CLOSED" ? "resolved" : "open";
}

function issueTitle(issue: GithubIssue): { id: string; title: string } | undefined {
  const marked = TICKET_MARK.exec(issue.body)?.[1];
  const fromTitle = /^\[(\d+)\]\s+(.+)$/.exec(issue.title);
  const id = marked ?? fromTitle?.[1];
  const title = fromTitle?.[2] ?? issue.title;
  if (!id) return undefined;
  return { id: id.padStart(2, "0"), title };
}

function latestAnswerComment(number: number): string | undefined {
  const payload = gh<{ comments: { body: string }[] }>([
    "issue",
    "view",
    String(number),
    "--json",
    "comments",
  ]);
  const answers = payload.comments.filter((comment) => /^## Answer\b/m.test(comment.body));
  return answers.at(-1)?.body;
}

if (!existsSync(ISSUES_DIR)) {
  console.error(`missing local tickets at ${ISSUES_DIR}`);
  process.exit(1);
}

const locals = readdirSync(ISSUES_DIR)
  .filter((name) => name.endsWith(".md"))
  .map(parseLocal)
  .filter((ticket): ticket is LocalTicket => ticket !== undefined)
  .sort((a, b) => a.id.localeCompare(b.id));

const issues = gh<GithubIssue[]>([
  "issue",
  "list",
  "--state",
  "all",
  "--limit",
  "200",
  "--json",
  "number,title,state,body",
]);

const githubById = new Map<string, GithubIssue & { localId: string; issueTitle: string }>();
for (const issue of issues) {
  const parsed = issueTitle(issue);
  if (!parsed) continue;
  githubById.set(parsed.id, { ...issue, localId: parsed.id, issueTitle: parsed.title });
}

const mismatches: string[] = [];

for (const local of locals) {
  const remote = githubById.get(local.id);
  if (!remote) {
    mismatches.push(`local ${local.id} has no GitHub issue (expected #${githubNumber(Number(local.id))})`);
    continue;
  }
  const expectedStatus = localStatusFor(remote.state);
  if (local.status !== expectedStatus) {
    if (APPLY) {
      let next = local.text.replace(/^Status:\s+\S+/m, `Status: ${expectedStatus}`);
      if (expectedStatus === "resolved" && !local.hasAnswer) {
        const answer = latestAnswerComment(remote.number);
        if (answer) {
          next = `${next.trimEnd()}\n\n${answer.trim()}\n`;
        }
      }
      writeFileSync(join(ISSUES_DIR, local.file), next);
      console.log(`updated ${local.file} -> ${expectedStatus}`);
    } else {
      mismatches.push(
        `ticket ${local.id}: local Status ${local.status}, GitHub #${remote.number} ${remote.state} (want ${expectedStatus})`,
      );
    }
  }
  if (local.title !== remote.issueTitle) {
    mismatches.push(`ticket ${local.id}: title local ${JSON.stringify(local.title)} vs GitHub ${JSON.stringify(remote.issueTitle)}`);
  }
}

for (const [id, remote] of githubById) {
  if (locals.some((ticket) => ticket.id === id)) continue;
  mismatches.push(`GitHub #${remote.number} [${id}] has no local file`);
}

if (mismatches.length === 0) {
  console.log(`ok - ${locals.length} local tickets match GitHub state`);
  process.exit(0);
}

console.error(`${APPLY ? "applied with remaining" : "FAIL"} - ${mismatches.length} ticket mismatch(es)`);
for (const line of mismatches) console.error(`  ${line}`);
process.exit(1);
