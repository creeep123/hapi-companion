# 配置目录选择修复

Status: in-progress

Spec: docs/specs/CONFIGURATION_DIRECTORY.md

实现应用专属持久目录、HAPI_HOME 兼容、doctor/installer 一致选择。目标设备安装验收由 HAPI peer b9418690-f3b4-4284-a8f0-c536a843de5c 协作；保持两个 Runner 原状。验收按 spec 四项逐项记录，不保存凭据。

## Local verification
- 32 Swift tests passed; Release build passed.
- 7 shell path-resolution checks passed; zsh syntax and git diff --check passed.
- doctor passed for existing default configuration, without changing this Mac's installation or preferences.
- Hub patch hash remains 2a96be323c0d837793d32fd20fffc44efd6828e6a9263da5ebffcc5cf79e95bd.
- Remote target-device verification pending.
