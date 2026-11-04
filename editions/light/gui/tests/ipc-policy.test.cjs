const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertTrustedSender, registerTrustedHandler, protectWindow, denyPermissions,
  validateEngineCommand, validateLocalPath, validateClipboardText,
} = require('../electron/ipc-policy.cjs');

const rendererUrl = 'file:///application/renderer/index.html';

function applicationFrame() {
  const mainFrame = { url: rendererUrl };
  const contents = { mainFrame, isDestroyed: () => false };
  return { contents, event: { sender: contents, senderFrame: mainFrame } };
}

test('the application main frame is accepted and other windows or frames are denied', () => {
  const { contents, event } = applicationFrame();
  assert.doesNotThrow(() => assertTrustedSender(event, contents, rendererUrl));
  for (const untrusted of [
    {},
    { ...event, sender: {} },
    { ...event, senderFrame: { url: rendererUrl } },
    { ...event, senderFrame: null },
  ]) {
    assert.throws(() => assertTrustedSender(untrusted, contents, rendererUrl), /application window/);
  }
  event.senderFrame.url = 'file:///untrusted/document.html';
  assert.throws(() => assertTrustedSender(event, contents, rendererUrl), /application window/);
  event.senderFrame.url = rendererUrl;
  contents.isDestroyed = () => true;
  assert.throws(() => assertTrustedSender(event, contents, rendererUrl), /application window/);
  assert.throws(() => assertTrustedSender(event, null, rendererUrl), /application window/);
});

test('privileged handlers do not run for untrusted requests', async () => {
  const { contents, event } = applicationFrame();
  let registered;
  let calls = 0;
  const ipcMain = { handle: (_channel, callback) => { registered = callback; } };
  registerTrustedHandler(ipcMain, 'os:openPath', () => contents, rendererUrl, async (_event, target) => {
    calls += 1;
    return target;
  });
  assert.throws(() => registered({ ...event, senderFrame: { url: rendererUrl } }, '/tmp/example'), /application window/);
  assert.equal(calls, 0);
  assert.equal(await registered(event, '/tmp/example'), '/tmp/example');
  assert.equal(calls, 1);
});

test('navigation, redirects, popups and WebViews are blocked', () => {
  const handlers = new Map();
  let popup;
  protectWindow({
    setWindowOpenHandler: handler => { popup = handler; },
    on: (name, handler) => handlers.set(name, handler),
  });
  assert.deepEqual(popup({ url: 'file:///untrusted/document.html' }), { action: 'deny' });
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false;
    handlers.get(name)({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, name);
  }
});

test('web permission requests and browser downloads are denied', () => {
  let request;
  let check;
  let download;
  denyPermissions({
    setPermissionRequestHandler: handler => { request = handler; },
    setPermissionCheckHandler: handler => { check = handler; },
    on: (_name, handler) => { download = handler; },
  });
  for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'fullscreen']) {
    let permitted;
    request({}, permission, value => { permitted = value; });
    assert.equal(permitted, false);
    assert.equal(check({}, permission), false);
  }
  let prevented = false;
  download({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

test('engine commands must be recognized, bounded objects with valid request identifiers', () => {
  const commands = new Set(['scan', 'children', 'selection_replace']);
  const scan = { cmd: 'scan', path: '/tmp/fixture', request_id: 'scan-1' };
  assert.equal(validateEngineCommand(scan, commands), scan);
  for (const invalid of [null, [], 'scan', {}, { cmd: 'shutdown' }, { cmd: 1 }, { cmd: 'scan', request_id: {} }]) {
    assert.throws(() => validateEngineCommand(invalid, commands));
  }
  assert.throws(() => validateEngineCommand({ cmd: 'scan', request_id: 'x'.repeat(129) }, commands), /identifier/);
  assert.throws(() => validateEngineCommand({ cmd: 'scan', path: 'x'.repeat(8 * 1024 * 1024) }, commands), /limit/);
  assert.doesNotThrow(() => validateEngineCommand({ cmd: 'selection_replace', node_ids: Array.from({ length: 100000 }, (_, index) => index) }, commands));
});

test('OS path operations accept native absolute paths and reject URLs or relative paths', () => {
  for (const value of ['/tmp/a file.txt', '/tmp/$(text);quote.txt']) {
    assert.equal(validateLocalPath(value, 'linux'), value);
  }
  for (const value of ['C:\\Data\\a file.txt', '\\\\server\\share\\file.txt']) {
    assert.equal(validateLocalPath(value, 'win32'), value);
  }
  for (const platform of ['linux', 'win32']) {
    for (const value of [null, '', '../file', 'https://example.test/', 'file:///tmp/example', '/tmp/a\0b']) {
      assert.throws(() => validateLocalPath(value, platform), /absolute filesystem path/);
    }
  }
});

test('clipboard IPC accepts Unicode text but rejects objects and oversized input', () => {
  assert.equal(validateClipboardText('Árvíztűrő\n文件'), 'Árvíztűrő\n文件');
  assert.throws(() => validateClipboardText({ toString: () => 'unexpected' }));
  assert.throws(() => validateClipboardText('é'.repeat(4 * 1024 * 1024 + 1)));
});
