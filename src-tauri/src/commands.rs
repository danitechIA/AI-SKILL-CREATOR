use serde::{Deserialize, Serialize};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use tauri::{Emitter, Manager};

use crate::AppState;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x08000000;

const DEFAULT_AI_MODEL: &str = "opencode/deepseek-v4-flash-free";

const SKILL_CREATOR_AGENT: &str = r#"---
description: SKILL.md creator. Helps users create skills for any purpose.
mode: all
permission:
  read: allow
  edit: allow
  write: allow
---

You are a skill creation specialist. Your goal is to understand what skill the user needs and generate it.

**CRITICAL — LANGUAGE RULE:** Always reply in the SAME LANGUAGE the user writes to you. If the user writes in English, reply in English ONLY. If the user writes in Spanish, reply in Spanish ONLY. Never switch languages. Never default to Spanish. Mirror their language exactly.

**What you DO:**
- Talk to the user to understand what skill they need
- Ask relevant details (purpose, expected behavior, inputs/outputs)
- Propose a name and description for the skill
- Generate the SKILL.md file at .opencode/skills/<name>/SKILL.md
- Modify existing skills if the user asks

**What you DON'T do:**
- Don't talk about yourself, the model you run on, or how you were created
- Don't give information about this app, how it works, or the project
- Don't explain what a skill is or how to use it
- Don't include usage instructions in the skill content (@, restarts, activation)
- Don't return the full SKILL.md content in your response

**SKILL.md format:**
- YAML frontmatter between ---
- name: required (lowercase, hyphens, max 64 chars)
- description: required
- Optional: type, compatibility, version, author
- Compatible with Claude Code, Cursor, Codex CLI, Gemini CLI, GitHub Copilot, Windsurf and more
- Skill content in markdown after the frontmatter

When you generate a skill, reply only with the name and "Skill created.""#;

const REPO_OWNER: &str = "danitechIA";
const REPO_NAME: &str = "AI-SKILL-CREATOR";
const RAW_PKG_URL: &str =
    "https://raw.githubusercontent.com/danitechIA/AI-SKILL-CREATOR/master/package.json";

fn opencode_bin_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "opencode.exe"
    } else {
        "opencode"
    }
}

fn platform_package_name() -> String {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    format!("opencode-{}-{}", os, arch)
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.next() {
                Some('[') => {
                    while let Some(n) = chars.next() {
                        if n == 'm' || n == 'H' || n == 'J' || n == 'K' || n.is_ascii_alphabetic() {
                            break;
                        }
                    }
                }
                _ => {}
            }
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

fn semver_gt(a: &str, b: &str) -> bool {
    let pa: Vec<u32> = a.split('.').filter_map(|s| s.parse().ok()).collect();
    let pb: Vec<u32> = b.split('.').filter_map(|s| s.parse().ok()).collect();
    for i in 0..3 {
        let va = pa.get(i).copied().unwrap_or(0);
        let vb = pb.get(i).copied().unwrap_or(0);
        if va > vb {
            return true;
        }
        if va < vb {
            return false;
        }
    }
    false
}

fn is_path_safe(base: &Path, target: &str) -> bool {
    let resolved = base.join(target);
    let canonical_base = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let canonical_target = resolved.canonicalize().unwrap_or(resolved);
    canonical_target.starts_with(&canonical_base)
}

fn build_context_message(message: &str, history: &[ChatEntry]) -> String {
    if history.is_empty() {
        return message.to_string();
    }
    let mut lines = vec!["[Historial de la conversación:]".to_string()];
    for entry in history {
        if entry.role == "system" {
            continue;
        }
        let label = if entry.role == "user" {
            "Usuario"
        } else {
            "Asistente"
        };
        lines.push(format!("{}: {}", label, entry.content));
    }
    lines.push(String::new());
    lines.push("[Nuevo mensaje del usuario:]".to_string());
    lines.push(message.to_string());
    lines.join("\n")
}

fn ensure_skill_creator_agent(project_path: &Path) {
    let agents_dir = project_path.join(".opencode").join("agents");
    let agent_file = agents_dir.join("skill-creator.md");
    let _ = std::fs::create_dir_all(&agents_dir);
    let _ = std::fs::write(&agent_file, SKILL_CREATOR_AGENT);
}

fn find_ai_engine(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let bin_name = opencode_bin_name();

    if let Ok(data_dir) = app_handle.path().app_data_dir() {
        let exe = data_dir.join(bin_name);
        if exe.exists() {
            return Some(exe);
        }
    }

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()?;
    let home_path = PathBuf::from(&home);

    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        if let Ok(appdata) = std::env::var("APPDATA") {
            vec![
                PathBuf::from(appdata).join("npm/node_modules/opencode-ai/bin"),
            ]
        } else {
            vec![]
        }
    } else {
        vec![
            home_path.join("npm-global/bin"),
            PathBuf::from("/usr/local/lib/node_modules/opencode-ai/bin"),
            home_path.join(".npm-global/bin"),
        ]
    };

    for dir in candidates {
        let exe = dir.join(bin_name);
        if exe.exists() {
            return Some(exe);
        }
    }
    None
}

