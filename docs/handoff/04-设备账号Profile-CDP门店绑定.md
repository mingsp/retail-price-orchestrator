# 设备、账号、Profile、CDP 与门店绑定

## 稳定身份

```text
Worker -> Browser Slot -> Profile -> Account -> Store
                         -> CDP Endpoint
```

- Worker：物理设备稳定身份。
- Browser Slot：浏览器业务席位，是调度使用的稳定身份。
- Profile：纯采集浏览器目录。
- Account：脱敏账号标识和归属人。
- CDP Endpoint：运行时连接地址，可变化。
- Store：固定目标门店和 `poi_id_str`。

## 强制约束

1. 一个活跃 Profile 只能绑定一个账号。
2. 一个账号同一时刻只能绑定一个活跃 Profile。
3. 一个 Slot 同一时刻最多执行一个任务。
4. 一个账号在一个批次内只负责一个门店。
5. 类目任务固定到账号，未迁移前不得被其他账号领取。
6. 任务发请求前必须从真实页面核对门店 ID。
7. 风险账号、风险 Profile、登录失效 Slot 不领取任务。
8. 旧 Profile 不因端口变化创建新的 Profile 记录。

## 纯采集 Profile

纯采集 Profile 只登录目标消费者 H5 所需账号，不登录商家后台或无关业务系统。创建后记录：

- `profile_id`
- 所属 Worker
- Browser Slot
- 本机相对目录或受控目录标识
- 绑定账号
- 目标门店
- 创建时间
- 风险状态

Profile 目录不上传 Master、不进入 Git、不放入交接包。

## CDP 标识页

每个 Chrome 启动后保留一个标识页，展示并允许人工记录：

- Worker 名称
- Browser Slot
- CDP 端口
- 脱敏账号
- 账号归属人
- 目标门店
- Profile 状态

手机号、所属人和目标门店必须使用醒目样式。人工填写后点击“保存标识”：

- 完整手机号只保存在当前本机 Profile 的标识页存储。
- Worker 心跳向 Master 回传脱敏手机号、所属人和目标门店。
- 账号更换后必须同步修改手机号、所属人和门店，不允许保留旧标签。
- 标识页用于人工定位，不替代 Master 绑定；两边不一致时阻断任务。

完整手机号还应维护在包外私密账号映射中，供 Codex 在直接任务里提醒操作员。不得把完整手机号
写入 Git、运行日志、钉钉通知或交接包。

## 风险状态

### 账号

`safe -> running -> cooldown/manual_required -> blocked/retired`

### Profile

`safe -> profile_risk -> retired`

风险 Profile 默认隔离，不自动删除。更换账号时创建新的纯采集 Profile。

## 现场核对

启动任务前同时核对操作台和页面：

- Worker/Slot 是否正确。
- 当前登录账号是否与记录一致。
- Profile 是否为纯采集且无风险。
- CDP 页面是否为目标门店。
- 页面门店 ID 是否与任务一致。
- 类目分工是否与其他账号重叠。

任何一项不一致都阻断任务。

## 门店附近位置门禁

即时零售页面受配送位置影响。生产门店在 `collectionPolicy.locationPreflight` 中配置由运营确认的
门店附近中心点和允许半径。领取任务前同时满足：

- 人工在 H5 地址选择器中把配送位置切到目标门店附近。
- 当前页面 `actualLat/actualLng` 落在配置半径内。
- 页面 `poi_id_str` 与目标门店一致。
- 城市、门店标题和商品区域可见。

没有定位到门店附近时，不使用搜索查找目标门店，也不领取类目任务。位置门禁是业务可见范围
校验，不使用 CDP 伪造地理位置。
