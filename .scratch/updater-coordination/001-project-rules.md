# 固化 Companion / updater 协作规则

Status: complete

## Objective and scope
将补丁变更交接、pin 更新及升级验收写入 AGENTS.md、Control Panel 和 integrations/hapi/README.md；不修改补丁、运行代码或 updater 实现。

## Acceptance criteria
- 明确两项目所有权，补丁变更必须通知 updater 更新 pin 并重新验收。
- 交接记录包括双方提交、校验值、测试证据和确认状态；消息送达不等于完成。
- 升级验收包含目录契约、SSE、ACK、服务恢复与失败回滚；记录 SSE 超时误判和备份路径经验。
- 当前实际补丁 SHA 与已锁定 SHA 一致；git diff --check 通过。

## Verification
`shasum -a 256 integrations/hapi/hapi-companion.patch` 与用户提供 pin 一致。
`git diff --check` 通过。仅文档修改，无需运行应用测试。
