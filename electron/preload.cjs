const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('motionStudio', {
  saveProject: (project) => ipcRenderer.invoke('project:save', project),
  openProject: () => ipcRenderer.invoke('project:open'),
  importMedia: () => ipcRenderer.invoke('media:import'),
  isDesktop: true
});