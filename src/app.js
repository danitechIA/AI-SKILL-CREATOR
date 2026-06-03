// ─── State ───
let state = {
  projectInfo: null,
  aiEngineInstalled: false,
  currentView: 'home',
  theme: 'light',
  editorSkillName: null,
  editorHasChanges: false,
};

// ─── Router ───
function navigate(view) {
  if (state.editorHasChanges && !confirm('Tienes cambios sin guardar. ¿Descartarlos?')) return;
  state.editorHasChanges = false;
  state.currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  renderView(view);
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
});

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.querySelector('.modal-overlay');
    if (modal) modal.remove();
  }
  if (e.key === 'n' && (e.ctrlKey || e.metaKey) && state.currentView === 'skills') {
    e.preventDefault();
    showCreateSkillModal();
  }
});

// ─── Toast ───
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ─── Init ───
async function init() {
  // Restore theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') document.body.classList.add('dark');

  const oc = await window.api.checkAIEngine();
  state.aiEngineInstalled = oc.installed;

  const info = await window.api.getProjectInfo();
  state.projectInfo = info;
  updateProjectStatus(info);

  setupUpdateListeners();
  setupChatListeners();

  renderView('home');
}

function setupUpdateListeners() {
  window.api.onCheckUpdatesAuto(async () => {
    await checkForUpdates();
  });
}

async function checkForUpdates() {
  const result = await window.api.checkForUpdates();
  if (result.hasUpdate) {
    showToast(`v${result.latest} disponible. Descargá la nueva versión desde GitHub.`, 'info');
  }
}

function updateProjectStatus(info) {
  const el = document.getElementById('project-status');
  if (info && info.exists) {
    el.textContent = info.name + ' (' + (info.skillsCount || 0) + ' skills)';
  } else {
    el.textContent = 'No project loaded';
  }
}

// ─── Renderers ───
function renderView(view) {
  const container = document.getElementById('view-container');
  container.style.display = 'block';
  document.getElementById('loading-screen').style.display = 'none';

  try {
    switch (view) {
      case 'home': renderHome(container); break;
      case 'skills': renderSkills(container); break;
      case 'chat': renderChat(container); break;
      case 'settings': renderSettings(container); break;
    }
  } catch (err) {
    console.error('Render error:', err);
    container.innerHTML = `
      <div class="empty-state">
        <h3>Something went wrong</h3>
        <p>${escapeHtml(err.message || 'An unexpected error occurred')}</p>
        <button class="btn btn-primary" onclick="navigate('home')">Back to Dashboard</button>
      </div>`;
  }
}

