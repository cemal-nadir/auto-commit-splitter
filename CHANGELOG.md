# Change Log

All notable changes to the Auto Commit Splitter extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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