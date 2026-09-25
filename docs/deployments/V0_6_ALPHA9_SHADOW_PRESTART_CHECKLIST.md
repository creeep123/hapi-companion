# V0.6 alpha.9 VM shadow 启动前检查清单

**状态：待单独批准，未在 VM 执行。** 本清单只用于 PR #40 的 Companion Sidecar **有限 Phase-B 旁路试运行**；由 Updater 验收的 Companion PR #41 Hub 候选包、现役补丁 pin 和本次 Sidecar 制品是不同对象。勾选者须记录时间、操作者和非敏感证据；任一启动前必需项缺失即停止，不用推测代替验收。这次最多验证资源、断线/缺口和一条真实 `ready`，不算完整 Phase B。

## 已核对的本地材料

- [x] PR #40 的 alpha.9 代码通过 Relay typecheck/178 项测试、Mac 75 项测试、干净官方 HAPI v0.30.7 的 116 项接口测试和真实认证/catalog/SSE 握手，以及 Linux x86_64 自包含打包 smoke。此项**不**代表 VM 资源或真实通知已通过。
- [x] 冻结本地归档：`relay/dist/frozen-alpha9/hapi-companion-sidecar-0.6.0-alpha.9-x86_64.tar.gz`；归档 SHA-256 `ad2fca710ff82c21dc1495c43435e0e007f7ea54f2b3045cb644f379245fa543`。内含程序 SHA-256 `64e60d9cec5bb740aaa93792afb72358d9905a2a1ec35180748ba2344b39eb33`，manifest 声明 schema 2、management API 2、consumer contract 1。归档重打包的 SHA 可能变化，VM 只能使用这份经过核对的字节。
- [x] 现有 service 文件默认 `Restart=on-failure`，没有 CPU/内存硬限制。因此下面的临时限制必须在获批后、首次启动前作为**只属于 Sidecar 的覆盖配置**落实并复核。

## 授权与 VM 基线：全部待核对

- [ ] 用户单独批准**生产 VM 上的 Sidecar shadow**，明确接受安装这一份归档、独立私有状态、一个只监听本机的进程、一个指向现有 HAPI Hub 的 SSE 连接、最长 30 分钟及下述资源限制。PR 合并、Updater 候选验收或本清单完成均不等于此项批准。
- [ ] 核对 VM 是 Linux x86_64、磁盘/内存/CPU 有余量；记录 Hub、Runner、现役 Relay 的进程身份、程序 hash、健康状态、原监听端口与自动升级暂停状态。不得在生产 Runner 的 cgroup 中编译。资源余量不够则取消本窗口。
- [ ] 核对 `127.0.0.1:8791` 未被占用；现役 Relay 仍在原监听地址，Nginx 的 `8790` 入口及所有公开路由不变。盘点是否存在旧 Sidecar 进程、`/opt/hapi-companion-sidecar`、`current` 链接、已安装 unit/drop-in、环境/凭据文件或 `/var/lib/hapi-companion-sidecar`；记录原启用/运行状态。来源或状态不明即停止。
- [ ] **调用安装器前的硬门禁：** 若有旧安装或私有状态，先确认旧服务已停止且无 JSON/SQLite 写入者；若它仍在运行，须在本次另行批准的影响范围内正常停止，否则取消安装。然后成套保留旧版本目录及程序、`current` 原链接和解析目标、base unit 与 drop-in、环境文件、匹配的 control JSON、SQLite 一致快照和全部 Sidecar 凭据文件；记录各自 hash、所有权和权限。核对 SQLite `integrity_check`、schema、非敏感行数与 consumer cursor，并在隔离副本上确认旧程序可读取这套状态。若即将安装的版本目录原本已存在，也单独保存其原内容。缺任一项则**不得运行 `scripts/install-sidecar.sh`**；服务 inactive 也不例外。若确实全新安装，记录上述路径原本不存在，并准备失败时仅清理本次创建资源的方案。
- [ ] 归档传到 VM 后重新计算归档和内含程序 SHA，并与上方两值逐字相等。安装目标仅为 `/opt/hapi-companion-sidecar`；状态仅为 `/var/lib/hapi-companion-sidecar`。确认上一项的回退集已验证，再调用安装器；它会覆盖 inactive unit 和 `current` 链接，不负责备份。安装过程不得启用、重启或替换 Hub、Runner、Relay。新旧 Sidecar 状态、JSON 和 SQLite 路径必须独立于现役 Relay。
- [ ] HAPI 源凭据只经私有文件和 systemd `LoadCredential` 提供；检查所有权、权限、挂载路径与认证是否可用，但不展示凭据内容。环境文件只含三个非敏感 HTTPS origin 和 `HAPI_SIDECAR_DELIVERY_MODE=shadow`；不把 token 放进环境、命令行、日志或报告。
- [ ] 启动前复核生效的**独立 Sidecar** systemd 配置：`Restart=no`、`RuntimeMaxSec=30min`、`CPUQuota=5%`、`MemoryMax=128M`、`MemorySwapMax=0`、`IOWeight=10`；绑定 `127.0.0.1:8791`，不设开机启用或持久 timer。配置不符合则不启动。
- [ ] 预先确认停止命令、值班人和**整套旧 Sidecar 恢复**方式；确认本窗口不会改 Mac/手机绑定、ntfy 接收方、Nginx、公网入口、Hub/Runner/Relay、现役 pin 或生产数据库。只允许 shadow 观察，通知投递行必须始终为零。

