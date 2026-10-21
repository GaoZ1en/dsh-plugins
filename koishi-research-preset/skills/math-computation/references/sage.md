# Sage

环境：SageMath 10.9，含 SymPy 1.14.0；本机 CLI 为 `/usr/local/bin/sage --nodotsage`。例如 `--nodotsage -c 'from sage.all import *; print(factor(123456))'`。代码使用 Python 兼容语法（幂写 `**`），不要依赖预解析或上次调用的变量。

- `mcp__sage__sage_run`：在 `code` 中自包含定义环、域、基、秩、表示标签及待算对象；适合探索与批量计算。
- `mcp__sage__sage_verify_checks`：`setup` 定义共同环境，`checks` 中每项只有 `label` 与 `condition`。每项必须得到精确的 Python `True` 或 `False`；结果可能为 `passed`、`failed`、`non_boolean` 或 `error`。

符号关系不是 Python 布尔值。先明确比较语义，例如在确定的多项式环中检验相等；不要用 `bool(symbolic_relation)` 掩盖不可判定。工具不替你化简、选数值容差、变换表示环或推出秩稳定性。最小接口示例（非一次实际验算）：

```json
{
  "setup": "from sage.all import QQ, PolynomialRing\nR = PolynomialRing(QQ, 'x')\nx = R.gen()",
  "checks": [{"label": "多项式环中的相等", "condition": "(x + 1)**2 == x**2 + 2*x + 1"}]
}
```

按标签读取状态、异常和截断提示；`non_boolean` 不等于命题为假。使用 SymPy 时在本次 Sage 代码中显式 `import sympy`；其结果来自同一库，不因换入口而成为新的独立实现。

## 完整输出落盘

把实际计算替换到 `result`，在同一次 `sage_run` 中导出。`tempfile.mkdtemp` 在 `$DSH_HOME/research-results/kernel-exports` 下创建唯一、权限 0700 的私有目录；未设置 `DSH_HOME` 时用 `~/.dsh`，不写入笔记目录或依赖系统临时文件保留期。

```python
from sage.all import QQ, PolynomialRing, save
from pathlib import Path
import os, tempfile, textwrap

R = PolynomialRing(QQ, 'x')
x = R.gen()
result = (x + 1)**20  # 替换为本次完整计算
store = Path(os.environ.get('DSH_HOME') or (Path.home() / '.dsh')) / 'research-results' / 'kernel-exports'
store.mkdir(parents=True, exist_ok=True, mode=0o700)
out = Path(tempfile.mkdtemp(prefix='sage-', dir=store))
exact = out / 'result.sobj'
preview = out / 'preview.txt'
save(result, str(exact))
lines = str(result).splitlines()
preview.write_text('\n'.join(
    textwrap.fill(line, width=100, replace_whitespace=False,
                  drop_whitespace=False) for line in lines
) + '\n', encoding='utf-8')
print(str(preview))
print(str(exact))
```

只向工具返回路径；用 `read` 的 `offset`／`limit` 读取预览。`.sobj` 保存原生对象，恢复时仅加载自己生成且可信的文件，并记录版本与原计算代码。预览不是反序列化输入；“完整保存”不提高原数值的精度。若对象不可序列化，按其类型选择无损格式并明确未保存的状态，不宣称完整导出。