fn download_ai_engine(
    app_handle: &tauri::AppHandle,
    on_progress: impl Fn(f64) + Send + 'static,
) -> Result<PathBuf, String> {
    let bin_name = opencode_bin_name();
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {}", e))?;
    let target_exe = data_dir.join(bin_name);

    if target_exe.exists() {
        return Ok(target_exe);
    }

    let package_name = platform_package_name();
    let registry_url = format!("https://registry.npmjs.org/{}/latest", package_name);

    let client = reqwest::blocking::Client::new();
    let pkg_info: serde_json::Value = client
        .get(&registry_url)
        .header("Accept", "application/json")
        .send()
        .map_err(|e| format!("Failed to fetch package info: {}", e))?
        .json()
        .map_err(|e| format!("Failed to parse package info: {}", e))?;

    let tarball_url = pkg_info["dist"]["tarball"]
        .as_str()
        .ok_or_else(|| "No tarball URL found".to_string())?;

    let response = client
        .get(tarball_url)
        .send()
        .map_err(|e| format!("Failed to download: {}", e))?;

    let total = response.content_length().unwrap_or(0) as f64;
    let mut downloaded: u64 = 0;
    let mut data = Vec::new();
    let mut reader = BufReader::new(response);

    loop {
        let mut buf = vec![0u8; 8192];
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Download error: {}", e))?;
        if n == 0 {
            break;
        }
        data.extend_from_slice(&buf[..n]);
        downloaded += n as u64;
        if total > 0.0 {
            on_progress(downloaded as f64 / total);
        }
    }

    extract_tar_gz(&data, &target_exe, bin_name)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&target_exe) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&target_exe, perms);
        }
    }

    Ok(target_exe)
}

fn extract_tar_gz(data: &[u8], target_file: &Path, bin_name: &str) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let decompressed = GzDecoder::new(data);
    let mut archive = Archive::new(decompressed);

    for entry in archive.entries().map_err(|e| format!("Tar error: {}", e))? {
        let mut entry = entry.map_err(|e| format!("Tar entry error: {}", e))?;
        if entry.path().ok().map_or(false, |p| p.ends_with(bin_name)) {
            if let Some(parent) = target_file.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create dir: {}", e))?;
            }
            entry
                .unpack(target_file)
                .map_err(|e| format!("Failed to extract binary: {}", e))?;
            return Ok(());
        }
    }
    Err(format!("{} not found in package", bin_name))
}

