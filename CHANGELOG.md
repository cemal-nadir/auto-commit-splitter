# Change Log

All notable changes to the Auto Commit Splitter extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-01-19

### 🎉 Major UI Overhaul - Complete Webview Integration

#### Added
- **Professional Webview Interface**: Complete transformation from command-based to modern webview UI
- **Activity Bar Integration**: Dedicated panel in VS Code Activity Bar for easy access
- **Real-time Data Updates**: Live branch info, commit history, and file changes
- **Interactive Git Operations**: Stage, unstage, discard files directly from UI
- **Branch Management**: Create new branches and switch between existing ones
- **Commit Preview System**: Visual preview of planned commits before execution
- **Progress Tracking**: Real-time progress indicators with step-by-step feedback
- **Responsive Design**: Mobile-friendly layout that adapts to different panel sizes

#### Enhanced
- **Section Headers with Badges**: Professional section layout with collapsible content
- **Full Text Display**: Branch names and commit messages now show completely (no truncation)
- **Improved Button Layout**: Compact, modern button design with hover effects
- **Better Error Handling**: Comprehensive Git lock file management and retry logic
- **Theme Integration**: Full VS Code theme compatibility with proper color variables

#### Fixed
- **Text Truncation Issue**: Resolved JavaScript-based text truncation in section headers
- **Layout Responsiveness**: Improved mobile and narrow panel layouts
- **Git Lock Conflicts**: Enhanced handling of concurrent Git operations
- **Section State Management**: Proper collapse/expand state persistence

#### Technical Improvements
- Complete HTML/CSS/JavaScript integration in webview
- Advanced CSS Grid and Flexbox layouts
- Professional animations and transitions
- Optimized DOM manipulation and state management
- Enhanced TypeScript architecture for webview provider

### 🔧 Developer Experience
- Better debugging and error reporting
- Improved code organization and maintainability
- Enhanced performance with optimized rendering

---

## [1.0.0] - 2026-01-17

### Added
- **Initial Release** 🎉
- AI-powered commit splitting using VS Code Language Model API
- Intelligent hunk analysis and grouping
- File operation tracking (add, delete, rename, copy, binary, typechange)
- Conventional Commits standard compliance
- Interactive commit plan preview
- Progress tracking with cancellation support
- Multi-language support (English and Turkish)
- Configurable behavior:
  - `autoApply`: Auto-apply commits without confirmation
  - `includeUntracked`: Include untracked files as operations
  - `modelId`: Persistent model selection
- SCM view integration
- Command palette integration
- Comprehensive error handling
- Git safety checks (staged changes detection)
- Support for repositories without HEAD (initial commits)

### Features
- **Smart Change Analysis**: Automatically detect and categorize different types of file changes
- **Preview Mode**: Review generated commit plan before applying changes
- **Flexible Configuration**: Customize extension behavior through VS Code settings
- **International Support**: Full localization for multiple languages
- **Professional UI**: Progress indicators, error messages, and user feedback
- **Git Integration**: Deep integration with Git workflows and VS Code SCM

### Security
- Safe handling of Git operations
- Validation of commit messages and plans
- Protection against malformed AI responses
- Staged changes detection and prevention

### Performance
- Efficient diff parsing for large repositories
- Optimized hunk processing
- Concurrent operation handling where applicable