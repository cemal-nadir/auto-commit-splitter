# Auto Commit Splitter

[![Version](https://img.shields.io/visual-studio-marketplace/v/cemal-nadir.auto-commit-splitter.svg)](https://marketplace.visualstudio.com/items?itemName=cemal-nadir.auto-commit-splitter)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/cemal-nadir.auto-commit-splitter.svg)](https://marketplace.visualstudio.com/items?itemName=cemal-nadir.auto-commit-splitter)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/cemal-nadir.auto-commit-splitter.svg)](https://marketplace.visualstudio.com/items?itemName=cemal-nadir.auto-commit-splitter)

Intelligently split your Git changes into logical commits using AI. Analyze hunks, file operations, and generate conventional commit messages automatically.

## ✨ Features

### 🎨 **Modern Webview Interface** *(New in v1.1.0)*
- **Professional Activity Bar Panel**: Dedicated, always-accessible interface in VS Code sidebar
- **Real-time Git Status**: Live updates of branches, commits, and file changes
- **Interactive Git Operations**: Stage, unstage, discard files with one-click actions
- **Branch Management**: Create and switch branches directly from the UI
- **Visual Commit Preview**: See exactly what commits will be created before execution

### 🤖 **AI-Powered Commit Splitting**
- Automatically analyze your working directory changes
- Split hunks and file operations into logical, reviewable commits
- Generate meaningful commit messages following [Conventional Commits](https://www.conventionalcommits.org/) standard

### 📊 **Smart Change Analysis**
- **Hunk-based splitting**: Intelligently group related code changes
- **File operations tracking**: Handle add, delete, rename, copy, and binary file changes
- **Conflict detection**: Safely handle merge conflicts and staged changes

### 🎯 **Enhanced Developer Experience**
- **Responsive Design**: Adapts beautifully to any panel size
- **Progress Tracking**: Real-time feedback with step-by-step progress indicators
- **Professional UI**: Modern badge system, collapsible sections, hover effects
- **Full Text Display**: No more truncated branch names or commit messages

### 🌍 **International Support**
- **Multi-language**: Full support for English and Turkish
- **Localized UI**: All messages and configurations in your language

## 🚀 Quick Start

### Requirements
- VS Code 1.108.1 or higher
- Git repository in your workspace
- Language model provider (e.g., GitHub Copilot Chat, Azure OpenAI)

### Installation

#### Option 1: From Open VSX Registry
1. Install from [Open VSX Registry](https://open-vsx.org/extension/cemal/auto-commit-splitter)
2. Or use: `code --install-extension cemal.auto-commit-splitter`

#### Option 2: Manual Installation (VSIX)
1. Download the latest `auto-commit-splitter-1.1.0.vsix` from [GitHub Releases](https://github.com/cemal/auto-commit-splitter/releases)
2. In VS Code: `Extensions > Views and More Actions... > Install from VSIX...`
3. Or via command line: `code --install-extension auto-commit-splitter-1.1.0.vsix`

### Setup
1. Open a Git repository in VS Code
2. Make some changes to your files
3. Use the command palette (`Ctrl+Shift+P`) and run:
   - `Auto Commit Splitter: Split and Commit` - Analyze and split your changes
   - `Auto Commit Splitter: Select Model` - Choose your preferred AI model

## 📖 Usage

### Basic Workflow

1. **Make Changes**: Edit files in your Git repository
2. **Run Splitter**: Execute `Auto Commit Splitter: Split and Commit`
3. **Review Plan**: Preview the generated commit strategy
4. **Apply**: Confirm to create the commits automatically

### Example Output

```
## 1) feat(ui): add user profile component
Hunks:
- h3f2a1b9c0 — src/components/UserProfile.tsx (+45/-0) @@ -0,0 +1,45 @@

## 2) fix(api): handle authentication errors
Hunks:  
- h8d4e5f1a2 — src/api/auth.ts (+12/-3) @@ -23,8 +23,17 @@

## 3) docs: update README with new features
Operations:
- op9c7b2d8e4 — add: README.md
```

## ⚙️ Configuration

Access settings through VS Code Settings (`Ctrl+,`) and search for "Auto Commit Splitter":

| Setting | Default | Description |
|---------|---------|-------------|
| `autoCommitSplitter.autoApply` | `false` | Automatically apply commits without confirmation |
| `autoCommitSplitter.includeUntracked` | `true` | Include untracked files as operations |
| `autoCommitSplitter.modelId` | `""` | Selected language model ID |

## 🎨 Commands

| Command | Description | Keyboard Shortcut |
|---------|-------------|-------------------|
| `autoCommitSplitter.splitAndCommit` | Analyze and split current changes | - |
| `autoCommitSplitter.selectModel` | Choose AI model for analysis | - |

## 🔧 Advanced Usage

### Custom Configuration
```json
{
  "autoCommitSplitter.autoApply": false,
  "autoCommitSplitter.includeUntracked": true,
  "autoCommitSplitter.modelId": "gpt-4"
}
```

### SCM Integration
The extension adds a button to the Source Control view for easy access to commit splitting functionality.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Setup
1. Clone the repository
2. Install dependencies: `npm install`
3. Open in VS Code and press `F5` to run the extension in a new Extension Development Host window

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🐛 Support

- **Issues**: [GitHub Issues](https://github.com/cemal-nadir/auto-commit-splitter/issues)
- **Discussions**: [GitHub Discussions](https://github.com/cemal-nadir/auto-commit-splitter/discussions)

## 📊 Changelog

See [CHANGELOG.md](CHANGELOG.md) for a list of changes and version history.

## 🏆 Acknowledgments

- [Conventional Commits](https://www.conventionalcommits.org/) for the commit message standard
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/language-model) for AI integration
- The VS Code team for the excellent extension platform

---

**Happy Coding!** 🎉 

If you find this extension helpful, please consider leaving a review on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cemalnadir.auto-commit-splitter).
