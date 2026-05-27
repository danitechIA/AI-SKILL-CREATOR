const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let projectPath = null;
let serverProcess = null;

// ─── AI Engine path ────────────────────────────────────

function getAIEngineExe() {
  const npmDir = path.join(process.env.APPDATA, 'npm', 'node_modules', 'opencode-ai', 'bin');
  const exe = path.join(npmDir, 'opencode.exe');
  if (fs.existsSync(exe)) return exe;
  return null;
}

// ─── Server management ──────────────────────────────────

function startServer() {
  const cwd = getProjectPath();
  if (!cwd || !fs.existsSync(cwd)) return;

  const exe = getAIEngineExe();
  if (!exe) return;

  const child = spawn(exe, ['serve', '--port', '0'], {
    cwd,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  child.unref();
  serverProcess = child;
}

function stopServer() {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch {}
    try { process.kill(serverProcess.pid); } catch {}
    serverProcess = null;
  }
}

// ─── Strip ANSI ─────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1B(?:\[[0-9;]*[a-zA-Z]|\\|.)/g, '').trim();
}

// ─── Window ─────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  startServer();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => { stopServer(); app.quit(); });
app.on('before-quit', () => { stopServer(); });

// ─── Project helpers ────────────────────────────────────

function getProjectPath() {
  return projectPath || null;
}

function getSkillsDir() {
  const p = getProjectPath();
  return p ? path.join(p, '.opencode', 'skills') : null;
}

function getConfigPath() {
  const p = getProjectPath();
  return p ? path.join(p, 'opencode.json') : null;
}

// ─── IPC: Project ───────────────────────────────────────

ipcMain.handle('select-project', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (!result.canceled && result.filePaths.length > 0) {
    projectPath = result.filePaths[0];
    stopServer();
    startServer();
    return { success: true, path: projectPath };
  }
  return { success: false };
});

