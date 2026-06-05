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
  runAI: (message, history) => ipcRenderer.invoke('run-ai', message, history),
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
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onCheckUpdatesAuto: (callback) => {
    ipcRenderer.removeAllListeners('check-for-updates-auto');
    ipcRenderer.on('check-for-updates-auto', () => callback());
  },
});
