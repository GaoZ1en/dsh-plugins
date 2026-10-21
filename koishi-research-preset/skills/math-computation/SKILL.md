---
name: math-computation
description: 用于需要 Sage、Wolfram 或 xAct 内核的非平凡代数、数值、张量计算及机器验算。
---

# 数学内核

选定内核后，只读取对应说明，不预载另外两份：

- Sage：精确代数、表示论、离散结构或 Sage 内的 SymPy → [sage.md](<references/sage.md>)。
- Wolfram：一般符号推导、积分、方程与数值计算 → [wolfram.md](<references/wolfram.md>)。
- xAct：抽象指标、曲率、张量变分或分量几何 → [xact.md](<references/xact.md>)。

每次工具调用都是新内核；把定义、假设和同一设定下的多项计算放进一批，减少重复启动开销。

DSH Python 用 `load_workspace_dependencies` 发现，不硬编码运行时路径；它有 NumPy、没有 SymPy。需 SymPy 时使用 Sage 所含的 1.14.0，不默认安装包。

说明中的工具名省略可能的 `functions` 命名空间；以会话实际 schema 调用，不添加参数或假想方法。工具缺席时才按许可使用对应本机 CLI，并注明替代。输出截断时按该内核说明导出完整结果到持久结果目录下的唯一私有子目录，再用 `read` 分段读取换行预览；不要把大表达式反复打印到上下文或覆盖研究原文。
