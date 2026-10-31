# pi 公司版本：背景与使用

## 这是什么项目

pi 是一个用 TypeScript 开发的命令行 AI 助手，上游仓库使用 MIT 许可证。它在研发电脑或服务器终端中运行，可以读取代码、修改文件、执行命令，并保存和恢复会话。

模型负责理解需求和决定下一步；pi 负责把文件、工具结果发送给模型，并执行模型请求的工具。例如：

```text
你：解释这个项目如何启动
  → 模型请求读取 README、package.json
  → pi 读取文件，把结果返回模型
  → 模型输出启动步骤
```

pi 本身不附带可生成回答的模型，需要连接模型服务。仓库下载的“模型目录数据”只记录模型名称、能力和参数，不是模型权重，也不提供免费推理额度。

## 我们要做的公司版本

- 面向研发的命令行编程助手，运行于原生 Windows（Git for Windows）和 Linux 服务器。
- 基于上游 `v1.4.0`，在 `company/v1.4` 分支长期维护；Node.js 固定为 `22.19.0`。
- 外网开发验证后，定期将源码、依赖和交付产物导入内网。
- 后续接入公司 OpenAI 兼容模型服务，再考虑中文界面和公司工作流。

Linux 安装包包含构建机 Node.js、应用和运行依赖。每次构建后请在目标机器验证安装、文件操作及真实模型连接。

## 当前这台 Linux 机器直接使用

程序已安装到 `/home/sjr/.local/share/company-pi-1.4.0`，启动命令为 `/home/sjr/.local/bin/pi`。当前 PATH 已包含命令目录，直接执行：

```bash
pi --version
cd /你的业务项目目录
pi
```

版本输出应为 `1.4.0`。最后一条命令打开交互界面，操作当前业务项目。

程序使用安装目录中的 Node，不依赖 `/tmp`、系统 Node 或源码仓库。模型配置和会话默认保存在 `~/.pi/agent/`。

首次启动可能询问是否信任当前项目。信任后可加载项目扩展和配置。模型尚未配置时，需要完成下一节才能实际处理任务。

## 安装到其他目录或内网服务器

每次一键构建的安装包路径记录在 `.artifacts/company-linux/latest.json`，旁边有同名 `.sha256` 文件。将安装包和校验文件传到相同架构的 Linux 机器，在它们所在目录执行：

```bash
sha256sum --check company-pi-1.4.0-linux-x64.tar.gz.sha256
tar -xzf company-pi-1.4.0-linux-x64.tar.gz
cd company-pi-1.4.0-linux-x64
bash install.sh --prefix "$HOME/apps/company-pi" --bin-dir "$HOME/.local/bin"
```

安装不访问网络，不需要预装 Node 或 npm。目标系统需要 Bash、GNU coreutils 和兼容的 glibc；本次产物不适用于 Alpine/musl 或 ARM64。业务项目使用的 Git、编译器等工具由项目环境提供。

命令目录首次使用时，若不在 PATH 中，执行下面一行，并加入自己的 `~/.bashrc`：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

之后无论在哪个项目目录，均可执行 `pi`。也可由管理员安装到 `/opt`：

```bash
sudo bash install.sh --prefix /opt/company-pi --bin-dir /usr/local/bin
```

安装器不覆盖已有目录或 `pi` 命令。安装目录和命令目录可自定义，命令目录必须位于安装目录之外。升级时安装到新目录、验证后再切换命令链接，保留用户配置和会话。

## 连接模型后才能处理任务

已有 pi 支持的模型服务账号时，在交互界面输入 `/login`，选择服务并按提示配置，然后用 `/model` 选择模型。模型调用是否免费取决于服务和账号，pi 不提供推理额度。

公司内网使用自定义端点。以下是接入说明模板，目前没有写入你的用户配置。

默认用户配置目录为 Linux 的 `~/.pi/agent`，Windows 通常为 `C:\Users\你的用户名\.pi\agent`。也可用 `PI_CODING_AGENT_DIR` 指定位置。在 Git Bash 或 Linux Bash 中可用 `mkdir -p ~/.pi/agent` 创建默认目录。

在该目录新建或合并 `models.json`，已有配置时保留其他 provider：

```json
{
  "providers": {
    "company": {
      "baseUrl": "https://your-model-gateway.example/v1",
      "api": "openai-completions",
      "apiKey": "$PI_MODEL_API_KEY",
      "authHeader": true,
      "models": [
        { "id": "your-model-id" }
      ]
    }
  }
}
```

将 `baseUrl` 和模型 `id` 换成服务提供的实际值。这里的 `openai-completions` 对应 Chat Completions 接口；如果服务只支持 Responses，需要改用匹配的 API 类型。上下文长度、输出限制和兼容参数后续按服务能力验证配置。

