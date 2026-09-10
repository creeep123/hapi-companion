# 更新已有 Mac 上的 Companion

## 当前能力

v0.2.2 需要手动更新：应用内没有检查更新、新版本提醒或一键升级。下载入口：[最新正式版](https://github.com/creeep123/hapi-companion/releases/latest)。GitHub 账号可选择只订阅仓库 Releases 的通知；这不是 Companion 自己的更新提醒。

HAPI Safe Updater 只负责服务器 Hub。本流程只替换 Mac Companion，不修改 Hub、Runner、settings.json 或 updater。

## 预编译应用更新（无需 Xcode）

1. 读取现有 app 版本和安装路径，确认期望 Hub 与应用已保存的 `hapiHomeDirectory`。不能把默认配置改成另一个 Hub 来迁就更新。只读取必要字段，勿输出凭据。
2. 从同一个确定的 release 下载 app ZIP 和 SHA256SUMS.txt。校验 ZIP 对应 SHA-256；解压到空的临时目录，核对 bundle ID 为 `io.github.creeep123.hapicompanion`、版本与 release 一致、`HAPISettingsPreview` 未启用，并执行 `codesign --verify --deep --strict`。这是完整性/签名封装检查，不代表 Apple 公证或独立的发布者认证。
3. 将旧 app 压缩备份到 `~/Library/Application Support/HAPI Companion/Backups/`，验证压缩包可解开。备份不要以 `.app` 形式保留在 Applications 内。
4. 正常退出**仅 Companion**。把旧 app 移出正式路径，再将新 app 放到原位置，通常是 `~/Applications/HAPI Companion.app`。必须干净替换，不能用 ditto 合并到旧 bundle。失败时恢复旧 app。
5. 不删除 UserDefaults、自选音效目录或任何 HAPI 配置。若 ad-hoc 替换遇到旧设备凭据的钥匙串授权阻塞，可在 Companion 停止时，仅删除服务名 `io.github.creeep123.hapicompanion.device` 的条目后重开，让应用重新配对；不读取/导出凭据，也不修改其他钥匙串条目。
6. 打开正式 app，核对版本、目标 Hub、已连接状态、真实会话列表、登录项和已有规则/音量。测试提醒与点击会话，再确认正常任务能提醒。仅有进程不代表连接正常；HTTP/3 使用 UDP，不能只查 TCP。
7. 记录已安装版本、发布 SHA、备份位置和验证结果。Mac 升级不代表服务器安全升级配置已经验收。

未签名/未公证应用如被系统阻止，交由用户通过 macOS 正常的安全界面处理；不要关闭系统保护或批量清除安全属性。

## 源码安装

有完整 Xcode 和 XcodeGen 的设备，可以在干净 checkout 切到已发布 tag，先保存 app 回滚备份，再按 README 运行 doctor 与 install-local.sh。沿用原有配置目录，不要运行 Runner 启停命令。

## 后续建议（尚未实现）

接入 [Sparkle](https://sparkle-project.org/documentation/)：在“声音与设置”页提供版本号与“检查更新”，可选后台检查；发现版本后展示说明，用户点“下载并重启”完成更新。需维护 HTTPS 更新清单、递增 build 版本、更新包签名及恢复路径；正式对外分发应完善 Developer ID 签名与公证。

旧客户端不会凭空获得该能力，必须先手动安装一次包含 Sparkle 的版本。不要把此建议写成 v0.2.2 已有功能。
