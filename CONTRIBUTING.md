# 贡献指南

感谢参与商圈比价数据采集调度系统。

## 开发流程

1. 从 `main` 创建短生命周期分支。
2. 将变更限制在一个清晰问题内，同时更新对应测试和文档。
3. 不提交真实生产配置、身份信息或采集产物。
4. 运行完整验证后提交 Pull Request。

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm handoff:test
pnpm typecheck
pnpm test
pnpm build:production
pnpm public:verify
```

## 变更要求

- 调度状态、租约、断点或资源绑定变更必须提供回归测试。
- 采集器变更必须说明请求数量、恢复语义和风险边界，不得以绕过站点控制为目标。
- 数据字段变更必须保留原始事实，不得用推算值覆盖来源值。
- UI 不显示完整手机号、凭据、本机路径、内部接口和无意义技术日志。
- 风控策略必须基于可复核证据，区分已证明、未证明和待现场验证。

## 提交信息

推荐使用：

- `feat:` 新能力
- `fix:` 缺陷修复
- `docs:` 文档
- `test:` 测试
- `chore:` 工程维护

## Issue 标签

使用中文短标签：`采集`、`调度`、`风控`、`数据`、`部署`、`文档`、`缺陷`、`优化`。
