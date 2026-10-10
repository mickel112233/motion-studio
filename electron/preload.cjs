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
  isDesktop: true
});
