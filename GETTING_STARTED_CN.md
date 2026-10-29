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

当前已有 Linux x64 离线安装包，包含 Node.js 22.19.0、应用和运行依赖。已验证安装、任意工作目录启动、本地模型接口、文件读写、Bash 命令和会话保存；公司真实模型和原生 Windows 交付尚未验证。

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

启动工具需要 Node.js 18+ 和 npm，以及 curl、tar、Bash、GNU coreutils。工具自动获取固定的 Node.js 22.19.0，在该运行时下完成后续工作，因此不用先切换系统 Node。

流程自动完成：

1. 下载并校验固定版本的 Node、fd、rg 和模型目录，已有正确缓存直接复用。
2. 按锁文件安装开发依赖，恢复模型目录，运行完整检查及安装器、下载缓存测试。
3. 清理工作区生成文件，重新编译当前源码，避免删除源文件后遗留旧构建文件。
4. 按安装锁准备生产依赖，生成包含运行时和工具的离线包及 SHA-256 文件。
5. 在源码目录外解压安装，使用本地模拟模型验证文件读写、命令执行、流式响应和会话保存。

成功后终端输出安装包路径，并更新 `.artifacts/company-linux/latest.json`。默认每次生成一个独立的 `build-*` 目录，保留旧包；失败时不更新 latest，也不安装或替换日常使用的 `pi`。可指定一个尚不存在的输出目录：

```bash
npm run package:linux -- --out /path/to/new-output-directory
```

首次构建需要访问 Node.js、GitHub、pi.dev 和 npm 镜像；归档和模型目录缓存于 `.artifacts/company-cache/`，每次复用前仍校验哈希。npm 缓存遵循当前 npm 配置。后续使用已缓存包优先，缺少依赖时仍需连接镜像。内网使用时，需要导入这些缓存或确保构建源可访问；目标机器安装生成包无需联网。

固定下载地址与 SHA-256 在 `scripts/company-linux/assets.json`，模型目录 revision 在 `nix/model-catalog.json`。需要更新运行时或搜索工具时，审查并同步修改版本和校验值，不能只改 `.node-version`。

工具阻止同一仓库并发构建。如果构建进程被强制终止而留下 `.artifacts/company-build.lock`，先确认其中 `pid` 对应的构建已经退出，再移除该锁目录重试。

在相同架构的 Linux 上构建对应的包；本次验证环境为 x64。ARM64 下载信息已固定，仍需 ARM64 实机验证。完整检查可能按仓库既定规则自动格式化源码，构建后检查 `git diff`。

手动诊断时仍可分步构建，低层打包器保留：

```bash
npm run build:offline
node scripts/package-company-linux.mjs --runtime /path/to/node-v22.19.0-linux-x64 --tools /path/to/company-tools --out /path/to/new-output-directory
```

这两个分步命令需要事先准备 Node、包含许可文件的 fd/rg 目录、开发依赖和模型目录。独立验证命令：

```bash
node --test scripts/company-linux.test.mjs
node --test scripts/company-linux-assets.test.mjs
node scripts/smoke-company-linux.mjs --command /path/to/installed/bin/pi
```

模拟接口验证不使用真实模型密钥或额度，不能代替公司真实模型兼容性验证。

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
