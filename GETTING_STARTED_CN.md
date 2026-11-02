# Pi 中文上手指南

Pi 在终端中使用模型服务处理当前项目。安装包包含程序和 Node.js；目标机器不需要安装 npm 或访问外网，但使用模型时必须能访问配置的模型网关。

## 安装

将安装包及其同名 `.sha256` 文件传到目标机器。以下以 x64 文件名为例，请以实际文件名为准：

```bash
sha256sum --check company-pi-1.4.0-linux-x64.tar.gz.sha256
tar -xzf company-pi-1.4.0-linux-x64.tar.gz
cd company-pi-1.4.0-linux-x64
bash install.sh
```

默认安装目录为 `~/apps/company-pi`，命令链接为 `~/.local/bin/pi`。如果命令目录不在 PATH 中，可在终端执行下列命令，并将其加入 `~/.bashrc`：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

安装时也可以指定绝对路径；命令目录须位于安装目录之外：

```bash
bash install.sh --prefix "$HOME/apps/my-pi" --bin-dir "$HOME/.local/bin"
```

安装器不会覆盖已有的安装目录或 `pi` 命令。目标机器需要与安装包相同的 CPU 架构、与打包时 Node.js 兼容的系统库，以及 Bash 和 GNU coreutils。

## 登录模型网关

在项目目录启动 Pi，输入 `/login`：

```bash
cd /path/to/your-project
pi
```

按提示输入模型网关 URL 和 API Key。URL 例如 `https://your-gateway.example/v1`；输入根地址时会自动补上 `/v1`。密钥输入时不会显示。Pi 使用 Bearer 认证请求网关的模型列表，如果返回多个模型，选择要使用的模型；只有一个模型时自动选择。登录完成后可用 `/model` 切换已发现的模型。

如果模型列表无法获取，界面会提示原因并允许手动输入模型 ID。遇到认证失败时，请检查 URL、Key 和网关权限后重新登录。模型调用需要网关支持 OpenAI 兼容的 Chat Completions 接口。

模型配置默认保存在 `~/.pi/agent/models.json`，登录凭据保存在同目录的 `auth.json`。凭据文件包含敏感信息，请保护该目录和文件的访问权限，不要将它们提交到代码仓库。再次登录同一网关会更新凭据并保留已有模型配置。

如果网关没有返回上下文窗口和最大输出 token 数，Pi 分别使用 `128000` 和 `16384` 作为默认值。请按实际模型能力在 `models.json` 中为对应模型设置 `contextWindow` 和 `maxTokens`，例如：

```json
{ "id": "your-model-id", "contextWindow": 131072, "maxTokens": 8192 }
```

修改时请保留文件中其他模型和服务的配置。这些数值不会从模型推理接口自动推测。

## 日常使用

在启动目录输入任务，例如：

```text
用中文解释这个项目的目录结构和启动方式，先不要修改文件。
```

Pi 以启动用户的权限读写文件和执行命令。检查修改时可使用项目自己的版本控制工具。常用操作：

| 操作 | 命令 |
| --- | --- |
| 配置模型网关 | `/login` |
| 选择模型 | `/model` |
| 新建会话 | `/new` |
| 恢复会话 | `/resume` |
| 退出 | `/exit` |

也可以在终端继续上次会话或直接发送一条任务：

```bash
pi --continue
pi -p "解释项目结构，先不要修改文件。"
```

用户配置和会话默认位于 `~/.pi/agent/`。安装包不会自动下载搜索工具；`find` 和 `grep` 工具分别需要系统提供 fd（或 fdfind）和 rg。没有它们时，可在 Bash 中使用系统的 `find`、`grep` 或 `git grep`，具体行为可能不同。

## 构建安装包

构建机需要 Linux x64 或 arm64、Node.js 22.19.0 或更高版本、npm、tar、Bash 和 GNU coreutils，以及可访问的内网 HTTPS npm 镜像。先检查 npm 的 registry，再在源码根目录执行：

```bash
npm config get registry
npm run package:linux
cat .artifacts/company-linux/latest.json
```

构建从配置的镜像安装依赖和模型目录数据，使用当前 Node.js 打包，并进行安装与冒烟验证。`latest.json` 记录最新成功生成的安装包和校验文件路径。指定新输出目录可使用：

```bash
npm run package:linux -- --out /absolute/path/to/new-directory
```

## 卸载

卸载默认安装：

```bash
bash "$HOME/apps/company-pi/uninstall.sh"
```

如果指定过其他安装目录，运行该目录下的 `uninstall.sh`。卸载会删除整个安装目录，只有命令链接仍指向该安装时才移除链接；`~/.pi/agent/` 中的用户配置和会话会保留。
