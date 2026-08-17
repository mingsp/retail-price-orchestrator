# 断点恢复与跨 Worker 迁移

## 断点事实

断点至少包含：

- `run_id`、`capture_id`、`task_id`
- 门店、类目、账号、Profile、Slot
- 已落盘商品键
- 已完成类目
- 请求数和风险数
- 动态 chunk 状态
- 最后更新时间

只有原始文件已经持久化的商品才能进入 durable checkpoint。

## 同 Slot 恢复

1. 确认旧采集进程已停止或处于风险等待。
2. 检查 raw JSONL 最后一行完整可解析。
3. 检查 checkpoint 与 raw 行数和商品键一致。
4. 核对当前账号、Profile 和门店未变化。
5. 使用相同 `capture_id` 继续。
6. 采集器跳过 durable 商品和已完成类目。

## 换账号恢复

适用：原账号 blocked、登录失效或无法恢复。

1. 停止旧 Slot 新请求。
2. 标记旧账号和 Profile 状态。
3. 使用新账号和新纯采集 Profile。
4. 自然打开目标门店并完成浅层页面预检。
5. 将未完成任务显式迁移到新资源。
6. checkpoint 只用于识别已落盘商品，不复用旧会话参数。
7. 从类目入口和缺失商品集合恢复，不从深页直接打旧接口。

## 跨 Worker 迁移

1. 旧 lease 失效或明确释放。
2. checkpoint 和 raw artifact 上传并校验。
3. 新 Worker 获得新的 lease generation。
4. 新 Slot 绑定正确门店和账号。
5. 下载或读取精确 checkpoint 版本。
6. 新 Worker 仅补缺失商品。
7. 旧 Worker 的迟到进度因 generation 不一致被拒绝。

## 防重复

- 任务写入携带 lease owner 和 generation。
- 商品使用稳定幂等键。
- artifact 路径包含门店、批次、任务和资源身份。
- 完成前对账重复执行行。
- 不因新进程启动而创建新的逻辑门店批次。

## 异常 checkpoint

如果 checkpoint 损坏：

- 不删除 raw。
- 从 raw JSONL 重建已落盘商品键。
- 输出重建报告。
- 比较重建结果与 summary/progress。
- 只有差异可解释后才能恢复。

## 禁止

- 没有停止旧任务就让新 Worker 续采。
- 新账号复用旧 Profile、Cookie 或请求参数。
- 迁移时重新采集整个门店。
- 仅根据 progress 百分比判断断点。
- 覆盖旧 checkpoint 而不留版本。