## 只有上述项目全部通过且获得批准后才执行

- [ ] 记录启动时间和 30 分钟硬截止；确认 Sidecar 仅一个进程、一个官方 HAPI SSE，状态达到 `live` 且无 attention code；未产生投递行。保持现役 Relay 为唯一通知发送方。
- [ ] 取空闲和代表性业务流量下的 60 秒 CPU、RSS、写入速率、fsync、数据库加 WAL 大小、重连次数与 Hub/Relay 延迟/健康基线；至少观察四个 75 秒的空闲/重连周期。alpha.8 曾达到约 3.7–6.1% CPU、215–431 KB/s 写入和约 92 次/s fsync，这一模式不得被当作通过。
- [ ] 观察至少一条真实 Runner 产生的 `ready`，用临时密钥生成**不含会话 ID、标题、正文和凭据**的比较报告，与现役补丁路径比对种类、指纹与时间。没有真实事件就记为未验收并按时停止，不伪造生产事件。其他四类只有本地 fixture 覆盖，尚无真实 VM 对照。
- [ ] Sidecar 自身断线后验证 `resume=ok`；强制 `resume=gap` 只在隔离测试状态中做，不重启生产 Hub，不改生产事件游标或数据库。记录恢复到 live 的结果及观测缺口；官方 SSE 的窗口外事件可能漏失，数量没有固定上限。

## 立即停止条件与收尾

- [ ] 出现 attention/crash/重启、任何投递行、公开监听或绑定变化、凭据边界异常、Hub/Relay 健康或延迟退化时立即停止。数据库加 WAL 达 80 MiB、RSS 超 100 MiB 或触发资源节流时立即停止；普通负载下连续两个 60 秒样本的 CPU 超 1%、写入超 50 KB/s 或 fsync 超 20 次/s 也停止。到 30 分钟未取得代表性流量或真实 `ready`，按未完成记录后停止，不自动延长。
- [ ] 停止 Sidecar，确认 `8791` 关闭、无残留进程/重启策略/开机启用。若试运行失败且旧 Sidecar 曾存在，移除本次临时资源限制覆盖配置，恢复旧版本目录和程序、`current` 原指向、unit/drop-in、环境、匹配 JSON+SQLite 与凭据文件，再 reload systemd；逐项复核文件 hash/权限、SQLite 完整性与 schema、非敏感行数、consumer cursor，并让旧程序针对**隔离状态副本**做关闭投递的启动验证。只在这些检查通过后恢复原来的启用/运行状态；原本 inactive 就保持 inactive。若恢复失败，保持 Sidecar 停止并记为未解决，现役 Relay 继续独自发送通知。全新安装失败则只清理本次新建资源。确认 Hub、Runner、现役 Relay 进程身份和健康状态与启动前一致；不回滚或改写生产 Hub 数据库。
- [ ] 只记录这次**有限 Phase-B** 的 PASS/FAIL、资源数字、事件数和非敏感 hash。规范要求的真实 completion、task、permission、input-request 与现役补丁对照仍未完成；在补齐或产品负责人正式修订规范之前，完整 Phase B 仍为未通过，不能切通知。Mac 横幅/声音、离线 ACK/重放、OPPO 通知及精确 PWA 窗口跳转还要另一次单源切换和真人验收；此次结果也不能据此撤掉 HAPI 补丁。

详细设计、已知损失边界和停机处理见 [V0.6 规范](../specs/V0_6_OFFICIAL_HAPI_SIDECAR.md)、[shadow 范围与回退](V0_6_ALPHA9_SHADOW_PROPOSAL.md)及[运行手册](V0_6_OFFICIAL_HAPI_SIDECAR_RUNBOOK.md)。
