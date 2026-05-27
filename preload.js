const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectProject: () => ipcRenderer.invoke('select-project'),
  getProjectInfo: () => ipcRenderer.invoke('get-project-info'),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  createSkill: (name, description) => ipcRenderer.invoke('create-skill', name, description),
  deleteSkill: (name) => ipcRenderer.invoke('delete-skill', name),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  checkAIEngine: () => ipcRenderer.invoke('check-ai-engine'),
  installAIEngine: () => ipcRenderer.invoke('install-ai-engine'),
  runAI: (message) => ipcRenderer.invoke('run-ai', message),
  onAIOutput: (callback) => {
    ipcRenderer.removeAllListeners('ai-output');
    ipcRenderer.on('ai-output', (_, data) => callback(data));
  },
  onAIDone: (callback) => {
    ipcRenderer.removeAllListeners('ai-done');
    ipcRenderer.on('ai-done', (_, data) => callback(data));
  },
});
