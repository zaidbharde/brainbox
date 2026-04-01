# VER Linux Terminal

A fully functional Linux terminal emulator in your browser - learn Linux without installing anything!

## Features

### Full System Access
- Access your entire filesystem (not sandboxed)
- Works with WSL, Git Bash, or native Bash
- Real shell sessions with full command support

### Learning Mode
- Interactive lessons for beginners
- Hints system when you're stuck
- Progress tracking across sessions
- 10 comprehensive lessons covering:
  - File navigation
  - File management
  - Viewing content
  - Search commands
  - Permissions
  - Process management
  - Networking basics
  - Package management
  - Bash scripting

### Quick Reference
- Built-in command help panel
- Common commands reference
- Syntax examples

## Quick Start

```bash
npm install
npm start
```

Open http://localhost:3000

## Requirements

- **Windows**: WSL or Git Bash recommended
- **Linux/macOS**: Native Bash
- Node.js 18+

## Usage

### Navigation
```bash
ls              # List files
cd folder       # Change directory
pwd             # Show current path
cd ..           # Go to parent directory
```

### File Operations
```bash
touch file.txt          # Create file
mkdir folder            # Create folder
rm file.txt             # Delete file
cp source dest          # Copy file
mv old new              # Rename/move
```

### Viewing Files
```bash
cat file.txt            # View entire file
head file.txt           # First 10 lines
tail file.txt           # Last 10 lines
less file.txt           # Scroll through file
```

### Learning Mode
1. Click the **📚 Learn** button in the titlebar
2. Select a lesson to see its hint
3. Practice the commands in the terminal
4. Track your progress automatically

## Architecture

```
VER Linux/
├── server.js           # Express + Socket.IO + node-pty
├── public/
│   ├── index.html      # UI with learning panel
│   ├── app.js          # Xterm.js + Socket.IO client
│   └── styles.css      # Dark terminal theme
├── learning_data/      # User progress storage
└── package.json
```

## How It Works

1. Browser connects via Socket.IO
2. Server creates a PTY-backed shell process
3. Terminal I/O streams through WebSocket
4. Learning mode tracks progress in JSON files

## License

MIT
