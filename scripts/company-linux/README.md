# Linux 安装包

这是基于 pi v1.4.0 的公司 CLI 安装包，包含构建机上的 Node.js、应用和固定版本的运行依赖，不包含 fd 或 ripgrep。安装不需要 npm、源码或外网；处理任务需要可访问的模型服务。

包名中的 `linux-x64` 或 `linux-arm64` 表示目标架构。使用相同架构、与构建机 Node 二进制及其动态库兼容的 Linux；请先在目标环境验证。系统还需提供 Bash、GNU coreutils 和项目本身需要的开发工具。

## 安装

解压后执行：

```bash
bash install.sh
```

如 `~/.local/bin` 尚未在 PATH 中，在当前终端执行：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

将同一行加到自己的 `~/.bashrc`，新 Bash 终端也能使用。使用其他 shell 时加到相应的启动文件。系统级安装可由管理员执行：

```bash
sudo bash install.sh --prefix /opt/company-pi --bin-dir /usr/local/bin
```

默认安装到 `~/apps/company-pi`，命令链接位于 `~/.local/bin/pi`。安装器校验文件，不覆盖已有目录或 `pi` 命令。可以使用 `--prefix` 和 `--bin-dir` 自定义路径；命令目录必须在安装目录之外。

## 使用

```bash
pi --version
cd /path/to/your-project
pi
```

在 pi 中输入任务，例如“用中文说明项目的目录结构和启动方式”。模型未配置时，用 `/login` 配置受支持的服务，或在 `~/.pi/agent/models.json` 配置公司模型，再用 `/model` 选择。

`pi` 默认具有启动用户的权限，可以直接读写文件和执行命令。安装目录只放程序；模型凭据、配置和会话默认保存在每位用户的 `~/.pi/agent/`。工作目录是启动 `pi` 时所在的项目目录。

启动器使用安装包自带的 Node，并设置 `PI_OFFLINE=1`，关闭启动时联网和缺少搜索工具时的自动下载。项目构建命令仍使用用户配置的工具链。`find` 和 `grep` 专用工具分别需要系统提供 fd（或 fdfind）和 rg；没有时可通过 Bash 使用系统 find、grep 或 git grep，但行为并不完全相同。

```bash
pi --continue
pi -p "用中文解释项目结构，先不要修改文件。"
```

## 安装内容与维护

- `bin/pi`：启动命令，PATH 中的 `pi` 链接指向它。
- `runtime/`：构建机 Node.js 二进制及许可文件；其动态库由目标系统提供。
- `app/`：应用、依赖、锁文件和本地工作区包归档。
- `distribution.json`：版本、源码提交、是否含未提交改动、架构和模型数据来源及清单哈希。
- `SHA256SUMS`：安装包内文件校验值。

使用新的公司安装包升级，不使用 `pi update --self` 跟随公网版本。新包安装到新的目录并验证后，由管理员切换命令链接；用户配置和会话独立保存。

卸载默认安装：

```bash
bash "$HOME/apps/company-pi/uninstall.sh"
```

自定义安装时，运行对应安装目录下的 `uninstall.sh`。卸载会删除整个安装目录，包括自行放入其中的文件；仅当命令链接仍指向本安装时才移除它。`~/.pi/agent/` 中的会话和配置会保留。旧版安装包不含卸载脚本，可手动移除对应目录及命令链接。
