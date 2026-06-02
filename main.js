const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const https = require('https');
const { spawn } = require('child_process');

let mainWindow;
let projectPath = null;
let serverProcess = null;

// ─── AI Engine path ────────────────────────────────────

function getAIEngineExe() {
  const userDataExe = path.join(app.getPath('userData'), 'opencode.exe');
  if (fs.existsSync(userDataExe)) return userDataExe;
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

// ─── OpenCode download (no npm required) ──────────────

function getPlatformPackageName() {
  const pmap = { win32: 'windows', darwin: 'darwin', linux: 'linux' };
  const amap = { x64: 'x64', arm64: 'arm64' };
  return `opencode-${pmap[process.platform] || process.platform}-${amap[process.arch] || process.arch}`;
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function fetchBuffer(url, onProgress) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.headers.location) {
        https.get(res.headers.location, (res2) => {
          const total2 = parseInt(res2.headers['content-length'] || '0', 10);
          const chunks = []; let dl = 0;
          res2.on('data', c => { chunks.push(c); dl += c.length; if (onProgress && total2) onProgress(dl / total2); });
          res2.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      const chunks = []; let dl = 0;
      res.on('data', c => { chunks.push(c); dl += c.length; if (onProgress && total) onProgress(dl / total); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function extractTarGz(buffer, targetFile) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(buffer, (err, tar) => {
      if (err) return reject(err);
      let offset = 0;
      while (offset < tar.length) {
        if (tar[offset] === 0) break;
        const name = tar.subarray(offset, offset + 100).toString('utf-8').replace(/\0.*$/, '');
        const sizeStr = tar.subarray(offset + 124, offset + 136).toString('utf-8').replace(/\0.*$/, '');
        const size = parseInt(sizeStr, 8) || 0;
        if (name.endsWith('/opencode.exe')) {
          const data = tar.subarray(offset + 512, offset + 512 + size);
          const dir = path.dirname(targetFile);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(targetFile, data);
          try { fs.chmodSync(targetFile, 0o755); } catch {}
          resolve(true);
          return;
        }
        offset += 512 + Math.ceil(size / 512) * 512;
      }
      reject(new Error('opencode.exe not found in package'));
    });
  });
}

async function downloadOpenCodePlatform(onProgress) {
  const targetExe = path.join(app.getPath('userData'), 'opencode.exe');
  if (fs.existsSync(targetExe)) return targetExe;

  const packageName = getPlatformPackageName();
  const pkgInfo = await fetchJSON(`https://registry.npmjs.org/${packageName}/latest`);
  const tarballUrl = pkgInfo.dist.tarball;

  mainWindow?.webContents.send('install-progress', { phase: 'download' });
  const tarball = await fetchBuffer(tarballUrl, (pct) => {
    mainWindow?.webContents.send('install-progress', { phase: 'download', progress: pct });
  });

  mainWindow?.webContents.send('install-progress', { phase: 'extract' });
  await extractTarGz(tarball, targetExe);

  return targetExe;
}

// ─── Window ─────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  startServer();
}

// ─── Error handlers ─────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

Menu.setApplicationMenu(null);

// ─── Auto-updater ────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update-status', 'Checking for updates...');
  });
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-status', `Update v${info.version} available. Downloading...`);
    mainWindow?.webContents.send('update-available', info);
  });
  autoUpdater.on('download-progress', (p) => {
    mainWindow?.webContents.send('update-progress', p.percent);
  });
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-downloaded');
    mainWindow?.webContents.send('update-status', 'Update ready. Restart to apply.');
  });
  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err?.message || err);
  });
}

ipcMain.on('check-for-updates', () => {
  autoUpdater.checkForUpdatesAndNotify();
});

ipcMain.on('restart-for-update', () => {
  autoUpdater.quitAndInstall();
});

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
  autoUpdater.checkForUpdatesAndNotify();
});

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

// ─── Skill Creator Agent ───────────────────────────────

const SKILL_CREATOR_AGENT = `---
description: >
  Creador profesional de skills para asistentes de código AI. Úsalo cuando
  necesites crear, modificar o depurar skills. Los skills generados son
  compatibles con Claude Code, Codex CLI, Gemini CLI, GitHub Copilot,
  Cursor, Windsurf y 20+ asistentes más (formato SKILL.md estándar).
mode: all
permission:
  read: allow
  edit: allow
  write: allow
  glob: allow
  grep: allow
  bash: allow
---

Eres un experto creador de skills para asistentes de código AI. Conoces:

1. **Formato SKILL.md** — frontmatter con \`name\`, \`description\`, \`type\`, \`compatibility\`
2. **Ruta del skill**: \`.opencode/skills/<nombre>/SKILL.md\`
3. **Reglas**:
   - \`name\` es obligatorio, en minúsculas con guiones, máx 64 caracteres
   - \`description\` debe describir QUÉ hace el skill y CUÁNDO usarlo
   - \`type\` debe ser \`skill\`
4. **Compatibilidad**: Los skills generados funcionan en Claude Code, Codex CLI, Gemini CLI, GitHub Copilot, Cursor y cualquier asistente que soporte SKILL.md. Incluir \`compatibility\` en frontmatter.

**Reglas importantes sobre el contenido del skill:**
- NO incluyas secciones de "Cómo usarlo", "Cómo se activa", "@", ni instrucciones de uso. El AI lo detecta automáticamente cuando el usuario habla del tema.
- NO incluyas "Reinicia", "reiniciar", ni ninguna instrucción de reinicio o recarga.
- NO incluyas recomendaciones de herramientas externas ni cómo acceder a nada.
- El usuario objetivo ya sabe qué hacer con el skill — el contenido debe ser puramente la instrucción para el AI, sin explicaciones al usuario.
- Si aplica, incluye una advertencia clara de que no reemplaza ayuda profesional.

Siempre que crees un skill:
- Pregunta al usuario qué debe hacer el skill
- Propón un \`name\` y \`description\` claros
- Escribe el archivo SKILL.md en la ruta \`.opencode/skills/<nombre>/SKILL.md\`
- Si existe \`opencode.json\`, agrega la ruta \`.opencode/skills/<nombre>/SKILL.md\` al array \`instructions\` si no está
- **No devuelvas el contenido del archivo en tu respuesta.** Tu respuesta debe ser únicamente: "Skill creada. Encontrarás la skill en el panel Skills."`;

function ensureSkillCreatorAgent() {
  const p = getProjectPath();
  if (!p) return;
  const agentsDir = path.join(p, '.opencode', 'agents');
  const agentFile = path.join(agentsDir, 'skill-creator.md');
  if (fs.existsSync(agentFile)) return;
  if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(agentFile, SKILL_CREATOR_AGENT, 'utf-8');
}

ipcMain.handle('select-project', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (!result.canceled && result.filePaths.length > 0) {
    projectPath = result.filePaths[0];
    ensureSkillCreatorAgent();
    stopServer();
    startServer();
    return { success: true, path: projectPath };
  }
  return { success: false };
});

ipcMain.handle('get-project-info', async () => {
  const p = getProjectPath();
  if (!p) return { path: null, name: null, exists: false, skillsCount: 0, skills: [] };

  const skillsDir = getSkillsDir();
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

// ─── IPC: Window controls ──────────────────────────────

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow?.unmaximize(); else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

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
  try {
    await downloadOpenCodePlatform((pct) => {
      mainWindow?.webContents.send('install-progress', { phase: 'download', progress: pct });
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
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

    ensureSkillCreatorAgent();

    const child = spawn(exe, ['run', message, '--agent', 'skill-creator', '--dangerously-skip-permissions'], {
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
