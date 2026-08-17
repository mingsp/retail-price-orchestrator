# 变更记录

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构，并使用语义化版本号。

## [0.1.0] - 2026-08-03

### 新增

- Master-Worker 多设备采集调度、心跳、租约和任务状态机。
- 账号、Profile、CDP、Browser Slot、归属人和门店绑定。
- CDP 生命周期管理、标识页、人工登录和门店位置预检。
- 类目固定分工、原始 JSONL、checkpoint、断点恢复和质量门。
- 风险事件、人工干预、低噪钉钉通知和操作审计。
- PostgreSQL、Redis、MinIO/S3、React Dashboard 和生产部署材料。
- 新人交接、风控/Profile、采集、验收、入库和 Codex 提示词手册。
- 可重复的公开仓库脱敏发布和验证流程。

### 验证边界

- 代码、离线测试、类型检查、构建和脱敏样例可由公开仓库复现。
- 真实站点、账号、验证码、网络和生产采集状态必须由使用者在授权环境中重新验收。

