# Companion 配置目录选择

状态：实现已合入；目标 Mac 的无环境重开与 SSE 连接通过，会话列表/UI 待人工确认。范围：单个 Companion 选择一套 HAPI CLI 配置；不新增多 Hub 同时连接，不修改 Runner、CLI 配置或 Hub 补丁。

## 契约
- 运行时读取优先级：应用持久设置 `hapiHomeDirectory` → `HAPI_HOME` → `~/.hapi`。
- 安装/doctor 可使用 `--hapi-home /absolute/path` 显式选择；安装成功后仅将目录路径写入 Companion 的 UserDefaults。Finder 和登录启动不依赖 shell 环境。
- 支持 `~` 和 `~/...`，拒绝空字符串和相对路径。显式目录缺失或内容错误必须失败，不能静默回退旧 Hub。
- 不复制 token；不写入任何 HAPI settings.json；不重启 Runner。原有 Keychain 同源复用/异源重新配对逻辑保持不变。
- doctor 与安装器共用目录解析逻辑，检查目标 Hub。设置窗口显示实际已配置的 Hub 主机名。
- 修改选择后退出并重新启动 Companion；不提供运行中热切换，避免并发旧连接。

## 验收
1. Swift 验证保存目录覆盖另一 Runner 的环境；无环境的 Finder 启动解析一致；环境/默认路径、相对/空路径、缺文件失败覆盖。
2. shell 验证显式/保存/环境/默认优先级和路径展开，使用模拟 defaults 避免操作真实偏好。
3. 现有测试通过、Release 构建通过；Hub 补丁 SHA 不变。
4. 目标 Mac 由协作会话安装，确认目标主机、设备配对、SSE、目录、登录启动持久配置；两个 Runner 配置和进程未被本次操作修改。
