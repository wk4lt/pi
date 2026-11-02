# Pi 命令行助手

Pi 可以在项目目录中读取和编辑文件、执行命令，并通过模型服务协助完成开发任务。使用前请准备支持 OpenAI Chat Completions 接口的模型网关和 API Key。

## 安装与使用

将 Linux 安装包和对应的校验文件放在同一目录，校验后解压并安装。以下文件名以实际构建产物为准：

```bash
sha256sum --check company-pi-1.4.0-linux-x64.tar.gz.sha256
tar -xzf company-pi-1.4.0-linux-x64.tar.gz
cd company-pi-1.4.0-linux-x64
bash install.sh
export PATH="$HOME/.local/bin:$PATH"
cd /path/to/your-project
pi
```

在 Pi 中输入 `/login`，按提示输入网关 URL 和 API Key。程序会读取网关的 `/v1/models` 模型列表；有多个模型时选择一个即可开始使用。获取列表失败时可手动输入模型 ID。用 `/model` 切换已配置的模型。

默认安装到 `~/apps/company-pi`，命令位于 `~/.local/bin/pi`。如需自定义路径：

```bash
bash install.sh --prefix "$HOME/apps/my-pi" --bin-dir "$HOME/.local/bin"
```

安装、登录、构建、卸载和常用命令的完整说明见 [中文上手指南](GETTING_STARTED_CN.md)。

## 构建安装包

在 Linux x64 或 arm64 构建机上准备 Node.js 22.19.0 或更高版本、npm、tar、Bash 和 GNU coreutils，将 npm registry 配置为可访问的内网 HTTPS 镜像，然后在源码根目录执行：

```bash
npm config get registry
npm run package:linux
cat .artifacts/company-linux/latest.json
```

构建使用当前 Node.js 和 npm 镜像，检查、编译并验证安装包。目标机器需要相同 CPU 架构以及与构建机 Node.js 兼容的系统库。

## 更多用法

- [命令行选项](packages/coding-agent/docs/cli.md)
- [扩展](packages/coding-agent/docs/extensions.md)、[技能](packages/coding-agent/docs/skills.md)和[提示词模板](packages/coding-agent/docs/prompt-templates.md)
- [安装包使用说明](scripts/company-linux/README.md)
