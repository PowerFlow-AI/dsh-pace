# DSH Pace · 搜索与进度反馈插件

DeepSeek Harness 搜索与进度反馈插件：大仓库搜索加速，慢任务先看进展。

限制大范围搜索和前台长等待，提醒 agent 尽早反馈进展。

[dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) · 一个为 dsh-TUI 生态打造的插件

## 安装

按你使用的客户端选择一种安装方式。插件的完整 [npm 包名](https://www.npmjs.com/package/@powerflow-ai/dsh-pace) 是 `@powerflow-ai/dsh-pace`，需要 Node.js 22.19 或更高的 22.x 版本，或 Node.js 24 及以上。

### DeepSeek Harness 桌面端

1. 打开桌面端的「插件」面板，选择「安装第三方插件」。
2. 在「包名或地址」里粘贴 `@powerflow-ai/dsh-pace`，点击「安装」并确认。
3. 在已安装列表中确认 DSH Pace 已启用，然后重开桌面端，进入新会话。

### dsh-TUI

使用社区 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 时，在系统终端运行以下命令，然后重启 TUI。

```sh
dsh plugin --profile dsh-tui add @powerflow-ai/dsh-pace
```

### 其他 DeepSeek Harness 用户

插件按 profile（启动配置）安装。以 Web 用户为例，在终端执行以下命令，然后重新启动 Web 客户端。

```sh
dsh plugin --profile web add @powerflow-ai/dsh-pace
```

如果平时用 `dsh headless`，请把命令中的 `web` 换成 `headless`。自定义 profile 同样填写自己的启动配置名。

### 用 npm 安装到自己的项目

如果你在 Node.js 项目中集成 Harness，可以在项目根目录把插件加入依赖：

```sh
npm install @powerflow-ai/dsh-pace
```

这条命令只会将包加入当前项目。要让日常使用的 DSH 客户端加载 Pace，请按上面对应客户端的步骤启用它。

## 它会改变什么

| 当助手准备…… | Pace 的处理 |
| --- | --- |
| 用 `grep -Rn cache_key .` 从仓库根目录递归搜索 | **拦截**这类大范围扫描，建议缩小范围，例如 `rg -n cache_key config/`。普通 `grep` 不受影响；一次递归搜索四个及以上显式目标也可能触发。 |
| 再次执行刚刚很慢的 `rg cache_key .` | **第一次放行。** 如果这次简单前台搜索耗时至少 60 秒或返回超时，随后 15 分钟内，同一会话在同一路径重搜相同关键词会被拦截。改搜子目录或限定文件类型（如 `rg -t yaml cache_key .`）即可继续。 |
| 用 `sleep 60; ps …` 等一分钟再查状态 | **拦截**以至少 60 秒的前台 `sleep` 开头的这类命令，建议立即查状态。已经在运行的构建或训练不会被停止。 |
| 查询后台作业或排查复杂问题 | **只提示，不强制。** 建议先用 `job_output(wait:false)` 读取已有输出，告诉用户当前进展；长命令按可验证的步骤拆分，而不是按字符数拒绝。 |

Pace 减少的是无效搜索和前台空等，不会加快模型推理，也不会替助手定时播报进度。它只识别部分简单命令，不解析脚本内部，不能当作 shell 安全边界。慢搜索记录只保存在内存中，随会话销毁清除；插件不联网，也不收集遥测。

## 确认启用与卸载

终端用户运行 `dsh --profile dsh-tui --dump-config`（其他 profile 换成对应名称），应能看到 `- id: dsh-pace`。要验证实际行为，可以在新会话里让 **DSH 助手**用 Bash 执行 `grep -Rn cache_key .`：应看到 Pace 给出的拦截原因和替代建议。在普通终端里直接运行命令不会触发插件。

卸载 TUI 插件后重启即可恢复原行为：

```sh
dsh plugin --profile dsh-tui remove @powerflow-ai/dsh-pace
```

其他 CLI 用户把卸载命令中的 `dsh-tui` 换成安装时的 profile 名。桌面端用户可在「插件」面板停用或移除。通过 npm 添加项目依赖的用户，在项目根目录运行 `npm uninstall @powerflow-ai/dsh-pace`。
