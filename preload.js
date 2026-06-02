const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectProject: () => ipcRenderer.invoke('select-project'),
  getProjectInfo: () => ipcRenderer.invoke('get-project-info'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  createSkill: (name, description) => ipcRenderer.invoke('create-skill', name, description),
  deleteSkill: (name) => ipcRenderer.invoke('delete-skill', name),
  checkAIEngine: () => ipcRenderer.invoke('check-ai-engine'),
  installAIEngine: () => ipcRenderer.invoke('install-ai-engine'),
  runAI: (message) => ipcRenderer.invoke('run-ai', message),
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  onAIOutput: (callback) => {
    ipcRenderer.removeAllListeners('ai-output');
    ipcRenderer.on('ai-output', (_, data) => callback(data));
  },
  onAIDone: (callback) => {
    ipcRenderer.removeAllListeners('ai-done');
    ipcRenderer.on('ai-done', (_, data) => callback(data));
  },
  onInstallProgress: (callback) => {
    ipcRenderer.removeAllListeners('install-progress');
    ipcRenderer.on('install-progress', (_, data) => callback(data));
  },
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  restartForUpdate: () => ipcRenderer.send('restart-for-update'),
  onUpdateStatus: (callback) => {
    ipcRenderer.removeAllListeners('update-status');
    ipcRenderer.on('update-status', (_, msg) => callback(msg));
  },
  onUpdateAvailable: (callback) => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.on('update-available', (_, info) => callback(info));
  },
  onUpdateProgress: (callback) => {
    ipcRenderer.removeAllListeners('update-progress');
    ipcRenderer.on('update-progress', (_, pct) => callback(pct));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.on('update-downloaded', () => callback());
  },
});
