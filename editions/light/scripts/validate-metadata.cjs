#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'gui/package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'gui/package-lock.json'), 'utf8'));
const cargo = fs.readFileSync(path.join(root, 'engine/Cargo.toml'), 'utf8').split('[dependencies]')[0];
assert.equal(pkg.version, '1.0.0');
assert.equal(pkg.license, 'AGPL-3.0-only');
assert.match(cargo, /^version = "1\.0\.0"$/m);
assert.match(cargo, /^license = "AGPL-3\.0-only"$/m);
assert.equal(lock.name, pkg.name);
assert.equal(lock.version, pkg.version);
assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies);
for (const version of Object.values(pkg.devDependencies)) assert.match(version, /^\d+\.\d+\.\d+$/);
assert.ok(fs.existsSync(path.join(root, 'engine/Cargo.lock')), 'Committed Cargo.lock is required.');
console.log('Version, license and dependency-lock metadata PASS.');
