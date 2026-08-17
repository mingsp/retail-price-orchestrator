# 公开仓库发布工具

该工具从当前工作树生成不包含旧 Git 历史和生产运行资产的公开仓库快照。

```powershell
$target = Join-Path $PWD ".publication/retail-price-orchestrator-$(Get-Date -Format yyyyMMddHHmmss)"
pnpm public:build -- --destination $target
pnpm public:verify -- $target
```

目标目录必须为空或不存在。工具不会自动删除已有目录。

公开范围由 `public-files.json`、Git ignore 规则和 `handoff/lib/files.mjs` 共同决定。验证器会阻止真实环境文件、Profile、运行产物、完整手机号、本机绝对路径、内网 IP 和带会话参数的生产链接进入公开快照。

完成验证后，才允许在目标目录初始化新的 Git 仓库。不要把原项目的 `.git` 目录复制过去。