ipcMain.handle('get-project-info', async () => {
  const p = getProjectPath();
  if (!p) return { path: null, name: null, exists: false, skillsCount: 0, skills: [], config: null };

  const skillsDir = getSkillsDir();
  const configPath = getConfigPath();
  const info = { path: p, name: path.basename(p), exists: true };

  if (skillsDir && fs.existsSync(skillsDir)) {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    info.skillsCount = entries.filter(e => e.isDirectory()).length;
    info.skills = entries.filter(e => e.isDirectory()).map(e => {
      const skillPath = path.join(skillsDir, e.name, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        const content = fs.readFileSync(skillPath, 'utf-8');
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const descMatch = content.match(/^description:\s*>\s*\n\s*(.+)$/m);
        return { name: e.name, displayName: nameMatch ? nameMatch[1].trim() : e.name, description: descMatch ? descMatch[1].trim() : '', path: skillPath };
      }
      return { name: e.name, displayName: e.name, description: '', path: skillPath };
    });
  } else {
    info.skillsCount = 0;
    info.skills = [];
  }

  if (configPath && fs.existsSync(configPath)) {
    try { info.config = JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { info.config = null; }
  } else {
    info.config = null;
  }

  return info;
});

// ─── IPC: Files ─────────────────────────────────────────

function isPathSafe(base, target) {
  const baseResolved = path.resolve(base);
  const targetResolved = path.resolve(base, target);
  return targetResolved.startsWith(baseResolved + path.sep) || targetResolved === baseResolved;
}

ipcMain.handle('read-file', async (_, filePath) => {
  try {
    const base = getProjectPath();
    if (!base) return { success: false, error: 'No project selected' };
    if (!isPathSafe(base, filePath)) return { success: false, error: 'Path is outside project' };
    const fullPath = path.resolve(base, filePath);
    if (!fs.existsSync(fullPath)) return { success: false, error: 'File not found' };
    return { success: true, content: fs.readFileSync(fullPath, 'utf-8') };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('write-file', async (_, filePath, content) => {
  try {
    const base = getProjectPath();
    if (!base) return { success: false, error: 'No project selected' };
    if (!isPathSafe(base, filePath)) return { success: false, error: 'Path is outside project' };
    const fullPath = path.resolve(base, filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('delete-file', async (_, filePath) => {
  try {
    const base = getProjectPath();
    if (!base) return { success: false, error: 'No project selected' };
    if (!isPathSafe(base, filePath)) return { success: false, error: 'Path is outside project' };
    const fullPath = path.resolve(base, filePath);
    if (fs.existsSync(fullPath)) fs.rmSync(fullPath, { recursive: true });
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// ─── IPC: Skills ────────────────────────────────────────

ipcMain.handle('create-skill', async (_, name, description) => {
  try {
    const skillsDir = getSkillsDir();
    if (!skillsDir) return { success: false, error: 'No project selected' };
    const skillDir = path.join(skillsDir, name);
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (fs.existsSync(skillDir)) return { success: false, error: 'Skill already exists' };
    fs.mkdirSync(skillDir, { recursive: true });

    const template = `---
name: ${name}
description: >
  ${description}
type: skill
compatibility: claude-code, cursor, codex-cli, gemini-cli, github-copilot, windsurf, aider, continue.dev
---

# ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}

Instructions for this skill...
`;
    fs.writeFileSync(skillFile, template, 'utf-8');

    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const entry = `.opencode/skills/${name}/SKILL.md`;
      if (!Array.isArray(config.instructions)) config.instructions = [];
      if (!config.instructions.includes(entry)) {
        config.instructions.push(entry);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      }
    }
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('delete-skill', async (_, name) => {
  try {
    const skillsDir = getSkillsDir();
    if (!skillsDir) return { success: false, error: 'No project selected' };
    const skillDir = path.join(skillsDir, name);
    if (!fs.existsSync(skillDir)) return { success: false, error: 'Skill not found' };
    fs.rmSync(skillDir, { recursive: true });

    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const entry = `.opencode/skills/${name}/SKILL.md`;
      if (!Array.isArray(config.instructions)) config.instructions = [];
      config.instructions = config.instructions.filter(i => i !== entry);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    }
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

ipcMain.handle('save-config', async (_, config) => {
  try {
    const configPath = getConfigPath();
    if (!configPath) return { success: false, error: 'No project selected' };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    return { success: true };
  } catch (err) { return { success: false, error: err.message }; }
});

// ─── IPC: AI Engine ─────────────────────────────────────

ipcMain.handle('check-ai-engine', async () => {
  const exe = getAIEngineExe();
  if (!exe) return { installed: false, version: null };
  return new Promise((resolve) => {
    const child = spawn(exe, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', d => out += d.toString());
    child.on('close', () => resolve({ installed: true, version: out.trim() }));
    child.on('error', () => resolve({ installed: false, version: null }));
  });
});

ipcMain.handle('install-ai-engine', async () => {
  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '-g', '@opencode-ai/cli'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', d => stderr += d.toString());
    child.on('close', (code) => {
      resolve({ success: code === 0, error: code !== 0 ? (stderr || 'npm install failed') : undefined });
    });
    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
});

ipcMain.handle('run-ai', async (_, message) => {
  return new Promise((resolve) => {
    const cwd = getProjectPath();
    const exe = getAIEngineExe();

    if (!cwd) {
      resolve({ success: false, error: 'No project selected' });
      return;
    }
    if (!exe) {
      resolve({ success: false, error: 'AI Engine not found' });
      return;
    }

    const prefixed = `Your name is AI Skill Generator.\n\n${message}`;

    const child = spawn(exe, ['run', prefixed], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      mainWindow?.webContents.send('ai-output', d.toString());
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      const output = stripAnsi(stdout || stderr);
      const success = code === 0;
      mainWindow?.webContents.send('ai-done', { success, output });
      resolve({ success, output });
    });

    child.on('error', (err) => {
      mainWindow?.webContents.send('ai-done', { success: false, output: '' });
      resolve({ success: false, error: err.message });
    });
  });
});
