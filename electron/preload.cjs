const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('motionStudio', {
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  saveProjectAs: (project) => ipcRenderer.invoke('project:save-as', project),
  autosaveProject: (project) => ipcRenderer.invoke('project:autosave', project),
  getRecoveryProject: () => ipcRenderer.invoke('project:get-recovery'),
  discardRecoveryProject: () => ipcRenderer.invoke('project:discard-recovery'),
  acceptExternalProject: () => ipcRenderer.invoke('project:accept-external'),
  openProject: () => ipcRenderer.invoke('project:open'),
  importMedia: () => ipcRenderer.invoke('media:import'),
  onProjectExternalChange: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('project:external-change', listener);
    return () => ipcRenderer.removeListener('project:external-change', listener);
  },
  getExportCapabilities: () => ipcRenderer.invoke('export:capabilities'),
  beginFfmpegExport: (spec) => ipcRenderer.invoke('export:ffmpeg-begin', spec),
  writeFfmpegFrame: (input) => ipcRenderer.invoke('export:ffmpeg-frame', input),
  finishFfmpegExport: (input) => ipcRenderer.invoke('export:ffmpeg-finish', input),
  cancelFfmpegExport: (input) => ipcRenderer.invoke('export:ffmpeg-cancel', input),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  saveProvider: (provider) => ipcRenderer.invoke('providers:save', provider),
  deleteProvider: (id) => ipcRenderer.invoke('providers:delete', id),
  testProvider: (id) => ipcRenderer.invoke('providers:test', id),
  askProvider: (input) => ipcRenderer.invoke('providers:ask', input),
  isDesktop: true
});
