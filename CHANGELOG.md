# 变更记录

## 未发布

- 修复 Windows 会话通过 DSH 的 `pwsh` 工具绕过 Pace 拦截的问题。大范围递归 grep、前台长等待和慢速 rg 重搜均适用，支持 `grep.exe`、`rg.exe` 和 `.\` 路径。
- 识别 PowerShell 的 `Start-Sleep`（秒或毫秒），以及从当前目录递归列举文件后直接交给 `Select-String` 的常见写法。
- 历史回放纳入 `pwsh` 调用，分别统计 Bash 和 PowerShell 的调用次数。

## 0.1.0

- 为 DSH Bash 工具添加递归 grep、前台长等待及慢搜索重试拦截，提供后台作业进度查询提示。
