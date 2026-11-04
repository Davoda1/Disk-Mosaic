#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = process.argv[2];
if (!directory) throw new Error('Usage: dependency-fingerprint.cjs <gui-directory>');
const hash = crypto.createHash('sha256');
for (const name of ['package.json', 'package-lock.json']) hash.update(fs.readFileSync(path.join(directory, name)));
hash.update(`${process.platform}/${process.arch}`);
console.log(hash.digest('hex'));
