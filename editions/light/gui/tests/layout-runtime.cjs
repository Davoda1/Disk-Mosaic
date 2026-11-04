/* Rendered smoke tests using synthetic scan events. No real scans or OS actions.
   Requires Playwright + Chromium. DISKMOSAIC_PLAYWRIGHT / DISKMOSAIC_CHROMIUM
   may select existing test tools; DISKMOSAIC_LAYOUT_OUTPUT selects evidence output. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.DISKMOSAIC_PLAYWRIGHT || 'playwright');

const renderer = path.resolve(__dirname, '../renderer');
const output = path.resolve(process.env.DISKMOSAIC_LAYOUT_OUTPUT || path.join(__dirname, '../../dependencies/layout-results'));
fs.mkdirSync(output, { recursive: true });
const results = [];
const errors = [];
const server = http.createServer((req, res) => {
  let target;
  try { target = path.resolve(renderer, '.' + decodeURIComponent(req.url.split('?')[0])); }
  catch { res.writeHead(400); res.end(); return; }
  if (!target.startsWith(renderer + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[path.extname(target)] || 'text/html');
    res.end(fs.readFileSync(target));
  } catch { res.writeHead(404); res.end(); }
});

function installFixture() {
  const modified_ms = 1700000000000;
  const make = (id, parent_id, name, kind, size, file_count = 1, dir_count = 0) => ({
    id, parent_id, name, kind, size, allocated_size: size, file_count, dir_count,
    modified_ms, extension: kind === 'file' ? name.slice(name.lastIndexOf('.')) : '',
    type_hint: '', hardlink_duplicate: false, link_count: 1, hidden: false,
  });
  const nodes = [
    make(0, null, 'Fixture', 'directory', 14000000, 4, 2),
    make(1, 0, 'Documents', 'directory', 4000000, 2, 0),
    make(2, 0, 'Media', 'directory', 10000000, 2, 0),
    make(3, 1, 'alpha.txt', 'file', 2000000),
    make(4, 1, 'notes <img src=x onerror=window.filenameExecuted=true>.txt', 'file', 2000000),
    make(5, 2, 'clip.mp4', 'file', 6000000),
    make(6, 2, 'photo.png', 'file', 4000000),
  ];
  for (const node of nodes) node.path = node.id === 0 ? '/fixture' : nodes[node.parent_id].path + '/' + node.name;
  const files = nodes.filter(node => node.kind === 'file');
  const statistics = { size_buckets: [], age_buckets: [], max_depth: 2, hardlink_duplicates: 0, extensionless_files: 0 };
  const summary = { files: 4, directories: 3, bytes: 14000000, allocated_bytes: 14000000, errors: 0, excluded: 0, elapsed_ms: 10, filesystem_total_bytes: 100000000, filesystem_available_bytes: 50000000 };
  let receive;
  const deliver = value => setTimeout(() => receive?.(value), 0);
  window.__fixtureCommands = [];
  window.diskMosaic = Object.freeze({
    onEngineEvent(callback) { receive = callback; deliver({ event: 'engine_ready', protocol: 4, version: '1.0.0', history_available: true }); return () => {}; },
    setLanguage: async language => language,
    getStartupPath: async () => null,
    chooseFolder: async () => '/fixture',
    openPath: async () => '', revealPath: async () => true, copyText: async () => true,
    openSnapshotPath: async () => null, saveSnapshotPath: async () => null, saveTextFile: async () => null,
    sendEngine: async command => {
      window.__fixtureCommands.push(command);
      const reply = payload => deliver({ ...payload, request_id: command.request_id });
      switch (command.cmd) {
        case 'list_roots': reply({ event: 'roots', roots: [{ path: '/fixture', total_bytes: 100000000, available_bytes: 50000000 }] }); break;
        case 'scan':
          reply({ event: 'scan_started', scan_id: command.request_id });
          reply({ event: 'scan_completed', scan_id: command.request_id, root: nodes[0], summary, statistics,
            extension_stats: [{ extension: '.txt', files: 2, size: 4000000, allocated_size: 4000000 }, { extension: '.mp4', files: 1, size: 6000000, allocated_size: 6000000 }, { extension: '.png', files: 1, size: 4000000, allocated_size: 4000000 }] });
          break;
        case 'children': {
          const items = nodes.filter(node => node.parent_id === command.parent_id);
          reply({ event: 'children', items, total: items.length, parent_id: command.parent_id, offset: 0 }); break;
        }
        case 'treemap': {
          const parent = nodes[command.parent_id];
          const items = nodes.filter(node => node.id !== parent.id && node.path.startsWith(parent.path + '/'))
            .map(node => ({ ...node, logical_size: node.size, aggregated_items: 0, matches_filter: true }));
          reply({ event: 'treemap', parent, items }); break;
        }
        case 'ancestors': {
          const items = [];
          for (let node = nodes[command.node_id]; node; node = node.parent_id == null ? null : nodes[node.parent_id]) items.unshift(node);
          reply({ event: 'ancestors', items }); break;
        }
        case 'get_node': reply({ event: 'node', node: nodes[command.node_id] || null }); break;
        case 'get_metadata': reply({ event: 'metadata', node_id: command.node_id, metadata: {} }); break;
        case 'largest': reply({ event: 'largest', items: [...files].sort((a, b) => b.size - a.size) }); break;
        case 'search': reply({ event: 'search_results', items: files.filter(node => !command.name_contains || node.name.includes(command.name_contains)) }); break;
        case 'history_list': reply({ event: 'history_list', total: 2, items: [1, 2].map(id => ({ id, root_path: '/fixture/' + 'long-directory-name/'.repeat(8), saved_ms: modified_ms + id * 86400000, logical_bytes: 14000000, allocated_bytes: 14000000, files: 1234567 })) }); break;
        case 'watch_stop': reply({ event: 'watcher_state', state: 'not_watching' }); break;
        case 'selection_replace': case 'selection_clear': case 'selection_summary':
          reply({ event: 'selection_changed', selected_ids: command.node_ids || [], summary: { selected_items: (command.node_ids || []).length }, truncated: false }); break;
        default: reply({ event: 'operation_failed', operation: command.cmd, message: 'Unsupported fixture command: ' + command.cmd });
      }
      return command.request_id;
    },
  });
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.DISKMOSAIC_CHROMIUM || undefined });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', entry => { if (entry.type() === 'error' && !entry.text().includes('404')) errors.push(entry.text()); });
    await page.addInitScript(installFixture);
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.locator('#rootChoices .root-choice').waitFor();
    assert.equal(await page.title(), 'DiskMosaic Light');
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const check = async (label, callback) => {
      const problems = await page.evaluate(callback);
      results.push({ label, passed: problems.length === 0, problems });
    };
    const settingsContainment = () => {
      const issues = [];
      const grid = document.querySelector('.settings-grid');
      const footer = document.querySelector('.settings-footer').getBoundingClientRect();
      if (grid.scrollWidth > grid.clientWidth + 1) issues.push('horizontal settings overflow');
      if (footer.top < 0 || footer.bottom > innerHeight + 1) issues.push('settings footer is outside the window');
      return issues;
    };
    await page.locator('#overlaySettingsButton').click();
    await settle();
    await check('Settings opens before a scan', settingsContainment);
    await page.locator('#aboutButton').click();
    assert.match(await page.locator('#aboutModal').innerText(), /DiskMosaic Light/);
    assert.match(await page.locator('#aboutModal').innerText(), /Version 1\.0\.0/);
    assert.match(await page.locator('#aboutModal').innerText(), /GNU AGPL/);
    await check('About is above Settings', () => {
      const bounds = document.querySelector('#aboutModal .dialog').getBoundingClientRect();
      return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + 20)?.closest('#aboutModal') ? [] : ['About is obscured'];
    });
    await page.screenshot({ path: path.join(output, 'about.png') });
    await page.locator('#closeAboutButton').click();
    await page.locator('#saveSettingsButton').click();
    await page.locator('#overlayFolderButton').click();
    await page.waitForFunction(() => document.getElementById('treemapCount').textContent.includes('4 item tiles'));
    assert.equal(await page.locator('#treeList .tree-row').count(), 3);

    for (const progress of [false, true]) for (const summary of [false, true]) {
      await page.evaluate(({ progress, summary }) => {
        document.getElementById('progressPanel').classList.toggle('hidden', !progress);
        document.getElementById('scanSummaryStrip').classList.toggle('hidden', !summary);
      }, { progress, summary });
      await settle();
      await check(`optional rows progress=${progress} summary=${summary}`, () => {
        const footer = document.querySelector('.statusbar').getBoundingClientRect();
        const workspace = document.getElementById('workspace').getBoundingClientRect();
        return Math.abs(footer.bottom - innerHeight) > 1 || Math.abs(workspace.bottom - footer.top) > 1
          ? ['optional rows displace the workspace/footer'] : [];
      });
    }
    await page.evaluate(() => {
      document.getElementById('progressPanel').classList.add('hidden');
      document.getElementById('scanSummaryStrip').classList.remove('hidden');
    });

    for (const [width, height] of [[1024, 700], [1280, 800], [1600, 900]]) {
      await page.setViewportSize({ width, height });
      for (const view of ['directory', 'largest', 'duplicates', 'search', 'compare', 'statistics', 'history']) {
        await page.locator(`.tab[data-view="${view}"]`).click();
        await settle();
        await check(`${width}x${height}/${view}`, () => {
          const issues = [];
          const active = document.querySelector('.view.active');
          const footer = document.querySelector('.statusbar').getBoundingClientRect();
          if (document.documentElement.scrollHeight > innerHeight + 1 || document.body.scrollWidth > innerWidth + 1) issues.push('whole-window overflow');
          if (Math.abs(footer.bottom - innerHeight) > 1) issues.push('footer displaced');
          if (active.getBoundingClientRect().height < 80) issues.push('workspace is collapsed');
          const tab = document.querySelector('.tab.active').getBoundingClientRect();
          const strip = document.querySelector('.panel-tabs').getBoundingClientRect();
          if (tab.left < strip.left - 1 || tab.right > strip.right + 1) issues.push('active workspace tab is clipped');
          if (/undefined|\[object Object\]/.test(active.innerText)) issues.push('unformatted runtime text');
          return issues;
        });
      }
      await page.locator('#settingsButton').click();
      await settle();
      await check(`${width}x${height}/settings`, settingsContainment);
      await page.screenshot({ path: path.join(output, `${width}x${height}-settings.png`) });
      await page.locator('#saveSettingsButton').click();
    }

    await page.locator('.tab[data-view="search"]').click();
    await page.locator('#searchName').fill('notes');
    await page.locator('#searchName').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#searchList .virtual-row').length === 1);
    assert.match(await page.locator('#searchList').innerText(), /notes <img/);
    assert.equal(await page.locator('#searchList img').count(), 0);
    assert.equal(await page.evaluate(() => Boolean(window.filenameExecuted)), false);
    results.push({ label: 'Search treats HTML-like filenames as text', passed: true, problems: [] });

    await page.locator('.tab[data-view="directory"]').click();
    for (const mode of ['cushioned2d', 'extruded3d']) {
      await page.locator('#settingsButton').click();
      await page.locator('#settingTheme').selectOption(mode === 'cushioned2d' ? 'light' : 'dark');
      await page.locator('#settingTreemapVisualization').selectOption(mode);
      await page.locator('#saveSettingsButton').click();
      await settle();
      await check(`treemap ${mode}`, () => {
        const canvas = document.getElementById('treemapCanvas');
        const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set();
        for (let offset = 0; offset < bytes.length; offset += 400) colors.add(`${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]}`);
        return colors.size >= 8 ? [] : ['treemap did not render populated tiles'];
      });
      await page.screenshot({ path: path.join(output, `treemap-${mode}.png`) });
    }

    await page.setViewportSize({ width: 1024, height: 700 });
    for (const language of ['en', 'de', 'hu', 'fr', 'it', 'es']) {
      await page.locator('#settingsButton').click();
      await page.locator('#settingLanguage').selectOption(language);
      await page.locator('#saveSettingsButton').click();
      await page.locator('#settingsButton').click();
      await settle();
      await check(`settings translation ${language}`, settingsContainment);
      await page.locator('#aboutButton').click();
      assert.match(await page.locator('#aboutTitle').innerText(), /DiskMosaic Light/);
      await page.locator('#closeAboutButton').click();
      await page.locator('#saveSettingsButton').click();
    }
    results.push({ label: 'renderer runtime errors', passed: errors.length === 0, problems: errors });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
    const failed = results.filter(result => !result.passed);
    console.log(JSON.stringify({ checks: results.length, passed: results.length - failed.length, failed }, null, 2));
    assert.equal(failed.length, 0, 'Rendered UI regression checks failed');
  } finally { await browser.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
