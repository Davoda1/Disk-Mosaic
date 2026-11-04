import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identities = new Set();
for (const edition of ['standard', 'light']) {
  const base = path.join(root, 'editions', edition);
  for (const relative of ['docs/1.2-IMPROVEMENT-ANALYSIS.md', 'docs/1.3-IMPROVEMENT-ANALYSIS.md', 'docs/1.4-IMPLEMENTATION-NOTES.md', 'docs/gui-validation']) {
    assert(!fs.existsSync(path.join(base, relative)), `${edition}: obsolete development evidence must not be published: ${relative}`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(base, 'gui/package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(base, 'gui/package-lock.json'), 'utf8'));
  const cargo = fs.readFileSync(path.join(base, 'engine/Cargo.toml'), 'utf8');
  const cargoLock = fs.readFileSync(path.join(base, 'engine/Cargo.lock'), 'utf8');
  assert.equal(pkg.version, '1.0.1', `${edition}: application version`);
  assert.equal(pkg.license, 'AGPL-3.0-only', `${edition}: application license`);
  assert.equal(lock.packages[''].version, pkg.version, `${edition}: npm lock version`);
  assert.equal(lock.packages[''].name, pkg.name, `${edition}: npm lock identity`);
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies, `${edition}: locked development dependencies`);
  assert.match(cargo, /^version = "1\.0\.1"$/m, `${edition}: engine version`);
  assert.match(cargo, /^license = "AGPL-3\.0-only"$/m, `${edition}: engine license`);
  assert.match(cargoLock, /name = "diskmosaic-engine"\nversion = "1\.0\.1"/, `${edition}: Cargo lock version`);
  assert.equal(fs.readFileSync(path.join(base, 'LICENSE'), 'utf8'), fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'), `${edition}: complete license`);
  for (const value of [pkg.name, pkg.build.appId, pkg.build.linux.executableName]) {
    const key = `${typeof value}:${value}`;
    assert(value && !identities.has(`${edition === 'light' ? 'standard' : 'light'}:${key}`), `Edition identities must be distinct: ${value}`);
    identities.add(`${edition}:${key}`);
  }
  assert.equal(pkg.build.productName, edition === 'standard' ? 'DiskMosaic' : 'DiskMosaic Light');
  for (const rel of ['THIRD_PARTY_NOTICES.md', 'LICENSING-AUDIT.md', 'docs/ARCHITECTURE.md', 'docs/IPC.md']) {
    assert(fs.statSync(path.join(base, rel)).isFile(), `${edition}: missing ${rel}`);
  }
}

const excluded = new Set(['.git', 'node_modules', 'dependencies', 'toolings', 'dist', 'target', '__pycache__']);
const secrets = [
  /github_pat_[A-Za-z0-9_]{30,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@/,
];
let checked = 0;
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${path.relative(root, filename)}`);
    if (entry.isDirectory()) { visit(filename); continue; }
    assert(!/^\.env(?:\.|$)/.test(entry.name), `Environment file cannot be committed: ${filename}`);
    const bytes = fs.readFileSync(filename);
    if (!bytes.includes(0) && bytes.length < 5_000_000) {
      const text = bytes.toString('utf8');
      for (const expression of secrets) assert(!expression.test(text), `Credential-shaped content: ${path.relative(root, filename)}`);
    }
    checked++;
  }
}
visit(root);
console.log(`Source verification passed: both editions, matching lockfiles/licenses, distinct identities, ${checked} source files.`);
