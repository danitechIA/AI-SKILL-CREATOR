# AI Skill Generator

Desktop application for managing AI coding skills, configurations, and chatting with an AI agent — no terminal required.

Built with Electron.

## Features

- **Dashboard** — project overview at a glance
- **Skills Manager** — view, create, edit, and delete skills visually
- **Agent Chat** — chat with the AI agent directly from the app
- **Configuration Editor** — edit project configuration with syntax highlighting
- **Settings** — dark mode, project switching, engine installation

## Quick Start

```bash
# Install dependencies
npm install

# Run the app
npm start
```

## Building for Distribution

```bash
# Create a portable .exe
npm run build
```

The output will be in the `dist/` folder as a single `.exe` — no installation required.

## Usage

1. Open the app
2. Click **Select Project** and choose your project folder
3. Manage skills, edit configs, or chat with the agent
4. If the AI engine is not installed, click **Install AI Engine** from the Dashboard or Settings
