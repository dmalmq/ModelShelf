import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(path.join(base, 'issues')).filter(name => /^\d{2}-.+\.md$/.test(name)).sort();
const tickets = files.map(file => {
  const text = fs.readFileSync(path.join(base, 'issues', file), 'utf8');
  const field = name => {
    const value = text.match(new RegExp(`^${name}: (.+)$`, 'm'))?.[1];
    assert(value, `${file}: missing ${name}`);
    return value;
  };
  const blocked = field('Blocked by');
  return {
    id: field('ID'), title: text.match(/^# (.+)$/m)?.[1], file, text,
    status: field('Status'), assignee: field('Assignee'), wave: Number(field('Wave')),
    blockers: blocked === 'none' ? [] : blocked.split(',').map(value => value.trim()),
  };
});
const byId = new Map(tickets.map(ticket => [ticket.id, ticket]));
assert.equal(byId.size, tickets.length, 'Duplicate ticket ID');
for (const ticket of tickets) {
  assert(ticket.file.startsWith(ticket.id + '-'), `Mismatched ID: ${ticket.file}`);
  assert(['open', 'claimed', 'resolved'].includes(ticket.status), `Invalid status: ${ticket.title}`);
  assert([1, 2].includes(ticket.wave), `Invalid wave: ${ticket.title}`);
  assert(ticket.title, `Missing title: ${ticket.file}`);
  for (const section of ['Question', 'What to build', 'Ownership', 'Acceptance criteria', 'Verification', 'Completion and handoff']) {
    assert(ticket.text.includes(`## ${section}\n`), `${ticket.title}: missing ${section}`);
  }
  for (const blocker of ticket.blockers) assert(byId.has(blocker), `${ticket.title}: missing blocker ${blocker}`);
  if (ticket.status === 'claimed') assert.notEqual(ticket.assignee, 'unassigned', `${ticket.title}: claim has no owner`);
  if (ticket.status === 'resolved') assert(ticket.text.includes('## Answer\n'), `${ticket.title}: resolved without an Answer`);
}
const visiting = new Set();
const visited = new Set();
function visit(id) {
  assert(!visiting.has(id), `Dependency cycle through ${byId.get(id).title}`);
  if (visited.has(id)) return;
  visiting.add(id);
  for (const blocker of byId.get(id).blockers) visit(blocker);
  visiting.delete(id);
  visited.add(id);
}
for (const ticket of tickets) visit(ticket.id);
for (const file of ['map.md', 'spec.md', 'codebase-map.md', 'HANDOFF.md', 'README.md', ...files.map(file => `issues/${file}`)]) {
  const source = path.join(base, file);
  for (const match of fs.readFileSync(source, 'utf8').matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^https?:/.test(match[1])) continue;
    assert(fs.existsSync(path.resolve(path.dirname(source), match[1].split('#')[0])), `${file}: broken link ${match[1]}`);
  }
}
const frontier = tickets.filter(ticket => ticket.status === 'open' && ticket.assignee === 'unassigned'
  && !fs.existsSync(path.join(base, 'claims', ticket.id))
  && ticket.blockers.every(id => byId.get(id).status === 'resolved'));
console.log(`Validated ${tickets.length} tickets, dependency graph, and local links.`);
console.log(`Wave 1: ${tickets.filter(ticket => ticket.wave === 1).length}; Wave 2: ${tickets.filter(ticket => ticket.wave === 2).length}.`);
console.log('Available to claim:');
for (const ticket of frontier) console.log(`- ${ticket.title} (${ticket.file})`);
if (!frontier.length) console.log('- None. Inspect claimed tickets or completion status.');
