# 公司版本维护说明

项目背景、启动方法、模型接入和日常操作见 [中文上手说明](GETTING_STARTED_CN.md)。

## 固定基线

| 项目 | 固定值 |
| --- | --- |
| 上游版本 | `v1.4.0` |
| 上游提交 | `4a080252f06caf63a525d7873c5d94d3c23887e0` |
| 公司开发分支 | `company/v1.4` |
| Node.js | `22.19.0` |
| npm | `10.9.3`（随上述 Node.js 提供） |
| 使用环境 | 原生 Windows + Git for Windows；Linux 服务器 + Bash |
| 模型目录 revision | `sha256-7fe1b41feaf43a7aad4bc832e6b306c7ced56e6d41bbc724b74e91eeacff6edf`（来自基线的 `nix/model-catalog.json`） |

`.nvmrc` 和 `.node-version` 记录开发环境版本，供支持它们的版本管理器使用；这两个文件不会自动安装或切换 Node.js。安装后先执行 `node --version` 确认版本。

当前范围是研发使用的命令行编程助手。中文交互、公司模型配置和内部工具接入后续实现。

## 开发环境

Windows 安装 Node.js 22.19.0 和 Git for Windows。以下 Bash 命令在 Windows 的 Git Bash 或 Linux 的 Bash 中执行。

```bash
node --version
npm --version
npm ci --ignore-scripts
```

依赖以根目录的 `package-lock.json` 为准。首次安装不执行依赖生命周期脚本。检查命令会自动格式化文件，运行后需要检查 `git diff`。

首次检查或运行前，还需要准备模型目录数据。在外网获取固定 revision，避免使用不断变化的最新目录：

```bash
mkdir -p .artifacts/company
curl -fsSL 'https://pi.dev/api/models/revisions/sha256-7fe1b41feaf43a7aad4bc832e6b306c7ced56e6d41bbc724b74e91eeacff6edf?types=chat,image,classifier' -o .artifacts/company/models.all.json
sha256sum .artifacts/company/models.all.json
```

确认 SHA-256 为 `7fe1b41feaf43a7aad4bc832e6b306c7ced56e6d41bbc724b74e91eeacff6edf` 后执行：

```bash
node packages/ai/scripts/hydrate-model-catalog.ts .artifacts/company/models.all.json
npm run check:model-data
npm run check
./pi-test.sh --version
./pi-test.sh --help
```

内网使用已导入且校验通过的 `models.all.json`，跳过下载步骤，再执行相同的数据恢复命令。模型目录数据位于被 Git 忽略的 `packages/ai/src/providers/data/`，只传源码和锁文件不能保证离线构建。

源码调试入口为 `./pi-test.sh`。一键生成安装包执行 `npm run package:linux`，工具自动准备固定输入、检查、编译、打包并验证源码目录外的安装。最新成功结果记录在 `.artifacts/company-linux/latest.json`，包含独立运行时、fd/rg 搜索工具和生产依赖。安装和使用方法见 [中文上手说明](GETTING_STARTED_CN.md#安装到其他目录或内网服务器)。

完整开发依赖安装存在上游警告：Gondolin 扩展示例要求 Node.js ≥23.6，`autoevals` 声明使用 pnpm，且部分传递依赖已弃用。Node.js 22.19.0 下的基础 CLI 验证不覆盖这些可选开发用途，不通过忽略版本检查或降级依赖来处理警告。

## 上游修复

在固定基线上维护公司改动，不自动合并上游 `main`。需要的缺陷或安全修复逐项评估，以独立提交引入，并验证 Windows、Linux 两个平台。基线升级单独评估。

固定源码基线不代表永久冻结运行时和依赖的安全补丁；更新后需重新验证并记录准确版本。

## 内网导入

每批导入记录源码提交、Node.js/npm 版本、锁文件、所需依赖包、模型目录数据和验证结果。内网镜像必须预先具备锁文件中的准确依赖版本；还需检查锁文件的下载地址能否在内网访问。

保留 Git 历史，可用 Git bundle 传递公司分支。例如，在提交公司改动后：

```bash
git bundle create /path/to/pi-company.bundle company/v1.4 v1.4.0
git bundle verify /path/to/pi-company.bundle
```

Git bundle 只包含已提交的源码历史，不包含工作区改动、npm 依赖、被忽略的模型数据或构建产物。首次可从 bundle 克隆，后续可从新 bundle 获取更新。

正式交付前，分别在原生 Windows 和目标 Linux 系统验证安装、读写文件、执行命令、会话恢复和内网模型工具调用。记录系统版本和 CPU 架构；本地模拟模型测试不能代替真实模型兼容性验证。

## 基线验证记录

2026-10-29，在 Linux x86_64、Node.js 22.19.0、npm 10.9.3 下：

- `npm ci --ignore-scripts` 完成；安装警告见上文。
- 固定 revision 的模型目录 SHA-256 校验和 `npm run check:model-data` 通过。
- `npm run check` 通过，无格式化改动。
- `./pi-test.sh --version` 返回 `1.4.0`，`--help` 正常退出。
- 以下 4 个测试文件共 64 个测试通过，使用模拟模型，无真实模型 API 调用。

从对应包目录运行指定测试：

```bash
cd packages/ai
node ../../node_modules/vitest/dist/cli.js --run test/faux-provider.test.ts
cd ../coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-prompt.test.ts test/suite/agent-session-tool-orchestration.test.ts test/suite/agent-session-bash-persistence.test.ts
```

Linux x64 安装包已在源码目录外解压，安装到 `/home/sjr/.local/share/company-pi-1.4.0`，通过 `/home/sjr/.local/bin/pi` 启动。包内包含 fd 10.3.0 和 ripgrep 14.1.1，支持无外部搜索工具时离线启动。已验证本地模拟 OpenAI 接口的流式输出、读取文件、写入文件、执行 Bash 时保留工作目录和会话保存；安装器的 5 项测试通过。

原生 Windows、其他 Linux 系统、实际内网镜像和真实模型服务尚未验证。
