# 新 Mac + 自有服务器：Agent 安装入口

把下面这段话和任意一个仓库地址交给安装 Agent：

> 请为我的 Mac、Android 手机和自有服务器配置 HAPI 完成提醒及后续安全升级。先阅读仓库 AGENTS.md、README.md 和新环境安装引导，并沿文档链接检查另一个项目。识别已有安装、目标服务器和访问方式；安装 Mac Companion，验证服务器使用兼容补丁的 Hub，按 V0.4 runbook 准备 Mobile Relay，再配置 updater 的补丁 pin 与升级验收。不要输出凭据，不要直接用无补丁的官方包覆盖 Hub。生产 Relay、反向代理和手机授权必须等用户批准；逐项报告实际验证结果和未完成项。

已有 Mac 只更新 Companion：请读 [Mac 更新流程](UPDATE_MAC.md)，不要重复安装服务器组件。

## 两个仓库，各自职责

- [HAPI Companion](https://github.com/creeep123/hapi-companion)：Mac 通知应用、Hub 权威补丁、接口契约与测试。
- [HAPI Safe Updater](https://github.com/creeep123/hapi-safe-updater)：服务器升级、补丁 pin、候选验收与回滚。

任意一个入口都应把 Agent 引导到另一个仓库。先检查两边当前 README、AGENTS.md 和 Control Panel；不要假定某个工作分支已合并或已部署。不要把本机用户路径、服务器地址、会话 ID 复制为新用户的默认配置。

## 执行顺序

1. **识别环境。** 确认 macOS 版本、Xcode/XcodeGen、HAPI CLI 登录状态、目标 Hub、服务器系统与访问方式、现有安装及负责人。源码构建必须以 `xcodebuild -version` 实际成功为准，不能仅检查命令是否存在；只有 Command Line Tools 的 Mac 可使用经过校验、包含所需功能的预编译应用。只询问无法从环境判断的信息。没有服务器权限时继续 Mac 的独立准备，并把服务器步骤明确交接，不能声称端到端安装完成。
2. **准备服务器。** 阅读 [Hub 集成契约](../../integrations/hapi/README.md)，核对所选 HAPI 基线与补丁 SHA。在隔离环境构建、测试和验收；已有 Hub 先核对备份与回滚，新服务器先完成 HAPI 自身配置。生产切换必须有用户授权，不执行盲目覆盖或远程脚本一键运行。
3. **配置安全升级。** 在 updater 项目使用其支持的 source 模式及 required-patch 配置，锁定已验收的补丁提交和 SHA。按 updater 当前文档配置隔离候选、数据库快照和回滚，并实际运行门禁。功能仅存在于未部署分支或候选测试环境未就绪时，标记自动升级未完成；保留已验收 Hub，不能退回无补丁包升级。
4. **安装 Mac 应用。** 明确选择连接目标 Hub 的那一套 CLI 配置。存在多个 Runner 时，不要覆盖默认 `~/.hapi/settings.json`，也不要重启 Runner。源码安装按 Companion README 执行 `./scripts/doctor.sh --hapi-home /absolute/config/directory` 和 `./install-local.sh --hapi-home /absolute/config/directory`；安装器会保存 Companion 自己的选择。预编译安装在 Companion 停止时设置 `hapiHomeDirectory`，具体命令见 README。Finder/登录启动不能仅依赖终端中的 `HAPI_HOME`。只保留一个正式安装路径 `~/Applications/HAPI Companion.app`；回滚副本保存为应用目录之外的压缩包，避免重复应用和同 bundle ID 混淆。不要读取或展示完整 CLI 设置、Keychain 导出或任何凭据。
5. **准备 Android Relay（可选）。** 只有用户要求手机通知时执行。阅读 [V0.4 规格](../specs/V0_4_ANDROID_NOTIFICATIONS.md) 和 [Relay 运维手册](../deployments/V0_4_MOBILE_RELAY_RUNBOOK.md)，在干净的 Companion 提交上构建与验证对应 VM 架构的包。Relay 是独立通知设备，运行于 Hub VM；它不属于 updater，也不改变 HAPI 补丁。首次生产服务和 TLS 反向代理必须先取得用户批准。不得在聊天、日志或工单中展示配对码、ntfy 订阅地址、管理凭据或 Hub 设备凭据。
6. **配置手机。** 用户在 Android 安装官方 ntfy。生产 Relay 配对后，由 Mac Companion 的“声音与设置 → 手机通知”生成随机订阅并显示二维码；测试通知确认可达且一键打开精确 HAPI PWA 会话后才启用真实提醒。手机沿用 Mac 保存的会话/关键词、时长和勿扰规则，Relay 激活后不依赖 Mac 在线。通知权限、后台运行、电池策略、扫码和锁屏实测由用户在手机上完成。
7. **实际验收。** 核对 Hub 接口和设备隔离、单 SSE 重连与 ACK；多配置环境还需核对设置窗口的目标 Hub，退出后在没有 `HAPI_HOME` 的环境重新打开仍连接同一 Hub，并确认两份 Runner 配置及原有进程未改变。HTTP/3 使用 UDP，不能仅凭 TCP 连接列表为空判定离线。Mac 设置窗口加载真实会话，菜单栏图标肉眼可见且点击可打开设置，测试横幅/声音和实际任务完成提醒正常。点击通知应打开精确 `/sessions/<id>`，有 Edge PWA 时复用其窗口。Android 还须在 Mac 退出或休眠、手机锁屏且 VPN 关闭时完成真实任务通知，验证筛选/勿扰、精确会话、Relay 重启和未 ACK 重放。通知权限、声音和自动化权限由用户按系统提示授予。若 Edge 同时提醒，向用户说明重复来源并引导其选择通知渠道。
8. **交付记录。** 报告 Mac 安装路径/版本、Hub 源码与二进制版本、补丁 SHA、updater 版本与 pin、Relay 版本/架构/产物 SHA 与回滚目标、门禁是否实际部署及通过、回滚位置和待办。仅收到测试请求或显示“已连接”不能替代真实提醒、目录与升级验收。

## 完成标准

Mac 提醒需要 Mac Companion + 带兼容补丁的 Hub；Android 提醒另需 VM Mobile Relay + 手机 ntfy。Relay 激活后不依赖 Mac 在线。updater 不在提醒事件通路中；用户要求安全自动升级时，必须同时交付并验证 updater 配置。可以独立交付提醒，但必须明确说明安全自动升级仍未完成，不能把两者混称为“一套已装好”。

## 菜单栏缺失的排查顺序

确认正式应用进程存在；检查 macOS 的“系统设置 → 菜单栏 → 允许在菜单栏显示”；再检查菜单栏空间与应用自己的位置记录。不要因为收到通知就认定图标可见。不要删除全局 Control Center 设置、其他应用的项目或用户提醒规则。位置记录异常时，可在退出 Companion 后仅重置它自己的 `NSStatusItem Preferred Position Item-0`，再启动并由实际屏幕验证。该操作是针对异常记录的修复，不应在每次启动时覆盖用户正常排序。菜单栏位置变化后必须验证图标点击能打开设置。

参考：[Apple 菜单栏设置说明](https://support.apple.com/en-euro/guide/mac-help/-mchlad96d366/mac)。
