# Public GitHub Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. This project explicitly prohibits subagents.

**Goal:** Publish a complete, maintainable, de-identified Retail Price Orchestrator repository at `codewith1024/retail-price-orchestrator`.

**Architecture:** Generate a clean public staging repository from an allowlisted current-source snapshot, add public-maintenance assets, run secret and artifact gates, and push a new one-commit Git history. GitHub metadata and Chinese Issue labels are configured after creation, then a fresh anonymous clone is used for final acceptance.

**Tech Stack:** Git, GitHub CLI, Node.js, TypeScript, pnpm, PowerShell, GitHub Actions, existing handoff verification scripts.

---

### Task 1: Add public repository maintenance assets

**Files:**
- Create: `LICENSE`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Create: `CHANGELOG.md`
- Create: `.github/workflows/ci.yml`
- Create: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/ISSUE_TEMPLATE/documentation.yml`
- Create: `.github/pull_request_template.md`
- Modify: `README.md`

- [ ] Add an MIT license and security-reporting boundary.
- [ ] Add contribution rules that prohibit credentials, full phone numbers, cookies, real collection outputs, and production URLs.
- [ ] Add Chinese issue forms and a pull-request evidence checklist.
- [ ] Add CI commands for install, handoff tests, typecheck, workspace tests, production build, and redaction scan.
- [ ] Rewrite README as the public navigation page while preserving the operator handoff entry.
- [ ] Verify all newly referenced files exist and README links resolve.

### Task 2: Build a reproducible public snapshot exporter

**Files:**
- Create: `scripts/publication/build-public-repository.mjs`
- Create: `scripts/publication/public-files.json`
- Create: `scripts/publication/verify-public-repository.mjs`
- Create: `scripts/publication/README.md`
- Modify: `package.json`
- Modify: `.gitignore`
- Test: `handoff/test/public-repository.test.mjs`

- [ ] Write a failing test that rejects `.runtime`, profiles, data files, secrets, full phone numbers, local absolute paths and Git metadata.
- [ ] Run `node --test handoff/test/public-repository.test.mjs` and confirm the missing exporter/validator failure.
- [ ] Implement allowlisted copying and public-repository verification without copying `.git` history.
- [ ] Add `public:build` and `public:verify` scripts.
- [ ] Run the focused test and confirm it passes.

### Task 3: Verify the source before publication

**Files:**
- Read: `handoff/work/source-validation.json`
- Generate outside Git: `.publication/retail-price-orchestrator/`

- [ ] Run `pnpm handoff:test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build:production`.
- [ ] Generate the clean staging repository with `pnpm public:build`.
- [ ] Run `pnpm public:verify -- <staging-path>` and require zero findings.
- [ ] Inspect staged `git status` candidates before initialization.

### Task 4: Create and populate the GitHub repository

**Files:**
- Create in staging: `.git/` only after verification.

- [ ] Confirm `codewith1024/retail-price-orchestrator` does not already exist.
- [ ] Initialize staging with default branch `main` and create one initial commit.
- [ ] Create the public GitHub repository with the approved Chinese description.
- [ ] Set ASCII GitHub Topics required by the platform.
- [ ] Create Chinese Issue labels: `采集`、`调度`、`风控`、`数据`、`部署`、`文档`、`缺陷`、`优化`.
- [ ] Push `main` without changing the source workspace `origin`.
- [ ] Enable Issues and disable unused Wiki/Projects features.

### Task 5: Create the first release and perform independent acceptance

**Files:**
- Create in staging: Git tag `v0.1.0`
- Create on GitHub: Release `v0.1.0`
- Generate outside Git: `.publication/verification-clone/`

- [ ] Create a release note that separates implemented, offline-verified, and field-validation-pending capabilities.
- [ ] Push tag `v0.1.0` and publish the GitHub Release.
- [ ] Clone the public repository into a new empty directory without credentials in the URL.
- [ ] Verify repository visibility, description, Topics, labels, default branch, license and release.
- [ ] Run public verification and offline handoff tests in the fresh clone.
- [ ] Compare the remote commit SHA with the verified staging SHA.
- [ ] Report the repository URL, release URL, commit SHA, tests, and remaining live-production verification boundary.