fn extract_yaml_field(content: &str, field: &str) -> Option<String> {
    let prefix = format!("{}:", field);
    let mut reading_folded = false;
    let mut folded_lines = Vec::new();

    for line in content.lines() {
        if reading_folded {
            if line.starts_with("  ") || line.starts_with('\t') || line.trim().is_empty() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    folded_lines.push(trimmed);
                }
                continue;
            }
            break;
        }

        let trimmed = line.trim();
        if trimmed.starts_with(&prefix) {
            let value = trimmed[prefix.len()..].trim();
            if value == ">" {
                reading_folded = true;
            } else if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }

    if !folded_lines.is_empty() {
        return Some(folded_lines.join(" "));
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatEntry {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub path: Option<String>,
    pub name: Option<String>,
    pub exists: bool,
    pub skills_count: usize,
    pub skills: Vec<SkillInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInfo {
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub has_update: bool,
    pub current: String,
    pub latest: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn window_minimize(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.minimize();
    }
}

#[tauri::command]
pub async fn window_maximize(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
}

#[tauri::command]
pub async fn window_close(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.close();
    }
}

#[tauri::command]
pub async fn select_project(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<ProjectInfo, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel();

    app_handle.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });

    match rx.recv().map_err(|_| "User cancelled".to_string())? {
        Some(path) => {
            let path_str = path.to_string();
            let project_path = PathBuf::from(&path_str);
            ensure_skill_creator_agent(&project_path);
            *state
                .project_path
                .lock()
                .map_err(|e| e.to_string())? = Some(project_path);
            get_project_info_internal(&state)
        }
        None => Err("User cancelled".to_string()),
    }
}

fn get_project_info_internal(
    state: &tauri::State<'_, AppState>,
) -> Result<ProjectInfo, String> {
    let project_path = state
        .project_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    match project_path {
        Some(path) => {
            let skills_dir = path.join(".opencode").join("skills");
            let mut skills = Vec::new();

            if skills_dir.exists() {
                let entries = std::fs::read_dir(&skills_dir)
                    .map_err(|e| format!("Failed to read skills dir: {}", e))?;
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if !entry_path.is_dir() {
                        continue;
                    }
                    let skill_name = entry.file_name().to_string_lossy().to_string();
                    let skill_file = entry_path.join("SKILL.md");
                    let (display_name, description) = if skill_file.exists() {
                        if let Ok(content) = std::fs::read_to_string(&skill_file) {
                            let dn = extract_yaml_field(&content, "name")
                                .unwrap_or_else(|| skill_name.clone());
                            let desc =
                                extract_yaml_field(&content, "description").unwrap_or_default();
                            (dn, desc)
                        } else {
                            (skill_name.clone(), String::new())
                        }
                    } else {
                        (skill_name.clone(), String::new())
                    };
                    skills.push(SkillInfo {
                        name: skill_name.clone(),
                        display_name,
                        description,
                        path: skill_file.to_string_lossy().to_string(),
                    });
                }
            }

            Ok(ProjectInfo {
                path: Some(path.to_string_lossy().to_string()),
                name: Some(
                    path.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                ),
                exists: true,
                skills_count: skills.len(),
                skills,
            })
        }
        None => Ok(ProjectInfo {
            path: None,
            name: None,
            exists: false,
            skills_count: 0,
            skills: Vec::new(),
        }),
    }
}

#[tauri::command]
pub async fn get_project_info(
    state: tauri::State<'_, AppState>,
) -> Result<ProjectInfo, String> {
    get_project_info_internal(&state)
}

