<p align="center"><img src=".github/header.svg" alt="AI-SKILL-CREATOR" width="100%"></p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri">
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" alt="Rust">
  <img src="https://img.shields.io/badge/Windows-instalador-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows">
  <a href="../../releases/latest"><img src="https://img.shields.io/github/v/release/danitechIA/AI-SKILL-CREATOR?style=flat-square&color=22D3EE" alt="release"></a>
</p>

# AI Skill Generator

Desktop app to create and manage skills for AI coding agents — and chat with the agent — from a visual interface, no terminal required.

Built with **Tauri 2** and a native **Rust** backend. The app started life as an Electron project (preserved in the [`electron`](../../tree/electron) branch) and was fully migrated to Tauri for much lighter binaries and a smaller memory footprint.

![AI Skill Generator](docs/screenshot.png)

## Download

Grab the Windows installer from the [latest release](../../releases/latest), or build from source (see below).

## Features

- **Dashboard** — project and AI engine status at a glance.
- **Skills manager** — view, create, edit and delete agent skills with instant search. Generated skills follow the `SKILL.md` format, compatible with Claude Code, Cursor, Codex CLI, Gemini CLI, GitHub Copilot, Windsurf and more.
- **Agent Chat** — talk to the coding agent directly from the app, with real-time streaming output.
- **Settings** — dark mode, project switching, and guided AI engine installation with live progress.
- **Self-updating** — checks GitHub for a newer version on startup.

## Architecture

- **Backend (Rust)**: Tauri commands handle all system access — process management with Tokio, engine download and extraction (reqwest + flate2/tar), file I/O. Agent output streams to the UI through Tauri events.
- **Frontend**: vanilla JavaScript, HTML and CSS — no frameworks, no build step — with a frameless window and custom title bar.
- **Security**: the frontend can only invoke the small API the backend explicitly exposes.

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Requires [Rust](https://rustup.rs/) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.
