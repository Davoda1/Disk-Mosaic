const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const required = [
  'renderer/index.html',
  'renderer/styles.css',
  'renderer/app.js',
  'renderer/layout.js',
  'renderer/treemap.js',
  'renderer/i18n.js',
  'renderer/file-types.js',
  'renderer/assets/icon.png',
  'renderer/assets/icon.ico',
];
for (const relative of required) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    throw new Error(`Missing renderer asset: ${relative}`);
  }
}
const html = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
if (!html.includes("default-src 'self'")) throw new Error('Renderer CSP missing');
console.log('Renderer verification PASS');