// ─── Home ───
function renderHome(container) {
  const info = state.projectInfo;
  if (!info || !info.exists) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No project selected</h3>
        <p>Select a project folder to get started</p>
        <button class="btn btn-primary" onclick="selectProject()">Select Project Folder</button>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="header">
      <h1>Dashboard</h1>
      <button class="btn btn-secondary" onclick="selectProject()">Change Project</button>
    </div>

    <div class="card-grid" style="margin-bottom:24px">
      <div class="card stat-card">
        <div class="stat-value">${info.skillsCount || 0}</div>
        <div class="stat-label">Skills</div>
      </div>
      <div class="card stat-card">
        <div class="stat-value">${state.aiEngineInstalled ? '&#10003;' : '&#10007;'}</div>
        <div class="stat-label">AI Engine ${state.aiEngineInstalled ? 'Ready' : 'Not detected'}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-bottom:8px;font-size:15px">Project: ${info.name}</h3>
      <p style="font-size:13px;color:var(--text-secondary);word-break:break-all">${info.path}</p>
    </div>

    ${!state.aiEngineInstalled ? `
    <div class="install-banner">
      <h3>AI Engine not detected</h3>
      <p>The Agent Chat feature requires an AI engine installed. Install it now.</p>
      <button class="btn btn-primary" onclick="installAIEngine()">Install AI Engine</button>
    </div>` : ''}
  `;
}

async function selectProject() {
  const result = await window.api.selectProject();
  if (result.success) {
    state.projectInfo = await window.api.getProjectInfo();
    updateProjectStatus(state.projectInfo);
    renderView(state.currentView);
    showToast('Project loaded: ' + state.projectInfo.name);
  }
}

async function installAIEngine() {
  const banner = document.querySelector('.install-banner');
  const btn = banner?.querySelector('.btn');

  const progress = document.createElement('div');
  progress.className = 'install-progress';
  progress.innerHTML = '<div class="install-progress-bar" style="width:0%"></div><p class="install-progress-text" style="margin-top:8px;font-size:12px;color:var(--text-secondary)">Starting...</p>';
  if (banner) banner.appendChild(progress);
  if (btn) { btn.textContent = 'Installing...'; btn.disabled = true; }

  const bar = progress?.querySelector('.install-progress-bar');
  const text = progress?.querySelector('.install-progress-text');

  window.api.onInstallProgress((data) => {
    if (data.phase === 'download' && bar) {
      if (text) text.textContent = 'Downloading AI Engine...';
      bar.style.width = Math.round((data.progress || 0) * 90) + '%';
    }
    if (data.phase === 'extract' && bar) {
      bar.style.width = '95%';
      if (text) text.textContent = 'Extracting...';
    }
  });

  const result = await window.api.installAIEngine();
  if (result.success) {
    state.aiEngineInstalled = true;
    if (bar) bar.style.width = '100%';
    if (text) text.textContent = 'Done!';
    showToast('AI Engine installed successfully!');
    renderView(state.currentView);
  } else {
    showToast('Installation failed: ' + result.error, 'error');
    renderView(state.currentView);
  }
}

// ─── Skills ───
function renderSkills(container) {
  const info = state.projectInfo;

  if (!info || !info.exists) {
    container.innerHTML = `<div class="empty-state"><h3>No project loaded</h3></div>`;
    return;
  }

  container.innerHTML = `
    <div class="header">
      <h1>Skills</h1>
      <button class="btn btn-primary" onclick="showCreateSkillModal()">+ New Skill</button>
    </div>
    <div class="skills-toolbar">
      <input class="skills-search" type="text" placeholder="Search skills..." id="skills-search" oninput="renderSkillsList()" />
    </div>
    <div id="skills-list-wrapper">${renderSkillsListHtml(info.skills)}</div>
  `;
}

function renderSkillsListHtml(skills) {
  const term = (document.getElementById('skills-search')?.value || '').toLowerCase().trim();
  const filtered = term ? skills.filter(s =>
    s.displayName.toLowerCase().includes(term) ||
    s.name.toLowerCase().includes(term) ||
    (s.description || '').toLowerCase().includes(term)
  ) : skills;

  if (filtered.length === 0) {
    const msg = term ? `No skills matching "${escapeHtml(term)}"` : 'No skills yet';
    return `
    <div class="empty-state">
      <h3>${msg}</h3>
      ${!term ? '<p>Create your first skill to get started</p><button class="btn btn-primary" onclick="showCreateSkillModal()">Create Skill</button>' : ''}
    </div>`;
  }

  return `
    <div class="card-grid" id="skills-list">
      ${filtered.map(s => `
        <div class="card skill-card" data-skill="${escapeAttr(s.name)}" onclick="editSkill(this.dataset.skill)">
          <h3>${escapeHtml(s.displayName)}</h3>
          <p>${escapeHtml(s.description || 'No description')}</p>
          <div class="skill-actions">
            <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();editSkill(this.closest('.skill-card').dataset.skill)">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteSkillConfirm(this.closest('.skill-card').dataset.skill)">Delete</button>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function renderSkillsList() {
  const wrapper = document.getElementById('skills-list-wrapper');
  if (wrapper) wrapper.innerHTML = renderSkillsListHtml(state.projectInfo?.skills || []);
}

function showCreateSkillModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>Create New Skill</h2>
      <div class="form-group">
        <label>Name (kebab-case, e.g. json-validator)</label>
        <input type="text" id="skill-name" placeholder="my-awesome-skill" />
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea id="skill-desc" placeholder="Use when the user asks to...">Use when the user needs to</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="createSkill()">Create</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('skill-name').focus();
}

async function createSkill() {
  const name = document.getElementById('skill-name').value.trim();
  const desc = document.getElementById('skill-desc').value.trim();

  if (!name) { showToast('Name is required', 'error'); return; }
  if (!/^[a-z0-9-]+$/.test(name)) { showToast('Use kebab-case: lowercase letters, numbers, hyphens', 'error'); return; }

  const result = await window.api.createSkill(name, desc);
  if (result.success) {
    document.querySelector('.modal-overlay').remove();
    state.projectInfo = await window.api.getProjectInfo();
    updateProjectStatus(state.projectInfo);
    renderView('skills');
    showToast('Skill "' + name + '" created!');
  } else {
    showToast(result.error || 'Failed to create skill', 'error');
  }
}

async function deleteSkillConfirm(name) {
  if (!confirm('Delete skill "' + name + '"? This cannot be undone.')) return;
  const result = await window.api.deleteSkill(name);
  if (result.success) {
    state.projectInfo = await window.api.getProjectInfo();
    updateProjectStatus(state.projectInfo);
    renderView('skills');
    showToast('Skill "' + name + '" deleted');
  } else {
    showToast(result.error, 'error');
  }
}

async function editSkill(name) {
  const path = `.opencode/skills/${name}/SKILL.md`;
  const result = await window.api.readFile(path);

  const container = document.getElementById('view-container');

  if (result.success) {
    state.editorSkillName = name;
    state.editorHasChanges = false;
    container.innerHTML = `
      <div class="header">
        <h1>${name}</h1>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary" onclick="navigate('skills')">Back</button>
          <button class="btn btn-primary" onclick="saveSkillEdit()">Save</button>
        </div>
      </div>
      <div class="editor-container">
        <textarea class="editor-textarea" id="editor-content" oninput="state.editorHasChanges=true">${escapeHtml(result.content)}</textarea>
      </div>
    `;
  } else {
    showToast('Failed to read skill file', 'error');
  }
}

async function saveSkillEdit() {
  const content = document.getElementById('editor-content').value;
  const path = `.opencode/skills/${state.editorSkillName}/SKILL.md`;
  const result = await window.api.writeFile(path, content);
  if (result.success) {
    state.editorHasChanges = false;
    showToast('Skill saved!');
  } else {
    showToast('Save failed: ' + result.error, 'error');
  }
}

// ─── Chat ───
let chatHistory = [];

let chatStreamBuffer = '';
let chatStreamMsgIndex = -1;
let chatRunning = false;

function setupChatListeners() {
  window.api.onAIOutput((data) => {
    chatStreamBuffer += stripAIBranding(data);
    chatHistory[chatStreamMsgIndex].content = chatStreamBuffer;
    if (state.currentView === 'chat') {
      const msgs = document.querySelectorAll('.chat-messages .message.assistant');
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg) {
        lastMsg.textContent = chatStreamBuffer;
        document.getElementById('chat-messages')?.scrollTo(0, 999999);
      }
    }
  });

  window.api.onAIDone((result) => {
    const displayText = stripAIBranding(chatStreamBuffer || '(no output)');
    chatHistory[chatStreamMsgIndex].content = displayText;
    chatRunning = false;
    if (state.currentView === 'chat') {
      const msgs = document.querySelectorAll('.chat-messages .message.assistant');
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg) lastMsg.textContent = displayText;
      document.getElementById('chat-status').textContent = result.success ? '' : 'Command finished with errors';
      document.getElementById('chat-input').disabled = false;
      document.getElementById('chat-send-btn').disabled = false;
      document.getElementById('chat-input').focus();
      document.getElementById('chat-messages')?.scrollTo(0, 999999);
    }
  });
}

function renderChat(container) {
  if (!state.aiEngineInstalled) {
    container.innerHTML = `
      <div class="header"><h1>Agent Chat</h1></div>
      <div class="install-banner">
        <h3>AI Engine required</h3>
        <p>Install the AI engine to use the agent chat feature.</p>
        <button class="btn btn-primary" onclick="installAIEngine()">Install AI Engine</button>
      </div>`;
    return;
  }

  const info = state.projectInfo;
  if (!info || !info.exists) {
    container.innerHTML = `<div class="empty-state"><h3>Select a project first</h3></div>`;
    return;
  }

  container.innerHTML = `
    <div class="header">
      <h1>Agent Chat</h1>
      <button class="btn btn-sm btn-secondary" onclick="clearChat()">Clear Chat</button>
    </div>
    <div class="chat-container">
      <div class="chat-messages" id="chat-messages">
        <div class="message system">AI Skill Generator active in project: ${info.name}.</div>
        ${chatHistory.map(m => `
          <div class="message ${m.role}">${escapeHtml(m.content)}</div>
        `).join('')}
      </div>
      <div id="chat-status" class="chat-status">${chatRunning ? 'Processing...' : ''}</div>
      <div class="chat-input-area">
        <input type="text" class="chat-input" id="chat-input"
          placeholder="Ask the agent..." onkeydown="if(event.key==='Enter' && !event.shiftKey)sendChat()"
          ${chatRunning ? 'disabled' : ''} />
        <button class="btn btn-primary" id="chat-send-btn" onclick="sendChat()" ${chatRunning ? 'disabled' : ''}>Send</button>
      </div>
    </div>
  `;
  if (!chatRunning) document.getElementById('chat-input')?.focus();
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  input.value = '';
  input.disabled = true;
  document.getElementById('chat-send-btn').disabled = true;
  document.getElementById('chat-status').textContent = 'Processing...';
  chatRunning = true;

  chatHistory.push({ role: 'user', content: msg });
  appendMessage('user', msg);

  chatStreamBuffer = '';
  chatStreamMsgIndex = chatHistory.length;
  chatHistory.push({ role: 'assistant', content: '' });
  appendMessage('assistant', '⏳ waiting...');

  let result;
  try {
    result = await Promise.race([
      window.api.runAI(msg),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout (120s)')), 120000))
    ]);
  } catch (e) {
    chatRunning = false;
    chatHistory[chatStreamMsgIndex].content = 'Error: ' + e.message;
    if (state.currentView === 'chat') {
      const msgs = document.querySelectorAll('.chat-messages .message.assistant');
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg) lastMsg.textContent = 'Error: ' + e.message;
      document.getElementById('chat-status').textContent = '';
      input.disabled = false;
      document.getElementById('chat-send-btn').disabled = false;
      input.focus();
    }
    return;
  }

  if (!result.success && !result.output) {
    chatRunning = false;
    chatHistory[chatStreamMsgIndex].content = 'Error: ' + (result.error || 'Command failed');
    if (state.currentView === 'chat') {
      const msgs = document.querySelectorAll('.chat-messages .message.assistant');
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg) lastMsg.textContent = 'Error: ' + (result.error || 'Command failed');
      document.getElementById('chat-status').textContent = '';
    }
  }

  const refreshed = await window.api.getProjectInfo();
  if (refreshed) {
    state.projectInfo = refreshed;
    updateProjectStatus(refreshed);
    if (state.currentView === 'skills') renderView('skills');
  }
}

function appendMessage(role, content) {
  const el = document.getElementById('chat-messages');
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'message ' + role;
  div.textContent = content;
  el.appendChild(div);
  el.scrollTo(0, 999999);
}

function clearChat() {
  chatHistory = [];
  chatStreamBuffer = '';
  chatStreamMsgIndex = -1;
  renderView('chat');
}

// ─── Settings ───
function renderSettings(container) {
  const isDark = document.body.classList.contains('dark');
  const info = state.projectInfo;

  container.innerHTML = `
    <div class="header"><h1>Settings</h1></div>

    <div class="card settings-section">
      <h2>Appearance</h2>
      <div class="setting-row">
        <label>Dark Mode</label>
        <button class="toggle ${isDark ? 'active' : ''}" onclick="toggleTheme()"></button>
      </div>
    </div>

    <div class="card settings-section">
      <h2>Project</h2>
      <div class="setting-row">
        <label>Current project: ${info?.name || 'None'}</label>
        <button class="btn btn-sm btn-secondary" onclick="selectProject()">Change</button>
      </div>
      ${info ? `<div style="font-size:13px;color:var(--text-secondary);word-break:break-all;margin-top:8px">${info.path}</div>` : ''}
    </div>

    <div class="card settings-section">
      <h2>AI Engine</h2>
      <div class="setting-row">
        <label>Status: ${state.aiEngineInstalled ? 'Ready' : 'Not detected'}</label>
        ${!state.aiEngineInstalled ? `<button class="btn btn-sm btn-primary" onclick="installAIEngine()">Install Engine</button>` : ''}
      </div>
    </div>

    <div class="card settings-section">
      <h2>About</h2>
      <div style="font-size:13px;color:var(--text-secondary)">
        <p>AI Skill Generator v1.0.0</p>
        <p>Desktop application for managing AI coding skills.</p>
        <p style="margin-top:8px">
          <a href="#" onclick="event.preventDefault();navigate('home')" style="color:var(--primary)">Dashboard</a>
          &middot;
          <a href="#" onclick="event.preventDefault();navigate('skills')" style="color:var(--primary)">Skills</a>
          &middot;
          <a href="#" onclick="event.preventDefault();navigate('chat')" style="color:var(--primary)">Agent Chat</a>
        </p>
      </div>
    </div>
  `;
}

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// ─── Utils ───
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripAIBranding(text) {
  return text.replace(/(?<![.@\/])\bOpenCode\b(?!-)/gi, 'AI Skill Generator');
}

// ─── Start ───
document.addEventListener('DOMContentLoaded', init);
