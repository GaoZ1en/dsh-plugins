---
name: latex
description: 用于编译或排查现有 LaTeX 工程，遵循真实根文件、引擎指令及项目配置，并隔离构建产物。
---

# LaTeX 编译与排错

本机 TeX Live 2026 位于 `/Library/TeX/texbin`，有 `latexmk`、`xelatex`、`lualatex`、`biber`、`kpsewhich`；没有 Tectonic，也不需要先安装它。不复制其他插件的缓存路径或默认安装宏包。

先读取实际入口与项目配置：沿 `% !TeX root` 定位根文件，尊重 `% !TeX program`、`latexmkrc`／`.latexmkrc`、构建脚本及既定参考文献流程。不把当前片段或被 `\input` 的文件当根文件，不为编译成功擅换引擎。

以真实项目目录作为 `bash` 的 `workdir`，将构建产物放到独立输出目录；先检查自定义规则是否也会写回源目录。保留项目所需参数。仅当项目指定 XeLaTeX 时，使用如下形式：

```bash
export PATH="/Library/TeX/texbin:$PATH"
ROOT='main.tex'  # 替换为已确认的真实根文件
OUT="$(mktemp -d "${TMPDIR:-/tmp}/koishi-latex.XXXXXX")" || exit
printf 'Output directory: %s\n' "$OUT"
latexmk -xelatex -interaction=nonstopmode -halt-on-error \
  -file-line-error -outdir="$OUT" "$ROOT"
```

LuaLaTeX 对应用 `-lualatex`；其他引擎依项目配置选择。`latexmk` 按工程依赖驱动多轮与参考文献处理；不盲目混用 Biber／BibTeX。项目必须使用自有构建命令时，先确认其隔离输出方式；不要以通用命令抹掉配置。`-shell-escape` 仅在项目确需且已获许可时启用。

临时最小复现另放新建测试目录，不覆盖原文。用 `grep` 工具定位日志中首个相关错误，再用 `read` 看相邻行；关注未定义控制序列、缺文件／字体、Biber 错误、未解析引用及相关排版警告，不倾倒整份日志。用 `kpsewhich` 检查依赖实际解析位置，不凭文件名猜缺包。

检查退出状态、此次生成的 PDF 与日志后报告结果及输出位置；退出成功不代表引用、字体等告警已解决。需要核对 PDF 内容或公式时，按需加载 `paper-reading` 并查看对应页。确需 Python 辅助才用 `load_workspace_dependencies` 发现环境。
