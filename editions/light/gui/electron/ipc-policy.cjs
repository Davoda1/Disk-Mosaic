const path = require('node:path');

const MAX_COMMAND_BYTES = 8 * 1024 * 1024;
const MAX_CLIPBOARD_BYTES = 8 * 1024 * 1024;

function assertTrustedSender(event, contents, rendererUrl) {
  if (!contents || contents.isDestroyed() || event?.sender !== contents ||
      !event.senderFrame || event.senderFrame !== contents.mainFrame ||
      event.senderFrame.url !== rendererUrl) {
    throw new Error('IPC requests must originate from the application window');
  }
}

function registerTrustedHandler(ipcMain, channel, getContents, rendererUrl, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event, getContents(), rendererUrl);
    return handler(event, ...args);
  });
}

function protectWindow(contents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    contents.on(eventName, event => event.preventDefault());
  }
}

function denyPermissions(targetSession) {
  targetSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.on('will-download', event => event.preventDefault());
}

function validateEngineCommand(command, allowedCommands) {
  if (!command || typeof command !== 'object' || Array.isArray(command) ||
      typeof command.cmd !== 'string' || !allowedCommands.has(command.cmd)) {
    throw new Error('Unsupported engine command');
  }
  if (command.request_id != null &&
      (typeof command.request_id !== 'string' || command.request_id.length > 128)) {
    throw new Error('Invalid engine request identifier');
  }
  const serialized = JSON.stringify(command);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_COMMAND_BYTES) {
    throw new Error('Engine command exceeds the 8 MiB limit');
  }
  return command;
}

function validateLocalPath(target, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (typeof target !== 'string' || target.length > 32768 || target.includes('\0') ||
      !pathApi.isAbsolute(target) || /^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
    throw new Error('An absolute filesystem path is required');
  }
  return target;
}

function validateClipboardText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_BYTES) {
    throw new Error('Clipboard content must be text no larger than 8 MiB');
  }
  return text;
}

module.exports = {
  assertTrustedSender, registerTrustedHandler, protectWindow, denyPermissions,
  validateEngineCommand, validateLocalPath, validateClipboardText,
};
