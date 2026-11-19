# DSH Pace · 搜索与进度反馈插件

DeepSeek Harness 搜索与进度反馈插件：大仓库搜索加速，慢任务先看进展。

限制大范围搜索和前台长等待，提醒 agent 尽早反馈进展。

## 安装

已安装 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)？在终端运行以下命令，即可为它安装 DSH Pace 的 [npm 包](https://www.npmjs.com/package/@powerflow-ai/dsh-pace)：

```sh
dsh plugin --profile dsh-tui add @powerflow-ai/dsh-pace
```

重新启动 TUI 即可使用，无需配置。需要 Node.js 22.19 或更高的 22.x 版本，或 Node.js 24 及以上。若使用 DSH Desktop，可在 Plugins 面板选择本插件的本地源码目录并启用，再重开 Desktop。

## 它会改变什么

| 当助手准备…… | Pace 的处理 |
| --- | --- |
| 用 `grep -Rn cache_key .` 从仓库根目录递归搜索 | **拦截**这类大范围扫描，建议缩小范围，例如 `rg -n cache_key config/`。普通 `grep` 不受影响；一次递归搜索四个及以上显式目标也可能触发。 |
| 再次执行刚刚很慢的 `rg cache_key .` | **第一次放行。** 如果这次简单前台搜索耗时至少 60 秒或返回超时，随后 15 分钟内，同一会话在同一路径重搜相同关键词会被拦截。改搜子目录或限定文件类型（如 `rg -t yaml cache_key .`）即可继续。 |
| 用 `sleep 60; ps …` 等一分钟再查状态 | **拦截**以至少 60 秒的前台 `sleep` 开头的这类命令，建议立即查状态。已经在运行的构建或训练不会被停止。 |
| 查询后台作业或排查复杂问题 | **只提示，不强制。** 建议先用 `job_output(wait:false)` 读取已有输出，告诉用户当前进展；长命令按可验证的步骤拆分，而不是按字符数拒绝。 |

Pace 减少的是无效搜索和前台空等，不会加快模型推理，也不会替助手定时播报进度。它只识别部分简单命令，不解析脚本内部，不能当作 shell 安全边界。慢搜索记录只保存在内存中，随会话销毁清除；插件不联网，也不收集遥测。

## 确认启用与卸载

运行 `dsh --profile dsh-tui --dump-config`，应能看到 `- id: dsh-pace`。要验证实际行为，可以在新会话里让 **DSH 助手**用 Bash 执行 `grep -Rn cache_key .`：应看到 Pace 给出的拦截原因和替代建议。在普通终端里直接运行命令不会触发插件。

卸载 TUI 插件后重启即可恢复原行为：

```sh
dsh plugin --profile dsh-tui remove @powerflow-ai/dsh-pace
```

Desktop 用户可在 Plugins 面板停用或移除。若此前安装过本地旧包 `@local/dsh-pace` 或 `rg-search-reminder`，不要与新版同时启用。
