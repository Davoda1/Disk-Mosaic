const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('diskMosaic', Object.freeze({
  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
  setLanguage: language => ipcRenderer.invoke('ui:setLanguage', language),
  getStartupPath: () => ipcRenderer.invoke('app:startupPath'),
  sendEngine: command => ipcRenderer.invoke('engine:send', command),
  onEngineEvent: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('engine:event', listener);
    return () => ipcRenderer.removeListener('engine:event', listener);
  },
  openPath: target => ipcRenderer.invoke('os:openPath', target),
  revealPath: target => ipcRenderer.invoke('os:revealPath', target),
  copyText: text => ipcRenderer.invoke('os:copyText', text),
  saveTextFile: payload => ipcRenderer.invoke('dialog:saveTextFile', payload),
  saveSnapshotPath: suggestedName => ipcRenderer.invoke('dialog:saveSnapshotPath', suggestedName),
  openSnapshotPath: () => ipcRenderer.invoke('dialog:openSnapshotPath'),
}));