在启动 pi 的同一个 Git Bash 或 Linux Bash 终端中输入密钥，避免把真实密钥写进示例或命令历史：

```bash
read -r -s -p 'Model API key: ' PI_MODEL_API_KEY
export PI_MODEL_API_KEY
```

输入结束按 Enter，再启动：

```bash
pi --provider company --model your-model-id
```

用户级 `models.json`、`auth.json` 和真实密钥均不随安装包分发。

## 怎样让它处理自己的项目

工作目录决定 pi 操作哪个项目，在业务项目目录启动即可：

```bash
cd /path/to/your-project
pi
```

在界面中输入任务并按 Enter，例如：

```text
用中文解释这个项目的目录结构和启动方式，先不要修改文件。
```

```text
阅读 @README.md 和 @package.json，列出开发前需要安装的工具。
```

```text
定位登录失败的原因，先说明依据，再修改相关代码，最后运行对应测试。
```

模型可以用中文沟通；是否能准确回答取决于模型能力。pi 界面的菜单和状态文字目前仍使用上游语言。

pi 默认直接执行工具，继承启动用户的系统权限，不会逐条要求批准。终端会展示读文件、编辑和命令执行过程。执行后用 `git diff` 查看代码变化。

| 操作 | 输入或按键 |
| --- | --- |
| 选择模型 | `/model` |
| 新建会话 | `/new` |
| 选择历史会话 | `/resume` |
| 查看会话信息 | `/session` |
| 查看快捷键 | `/hotkeys` |
| 中止当前任务 | `Escape` |
| 运行命令并让模型看到输出 | `!git status` |
| 只在终端执行，不把输出放进对话 | `!!git status` |

退出后，在同一项目目录执行下面的命令，继续最近一次会话：

```bash
pi --continue
```

自动化时可使用非交互模式，完成后退出：

```bash
pi -p "用中文说明这个仓库如何运行测试，先不要修改文件。"
```

## 维护者如何重新构建 Linux 安装包

在 Linux 源码仓库根目录执行一个命令：

```bash
npm run package:linux
```

构建机需要 Linux、Node.js >=22.19.0、npm、tar、Bash 和 GNU coreutils，并将 npm registry 配置到公司 HTTPS 镜像，并将 `PI_COMPANY_NPM_REGISTRY` 设置为同一镜像地址。Node 和目标机器必须架构、动态库兼容。若自动定位不到 Node 许可文件，请设置 `PI_NODE_LICENSE_FILE` 指向该 Node 的许可文件。

脚本使用公司镜像安装锁定依赖，从镜像获取源码同版本的 `@earendil-works/pi-ai` 包并提取包含 `.manifest.json` 的模型数据，校验后离线编译，再生成自带 Node 的安装包。安装器及本地模拟模型冒烟测试通过后更新 `.artifacts/company-linux/latest.json`。包不含 fd 和 rg：缺失时其专用工具不可用，Bash 可使用系统 find、grep 或 git grep。

该命令不调用 nodejs.org、GitHub 或 pi.dev。构建前需由维护人员确认环境变量中的地址是公司授权的内网镜像；构建机网络策略仍需限制镜像重定向及其他进程的外网访问，脚本本身不是网络隔离机制。模型包依赖镜像提供源码版本的数据；生成清单中的文件哈希和结构会在构建时验证。

成功产物放在 `.artifacts/company-linux/` 的独立目录中，也可指定一个不存在的输出目录：

```bash
npm run package:linux -- --out /path/to/new-output-directory
```

发生异常退出时，若留下 `.artifacts/company-build.lock`，确认该目录内记录的构建进程已退出后再移除。正式交付前，需在目标机器验证动态库、真实公司模型、文件操作和会话；本地模拟测试不能替代真实模型联调。

源码调试仍使用：

```bash
./pi-test.sh
```

Windows 暂时保留 Node.js + Git for Windows 的源码开发方式，尚未提供本次 Linux 包对应的 Windows 安装器。

## 二次开发从哪里看

| 位置 | 负责什么 |
| --- | --- |
| `packages/coding-agent` | CLI 入口、会话、内置工具、扩展和用户配置 |
| `packages/agent` | 模型与工具之间的执行循环 |
| `packages/ai` | 模型服务协议、流式输出和模型目录 |
| `packages/tui` | 终端界面、输入编辑和渲染 |
| `packages/coding-agent/docs` | 功能、配置和扩展文档 |

先运行并熟悉 CLI，再用配置、项目 `AGENTS.md`、Skills 和扩展实现公司需求。模型接入优先使用 `models.json`；只有现有配置和扩展无法满足需求时，再修改核心实现。

版本维护、检查命令、验证记录和内网导入约定见 [COMPANY.md](COMPANY.md)。
