---
name: paper-reading
description: 用于阅读、摘取或核对论文 PDF 的指定页、公式、图表与版本定位。
---

# 论文 PDF

本机 Homebrew PATH 有 `pdfinfo`、`pdftotext`、`pdftoppm`。先确认论文版本与相关页，不把全文一次倒进上下文。PDF 文件页码与正文印刷页码分别记录。

```bash
PDF='/absolute/path/paper.pdf'
pdfinfo "$PDF" || exit
pdftotext -f 7 -l 9 -layout "$PDF" -
```

`-f`／`-l` 是从 1 开始的 PDF 页码；末尾 `-` 把选页文本送到 stdout。文本提取用于定位；上下标、符号、矩阵、积分界与公式编号需以实际页面核对，不能把提取文本当成精确方程。扫描页提取为空时直接查看所需页面。

只渲染需要核对的页到唯一私有临时目录，例如第 8 页：

```bash
PDF='/absolute/path/paper.pdf'  # 每次 bash 调用重新设置
ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/koishi-paper.XXXXXX")" || exit
pdftoppm -f 8 -l 8 -singlefile -r 180 -png "$PDF" "$ARTIFACT_DIR/page-8" || exit
printf '%s\n' "$ARTIFACT_DIR/page-8.png"
```

随后对命令实际生成的完整路径调用 `read_image`；渲染成功不等于已看图。看不清时只重渲染相应页并提高分辨率。

引用给出论文标识、明确版本（如 arXiv v3／出版版）、PDF 页码及可用的正文页码、方程或图表号。跨版本引用先核对编号与内容；不能仅凭相似题名或提取文本拼公式。

Python 的 `pypdf`、`pdfplumber`、`reportlab` 未安装；不默认安装，也不假设它们随 Python 附带。确需 Python 辅助时用 `load_workspace_dependencies` 发现环境，不硬编码运行时路径。