#[tauri::command]
pub async fn read_file(
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<serde_json::Value, String> {
    let base = state
        .project_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No project selected".to_string())?;

    if !is_path_safe(&base, &file_path) {
        return Err("Path is outside project".to_string());
    }

    let full_path = base.join(&file_path);
    if !full_path.exists() {
        return Err("File not found".to_string());
    }

    let content =
        std::fs::read_to_string(&full_path).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(serde_json::json!({ "success": true, "content": content }))
}

#[tauri::command]
pub async fn write_file(
    state: tauri::State<'_, AppState>,
    file_path: String,
    content: String,
) -> Result<serde_json::Value, String> {
    let base = state
        .project_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No project selected".to_string())?;

    if !is_path_safe(&base, &file_path) {
        return Err("Path is outside project".to_string());
    }

    let full_path = base.join(&file_path);
    if let Some(parent) = full_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&full_path, &content)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn delete_file(
    state: tauri::State<'_, AppState>,
    file_path: String,
) -> Result<serde_json::Value, String> {
    let base = state
        .project_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No project selected".to_string())?;

    if !is_path_safe(&base, &file_path) {
        return Err("Path is outside project".to_string());
    }

    let full_path = base.join(&file_path);
    if full_path.exists() {
        if full_path.is_dir() {
            std::fs::remove_dir_all(&full_path)
                .map_err(|e| format!("Failed to delete: {}", e))?;
        } else {
            std::fs::remove_file(&full_path)
                .map_err(|e| format!("Failed to delete: {}", e))?;
        }
    }
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn create_skill(
    state: tauri::State<'_, AppState>,
    name: String,
    description: String,
) -> Result<serde_json::Value, String> {
    let project_path = state
        .project_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No project selected".to_string())?;

    let skills_dir = project_path.join(".opencode").join("skills");
    let skill_dir = skills_dir.join(&name);
    let skill_file = skill_dir.join("SKILL.md");

    if skill_dir.exists() {
        return Err("Skill already exists".to_string());
    }

    std::fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to create skill dir: {}", e))?;

    let display_name = name
        .split('-')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().to_string() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    let template = format!(
        "---\n\
         name: {name}\n\
         description: >\n  {description}\n\
         type: skill\n\
         compatibility: claude-code, cursor, codex-cli, gemini-cli, github-copilot, windsurf, aider, continue.dev\n\
         ---\n\n\
         # {display_name}\n\n\
         Instructions for this skill...\n"
    );

    std::fs::write(&skill_file, &template)
        .map_err(|e| format!("Failed to write skill: {}", e))?;

    let config_path = project_path.join("opencode.json");
    if config_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(mut config) = serde_json::from_str::<serde_json::Value>(&content) {
                let entry = format!(".opencode/skills/{}/SKILL.md", name);
                if let Some(instructions) = config.get_mut("instructions") {
                    if let Some(arr) = instructions.as_array_mut() {
                        if !arr.iter().any(|v| v.as_str() == Some(&entry)) {
                            arr.push(serde_json::Value::String(entry));
                        }
                    }
                } else {
                    config["instructions"] =
                        serde_json::Value::Array(vec![serde_json::Value::String(entry)]);
                }
                if let Ok(updated) = serde_json::to_string_pretty(&config) {
                    let _ = std::fs::write(&config_path, updated);
                }
            }
        }
    }

    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn delete_skill(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<serde_json::Value, String> {
    let project_path = state
        .project_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No project selected".to_string())?;

    let skill_dir = project_path.join(".opencode").join("skills").join(&name);

    if !skill_dir.exists() {
        return Err("Skill not found".to_string());
    }

    std::fs::remove_dir_all(&skill_dir)
        .map_err(|e| format!("Failed to delete skill: {}", e))?;

    let config_path = project_path.join("opencode.json");
    if config_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(mut config) = serde_json::from_str::<serde_json::Value>(&content) {
                let entry = format!(".opencode/skills/{}/SKILL.md", name);
                if let Some(instructions) = config.get_mut("instructions") {
                    if let Some(arr) = instructions.as_array_mut() {
                        arr.retain(|v| v.as_str() != Some(&entry));
                    }
                }
                if let Ok(updated) = serde_json::to_string_pretty(&config) {
                    let _ = std::fs::write(&config_path, updated);
                }
            }
        }
    }

    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn check_ai_engine(
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let exe = find_ai_engine(&app_handle);
    match exe {
        Some(path) => {
            let mut cmd = std::process::Command::new(&path);
            cmd.arg("--version")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            #[cfg(windows)]
            {
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            let output = cmd
                .output()
                .map_err(|e| format!("Failed to run engine: {}", e))?;
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(serde_json::json!({ "installed": true, "version": version }))
        }
        None => Ok(serde_json::json!({ "installed": false, "version": null })),
    }
}

#[tauri::command]
pub async fn install_ai_engine(
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let handle = app_handle.clone();
    let handle2 = handle.clone();
    let result = std::thread::spawn(move || {
        download_ai_engine(&handle, move |progress| {
            let payload = serde_json::json!({
                "phase": "download",
                "progress": progress,
            });
            let _ = handle2.emit("install-progress", payload);
        })
    })
    .join()
    .map_err(|_| "Thread panicked".to_string())?;

    match result {
        Ok(_) => Ok(serde_json::json!({ "success": true })),
        Err(e) => Ok(serde_json::json!({ "success": false, "error": e })),
    }
}

#[tauri::command]
pub async fn run_ai(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    message: String,
    history: Vec<ChatEntry>,
) -> Result<serde_json::Value, String> {
    let project_path = state
        .project_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No project selected".to_string())?;

    let exe = find_ai_engine(&app_handle).ok_or_else(|| "AI Engine not found".to_string())?;

    let contextualized = build_context_message(&message, &history);
    ensure_skill_creator_agent(&project_path);

    let mut cmd = Command::new(&exe);
    cmd.args([
        "run",
        "--model",
        DEFAULT_AI_MODEL,
        "--agent",
        "skill-creator",
        "--dangerously-skip-permissions",
    ])
    .current_dir(&project_path)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .env("FORCE_COLOR", "0");

    #[cfg(windows)]
    {
        cmd.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn process: {}", e))?;

    // Write stdin and close it so child sees EOF
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(contextualized.as_bytes()).await.map_err(|e| format!("Failed to write stdin: {}", e))?;
        drop(stdin);
    }

    // Drain stderr in background to prevent pipe buffer deadlock
    let stderr_task = child.stderr.take().map(|stderr| {
        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            let mut reader = stderr;
            let mut err = String::new();
            loop {
                match reader.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => err.push_str(&String::from_utf8_lossy(&buf[..n])),
                    Err(_) => break,
                }
            }
            err
        })
    });

    let mut full_output = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let mut buf = [0u8; 4096];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    full_output.push_str(&chunk);
                    let trimmed = chunk.trim().to_string();
                    if !trimmed.is_empty() {
                        let _ = app_handle.emit("ai-output", serde_json::json!({ "chunk": trimmed }));
                    }
                }
                Err(_) => break,
            }
        }
    }

    let full_error = match stderr_task {
        Some(task) => task.await.unwrap_or_default(),
        None => String::new(),
    };

    let status = child.wait().await.map_err(|e| format!("Failed to wait for process: {}", e))?;
    let success = status.success();
    let output = strip_ansi(&full_output);
    let error_output = strip_ansi(&full_error);

    let final_output = if output.is_empty() { error_output } else { output };

    let _ = app_handle.emit("ai-done", serde_json::json!({
        "success": success,
        "output": final_output,
    }));

    Ok(serde_json::json!({
        "success": success,
        "output": final_output,
    }))
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateCheckResult, String> {
    let client = reqwest::Client::new();
    let pkg_info: serde_json::Value = client
        .get(RAW_PKG_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to check updates: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse: {}", e))?;

    let latest = pkg_info["version"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "No version in remote package".to_string())?;

    let current = env!("CARGO_PKG_VERSION").to_string();
    let has_update = semver_gt(&latest, &current);

    Ok(UpdateCheckResult {
        has_update,
        current,
        latest: Some(latest),
        error: None,
    })
}
