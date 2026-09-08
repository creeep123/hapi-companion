# 新环境安装入口、重复应用与菜单栏验收

Status: in-progress

## Acceptance criteria
- Companion/updater 任意一个公开默认分支的 README/AGENTS 可引导完整新环境安装；附一段可复制指令；不混入 updater 实现。
- Applications 只保留一个正式 Companion；核验备用包再清理两个旧应用，当前提醒设置保留。
- 当前屏幕实际显示菜单栏图标，点击打开设置；不能仅凭进程、开关或测试推定可见。

## Evidence
- 原 Applications 中为 0.2.0 正式版和两个 0.1.0 回滚副本。known-good 签名验证通过，归档 zip 完整性通过后移除两份旧 app。
- 归档：~/Library/Application Support/HAPI Companion/Backups/HAPI-Companion-v0.1.0-known-good.zip。
- macOS 26.5.2，系统允许 Companion 菜单栏显示；应用位置记录 Item-0 为 10721。退出后仅删除该记录并重启。
- 重启后 SSE 已连接、目录可读取，6 个会话选择和时长/勿扰规则保留。等待实际可见性与点击确认。
- Companion 新入口 docs/agents/NEW_INSTALL.md；已联系 updater owner 添加对等公开入口，等待其提交/PR 证据。

## Checks
- git diff --check
- 实际应用目录与进程检查
- 双仓库公开入口检查
- 菜单栏肉眼/点击验收
