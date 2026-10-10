const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const isDev = !app.isPackaged;
function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 980, minWidth: 1100, minHeight: 720,
    backgroundColor: '#101116',
    title: 'Motion Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (isDev) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
app.whenReady().then(() => {
  ipcMain.handle('project:save', async (_event, data) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Motion Studio project',
      defaultPath: 'untitled.motion.json',
      filters: [{ name: 'Motion Studio Project', extensions: ['motion.json', 'json'] }]
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return { canceled: false, filePath };
  });
  ipcMain.handle('project:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Motion Studio Project', extensions: ['json', 'motion.json'] }]
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    const content = await fs.readFile(filePaths[0], 'utf8');
    return { canceled: false, filePath: filePaths[0], data: JSON.parse(content) };
  });
  ipcMain.handle('media:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: ['png','jpg','jpeg','webp','gif','svg','mp4','mov','webm','mp3','wav','ogg','m4a'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (canceled) return [];
    return filePaths.map(filePath => ({ name: path.basename(filePath), path: filePath, url: require('node:url').pathToFileURL(filePath).href }));
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });