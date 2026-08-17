# GitHub、66 与 201 无覆盖发布交接

## 目标

开发机负责形成固定 commit/tag；66 与 201 的 Codex 只获取该固定版本到新目录。现有源码、运行目录、Profile、账号登录态、checkpoint、spool、原始产物和数据库均不得删除或覆盖。

## 发布顺序

1. 开发机完成最终测试、脱敏扫描和联合备份恢复。
2. 只提交公开清单允许的源码，不提交 `.env`、运行数据、账号、IP、手机号、Profile 或原始业务数据。
3. 推送固定 commit，并创建当前修复版本 `v0.2.1` tag。
4. 记录 tag、commit、结构版本、构建时间和回滚版本。
5. 66/201 分别运行 `deploy/windows/prepare-versioned-source.ps1`，克隆到 `sources/v0.2.1`。
6. 脚本核对 tag 指向的 commit，并执行锁定依赖安装、交接测试、类型检查和公开源码安全校验。
7. 两台机器只形成 `candidate_verified` 候选，不自动切换当前部署。
8. 分别备份运行配置、PostgreSQL、MinIO、Worker identity、spool、checkpoint 和当前版本标识。
9. 先 Canary 一台，观察稳定窗口和真实小类目；通过后再切第二台。
10. 新版本失败时切回上一不可变版本，不删除失败证据。

## 66/201 Codex 固定检查

- 当前任务是否已到安全断点。
- 当前账号/Profile/CDP/门店绑定是否与 Master 一致。
- 新候选目录的 `candidate-verification.json` 是否为 `candidate_verified`。
- `/api/version` 的 version、gitSha、schemaVersion 是否与发布记录一致。
- 原始 artifact 的 versionId/SHA-256 是否仍可读。
- 旧版本目录和回滚目标是否仍存在。

## 禁止动作

- 不在当前运行目录执行覆盖式 `git pull`。
- 不用未固定 commit 的 `main` 直接上线。
- 不删除 66/201 现有代码来“清理空间”。
- 不把开发机 `.env` 复制进 GitHub。
- 不在存在活动任务时重启 Master/Worker。
- 不在两台节点同时做首轮切换。

## 交接结果记录

每台节点记录：节点名、候选目录、Tag、commit、旧版本、备份清单 SHA-256、Canary 任务、稳定窗口、版本接口结果、回滚验证和现场负责人。记录不包含明文 Token、手机号、身份证生日或 Cookie。
