# Contributing to Hive

Thank you for your interest in contributing to Hive! This document will guide you through the contribution process and help you get started with development.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Committing Changes](#committing-changes)
- [Submitting Pull Requests](#submitting-pull-requests)
- [Code Review Process](#code-review-process)
- [Reporting Issues](#reporting-issues)
- [Questions?](#questions)

## Getting Started

### Prerequisites

Before you can contribute, ensure you have the following installed:

- **Node.js 20+** - Required for development and running Hive
- **npm 10+** - Package manager for Node.js
- **Git 2.30+** - Version control system
- **tmux 3.x+** - Terminal multiplexer (used for agent session management)
- **GitHub CLI** (`gh`) - For creating and managing PRs

### Installation for Development

1. **Clone the repository**

```bash
git clone https://github.com/nikrich/hungry-ghost-hive.git
cd hungry-ghost-hive
```

2. **Install dependencies**

```bash
npm ci
```

3. **Build the project**

```bash
npm run build
```

4. **Create a symlink for local testing** (optional but recommended)

```bash
npm link
```

This allows you to test the `hive` command directly from your development version.

### Project Structure

```
.
├── src/                    # TypeScript source code
│   ├── index.ts           # CLI entry point
│   ├── commands/          # Command implementations
│   ├── services/          # Core service logic
│   ├── models/            # Data models
│   └── utils/             # Utility functions
├── dist/                  # Compiled JavaScript (generated)
├── tests/                 # Test files
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
├── eslint.config.js       # Linting configuration
└── commitlint.config.js   # Commit message validation
```

## Development Workflow

### 1. Create a Feature Branch

Always create a new branch for your work:

```bash
git checkout -b feature/your-feature-name
```

Branch naming conventions:

- `feature/` - For new features
- `fix/` - For bug fixes
- `docs/` - For documentation updates
- `refactor/` - For code refactoring
- `test/` - For tests or test infrastructure

### 2. Make Your Changes

Edit the code as needed. Keep commits focused and atomic (one feature per commit).

### 3. Run Tests and Linting

Before committing, ensure your code passes all quality checks:

```bash
# Run tests
npm test

# Run linting
npm run lint

# Check TypeScript types
npm run type-check

# Build the project
npm run build
```

All tests must pass and linting must have no errors before submitting a PR.

### 4. Commit Your Changes

Use conventional commits with clear, descriptive messages:

```bash
git add .
git commit -m "feat: add new feature description"
```

#### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**

- `feat:` - A new feature
- `fix:` - A bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, semicolons, etc.)
- `refactor:` - Code refactoring without feature or bug changes
- `test:` - Test-related changes
- `chore:` - Build process, dependencies, or tooling changes

**Examples:**

```
feat(commands): add new hive init command
fix(scheduler): resolve race condition in agent assignment
docs: update installation instructions
test: add unit tests for message service
```

### 5. Push Your Branch

Push your branch to GitHub:

```bash
git push origin feature/your-feature-name
```

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Ensure strict type checking is enabled
- Avoid `any` types unless absolutely necessary
- Use descriptive variable and function names

### Code Style

- **2 spaces** for indentation (not tabs)
- **Semicolons** are required
- **camelCase** for variables and functions
- **PascalCase** for classes and types
- Max line length: 100 characters (soft limit)

### Formatting

Code formatting is automatically checked by ESLint. Run:

```bash
npm run lint
```

### Comments

- Write comments for complex logic
- Use JSDoc comments for public APIs
- Keep comments concise and accurate
- Update comments when code changes

### Error Handling

- Always handle promises and async/await properly
- Provide meaningful error messages
- Use custom error classes where appropriate
- Log errors with sufficient context

## Testing

### Writing Tests

- Write tests for new features and bug fixes
- Use [Vitest](https://vitest.dev/) for unit tests
- Aim for high coverage on critical paths
- Test edge cases and error conditions

### Test File Naming

Test files should be named with `.test.ts` extension and placed next to the code they test:

```
src/
├── services/
│   ├── messageService.ts
│   └── messageService.test.ts
```

### Running Tests

```bash
# Run tests once
npm test

# Run tests in watch mode
npm test:watch

# Run tests with coverage (if configured)
npm test -- --coverage
```

## Submitting Pull Requests

### Before Creating a PR

1. **Ensure your branch is up to date**

```bash
git fetch origin
git rebase origin/main
```

2. **All tests pass**

```bash
npm test
npm run lint
npm run type-check
npm run build
```

3. **Commit message is clear and follows conventions**

### Creating a PR

Use the GitHub CLI to create a pull request:

```bash
gh pr create --title "feat: brief description" \
  --body "Detailed description of changes"
```

**PR Title Format:**

- Keep titles under 72 characters
- Follow conventional commit format
- Be specific about what changed

**PR Description:**
Include the following in your PR description:

```markdown
## Description

Brief summary of the changes

## Related Issues

Closes #123

## Testing

- [ ] Unit tests added/updated
- [ ] Manual testing performed
- [ ] No breaking changes

## Checklist

- [ ] Code follows style guidelines
- [ ] No new linting warnings
- [ ] Tests pass
- [ ] Documentation updated
```

### PR Review Guidelines

Your PR will be reviewed for:

- **Code quality** - Follows standards and best practices
- **Test coverage** - New code has appropriate tests
- **Documentation** - Changes are documented
- **Performance** - No performance regressions
- **Security** - No security vulnerabilities introduced
- **Compatibility** - No breaking changes without discussion

### Responding to Feedback

- Be respectful and open to feedback
- Ask for clarification if a suggestion is unclear
- Make requested changes in new commits (don't force-push)
- Mark conversations as resolved after addressing feedback

## Code Review Process

### For Reviewers

- Review code for correctness, clarity, and maintainability
- Check for adherence to coding standards
- Verify tests are comprehensive
- Suggest improvements constructively
- Approve or request changes

### For Authors

- Respond to all comments
- Make changes in follow-up commits
- Re-request review after changes
- Don't merge PRs yourself (let maintainers do it)

## Reporting Issues

### Before Reporting

- Check if the issue already exists
- Verify you're using the latest version
- Test with a minimal reproduction case

### Issue Template

When creating an issue, include:

```markdown
## Description

Clear description of the issue

## Steps to Reproduce

1. Step one
2. Step two
3. ...

## Expected Behavior

What should happen

## Actual Behavior

What actually happens

## Environment

- Node.js version: `node -v`
- npm version: `npm -v`
- OS: macOS / Linux / Windows
- Hive version: `hive --version`

## Additional Context

Any other relevant information
```

### Issue Labels

- `bug` - Confirmed bugs
- `enhancement` - Feature requests
- `documentation` - Documentation improvements
- `good first issue` - Good for new contributors
- `help wanted` - Needs community help
- `wontfix` - Won't be fixed

## Development Tips

### Local Testing

Test your changes locally before pushing:

```bash
# Build locally
npm run build

# Test the CLI locally (if npm linked)
hive --help

# Or run directly
npm run dev -- --help
```

### Debugging

Use Node.js debugger or add console logs:

```bash
# Debug a test
node --inspect-brk ./node_modules/.bin/vitest run

# Or with IDE debugger
node --inspect ./node_modules/.bin/vitest run
```

### Common Tasks

```bash
# Install a new dependency
npm install <package>

# Update dependencies
npm update

# Check for outdated packages
npm outdated

# Remove a dependency
npm uninstall <package>
```

## Questions?

- **Documentation issues** - Check [README.md](./README.md) first
- **Existing issues** - Search [GitHub Issues](https://github.com/nikrich/hungry-ghost-hive/issues)
- **General questions** - Open a [Discussion](https://github.com/nikrich/hungry-ghost-hive/discussions)
- **Security concerns** - Email security@hungryghost.dev (don't open public issues)

## License

By contributing to Hive, you agree that your contributions will be licensed under the Hungry Ghost Hive License. See [LICENSE](./LICENSE) for details.

---

Thank you for contributing to Hive! 🚀
