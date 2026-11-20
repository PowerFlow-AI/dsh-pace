# DSH Pace

DeepSeek Harness 搜索与等待插件，适用于桌面端、[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 和其他 DSH profile。

## 拦截规则

Pace 在 DSH 的 `bash` 和 `pwsh` 工具调用中检查简单命令。

| 场景 | 触发条件 | 可执行的下一步 |
| --- | --- | --- |
| 大范围递归搜索 | `grep -Rn key .`、递归 grep 指向至少四个目标，或 PowerShell 的 `Get-ChildItem -Recurse \| Select-String key` | 改搜具体目录，如 `rg -n key src/`。 |
| 慢搜索重试 | 简单前台 `rg key .` 耗时 ≥60 秒或返回结构化超时，随后 15 分钟内，同一会话在同一工作目录重搜该关键词 | 改搜子目录，或用 `-t`、正向 `-g` 限定文件类型。 |
| 前台空等 | 命令以至少 60 秒的 `sleep` 或 PowerShell `Start-Sleep` 开头 | 立即查看日志或作业状态。 |

后台作业只提供提示，建议先用 `job_output(wait:false)` 查看进展。慢搜索记录仅存于会话内存中。规则只覆盖常见写法，不能用作 shell 安全边界。

## 安装与验证

需要 Node.js 22.19+（22.x）或 ≥24。当前 `main` 的 PowerShell 修复可通过本地安装使用。

- **桌面端**：在「插件」面板安装本地源码目录并启用，重启客户端。安装 npm 版时，在「安装第三方插件」中填写 `@powerflow-ai/dsh-pace`。
- **dsh-TUI、Web 或 headless**：在终端运行以下命令，然后重启客户端。按需将 `dsh-tui` 换成自己的 profile 名。

```sh
# 从当前源码目录安装
dsh plugin --profile dsh-tui add .

# 安装 npm 版
dsh plugin --profile dsh-tui add @powerflow-ai/dsh-pace
```

在新会话中让 **DSH 助手**调用 `pwsh` 执行 `Start-Sleep -Seconds 60`（Bash 用 `sleep 60`），应立即看到 Pace 的拦截提示。将时长改为 0 应正常返回。

桌面端可在「插件」面板移除。CLI 用户执行 `dsh plugin --profile dsh-tui remove @powerflow-ai/dsh-pace` 并重启对应客户端。在 Node.js 项目中集成 Harness 时，可通过 `npm install @powerflow-ai/dsh-pace` 添加依赖。

[变更记录](CHANGELOG.md)
