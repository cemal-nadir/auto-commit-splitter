# Contributing to Auto Commit Splitter

First off, thanks for taking the time to contribute! 🎉

The following is a set of guidelines for contributing to Auto Commit Splitter, which is hosted on GitHub. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Pull Requests](#pull-requests)
- [Development Setup](#development-setup)
- [Style Guidelines](#style-guidelines)
  - [Git Commit Messages](#git-commit-messages)
  - [TypeScript Style Guide](#typescript-style-guide)
- [Additional Notes](#additional-notes)

## Code of Conduct

This project and everyone participating in it is governed by our commitment to creating a welcoming and inclusive environment. By participating, you are expected to uphold this standard.

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report for Auto Commit Splitter. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related reports.

**Before Submitting A Bug Report:**
- Check the [issues list](https://github.com/cemal-nadir/auto-commit-splitter/issues) to see if the problem has already been reported
- Ensure you're using the latest version of the extension
- Check if you can reproduce the issue in a clean VS Code environment

**How Do I Submit A (Good) Bug Report?**

Bugs are tracked as [GitHub issues](https://github.com/cemal-nadir/auto-commit-splitter/issues). Create an issue and provide the following information:

- **Use a clear and descriptive title** for the issue
- **Describe the exact steps which reproduce the problem** in as many details as possible
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed after following the steps** and point out what exactly is the problem
- **Explain which behavior you expected to see instead and why**
- **Include screenshots and animated GIFs** if they help demonstrate the problem
- **Include details about your configuration and environment:**
  - VS Code version
  - Extension version
  - Operating system and version
  - Git version
  - AI model being used

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion for Auto Commit Splitter, including completely new features and minor improvements to existing functionality.

**How Do I Submit A (Good) Enhancement Suggestion?**

- **Use a clear and descriptive title** for the issue
- **Provide a step-by-step description of the suggested enhancement** in as many details as possible
- **Provide specific examples to demonstrate the steps** or mockups if applicable
- **Describe the current behavior** and **explain which behavior you expected to see instead**
- **Explain why this enhancement would be useful** to most Auto Commit Splitter users
- **List some other extensions or applications where this enhancement exists** if applicable

### Pull Requests

The process described here has several goals:
- Maintain Auto Commit Splitter's quality
- Fix problems that are important to users
- Engage the community in working toward the best possible Auto Commit Splitter
- Enable a sustainable system for maintainers to review contributions

**Pull Request Process:**

1. Fork the repository
2. Create a new branch from `master` for your feature or fix
3. Make your changes following our [style guidelines](#style-guidelines)
4. Add tests for your changes if applicable
5. Ensure the test suite passes
6. Update documentation as needed
7. Submit a pull request

**Pull Request Guidelines:**

- **Fill in the required template**
- **Do not include issue numbers in the PR title**
- **Include screenshots and animated GIFs** in your pull request whenever possible
- **Follow the [TypeScript](#typescript-style-guide) style guide**
- **Document new code** based on the Documentation style guide
- **End all files with a newline**

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18 or later)
- [VS Code](https://code.visualstudio.com/) (version 1.108.1 or later)
- [Git](https://git-scm.com/)

### Setup Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/cemal-nadir/auto-commit-splitter.git
   cd auto-commit-splitter
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Open in VS Code:**
   ```bash
   code .
   ```

4. **Build the extension:**
   ```bash
   npm run compile
   ```

5. **Run the extension:**
   - Press `F5` or run "Run Extension" from the Run and Debug view
   - This opens a new VS Code window with the extension loaded

### Development Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile TypeScript to JavaScript |
| `npm run watch` | Compile and watch for changes |
| `npm run package` | Create VSIX package for testing |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests |

### Project Structure

```
auto-commit-splitter/
├── src/
│   ├── extension.ts          # Main extension logic
│   └── test/
│       └── extension.test.ts # Extension tests
├── package.json              # Extension manifest
├── tsconfig.json            # TypeScript configuration
├── eslint.config.mjs        # ESLint configuration
├── CHANGELOG.md             # Version history
├── README.md                # Documentation
└── CONTRIBUTING.md          # This file
```

## Style Guidelines

### Git Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

**Examples:**
```
feat(ui): add branch management interface
fix(git): handle lock file conflicts properly
docs: update installation instructions
```

### TypeScript Style Guide

- Use **2 spaces** for indentation
- Use **semicolons**
- Use **single quotes** for strings
- Use **PascalCase** for types and interfaces
- Use **camelCase** for variables and functions
- Use **meaningful variable names**
- Add **JSDoc comments** for public functions
- Use **async/await** instead of promises where possible

**Example:**
```typescript
/**
 * Analyzes Git changes and generates commit plan
 * @param repoRoot - Path to Git repository root
 * @param files - Array of changed files
 * @returns Promise resolving to commit plan
 */
async function generateCommitPlan(
  repoRoot: string, 
  files: ChangedFile[]
): Promise<Plan> {
  // Implementation
}
```

### File Naming Conventions

- Use **kebab-case** for file names
- Use **descriptive names** that indicate purpose
- Add **appropriate file extensions** (.ts, .md, .json)

## Testing

### Running Tests

```bash
npm test
```

### Writing Tests

- Place tests in the `src/test/` directory
- Use descriptive test names
- Group related tests using `describe` blocks
- Use `beforeEach` and `afterEach` for setup/cleanup

**Example:**
```typescript
describe('Git Operations', () => {
  beforeEach(() => {
    // Setup
  });

  it('should parse changed files correctly', async () => {
    // Test implementation
  });
});
```

## Additional Notes

### Issue and Pull Request Labels

- `bug`: Something isn't working
- `enhancement`: New feature or request
- `documentation`: Improvements or additions to documentation
- `good first issue`: Good for newcomers
- `help wanted`: Extra attention is needed
- `question`: Further information is requested

### Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create release commit
4. Tag release
5. Package extension with `vsce package`
6. Create GitHub release
7. Publish to marketplace (maintainers only)

### Getting Help

If you need help contributing:

- Check existing [issues](https://github.com/cemal-nadir/auto-commit-splitter/issues)
- Start a [discussion](https://github.com/cemal-nadir/auto-commit-splitter/discussions)
- Reach out to maintainers

---

Thank you for contributing to Auto Commit Splitter! 🚀