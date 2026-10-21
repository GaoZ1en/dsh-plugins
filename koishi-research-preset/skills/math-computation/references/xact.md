# xAct

- `mcp__xact__xact_run`：以 `code` 提供本次完整定义与计算。
- `mcp__xact__xact_verify_residuals`：以 `setup` 提供共同定义，`checks` 每项含 `label`、`residual`；需要时显式给 `assumptions`。

每次调用新 Wolfram 内核。写齐流形、维数、指标、度规号差、联络、张量、对称性与替换规则；已有包加载不代表用户张量已定义。`profile` 默认 `core`；需要 xCoba 分量功能才用 `components`，需要 xCPS 才用 `cps`，确需全部包才用 `all`。`extraPackages` 只填已确认的包上下文。

残差核查显式选择 `pipeline`：`none`、`canonical`、`canonical_contract` 或 `full`（默认 `canonical`）。需要度规收缩时选择含收缩的管线；检查实际返回的规范化过程，不从 `full` 的名称推定它证明了所有恒等式。特定假设、恒等式或等价关系所需的规则应在代码中明写。

状态含 `zero`、`nonzero_normal_form`、`unevaluated`、`error`。`zero` 仍可能伴有警告；同时检查包加载与计算诊断，判断警告是否影响定义或结果。非零正规形未必是原命题的反证，可能尚缺合法规则；未求值与错误也不是“非零”。对变分等计算，构造实际结果减目标的残差，不把函数成功返回当成目标已验证。

xAct 与 Mathematica 都由 Wolfram 计算，不算两个独立实现。需要消息捕获时使用局部 `$MessageList`，不用 `Quiet` 抹去诊断；包加载阶段的诊断还须从工具返回读取。

## 完整输出落盘

在 `xact_run` 中使用相同 `profile`，替换下面自包含的 `input`。示例为 `core`；报告中的字段是自建数据，不是工具 schema。`mktemp -d` 在持久结果目录 `$DSH_HOME/research-results/kernel-exports` 下创建唯一、权限 0700 的私有目录；未设置 `DSH_HOME` 时用 `~/.dsh`。

```wolfram
Module[{input, result, report, tmp, dir, exact, preview, text},
  input = "DefManifold[M, 4, {a, b, c, d}];
    DefMetric[-1, g[-a, -b], CD];
    DefTensor[V[a], M];
    ToCanonical[ContractMetric[g[-a, -b] V[a] V[b]]]";
  report = Block[{$Messages = {}, $MessageList = {}},
    result = ToExpression[input];
    <|"Input" -> input, "Profile" -> "core", "Result" -> result,
      "Failed" -> (result === $Failed || result === $Aborted),
      "Messages" -> (ToString[#, InputForm] & /@ $MessageList)|>
  ];
  tmp = Module[{home = Environment["DSH_HOME"], root},
    If[!StringQ[home] || home == "",
      home = FileNameJoin[{$HomeDirectory, ".dsh"}]];
    root = FileNameJoin[{home, "research-results", "kernel-exports"}];
    If[!DirectoryQ[root], CreateDirectory[root, CreateIntermediateDirectories -> True]];
    RunProcess[{"mktemp", "-d", FileNameJoin[{root, "xact.XXXXXX"}]}]
  ];
  If[tmp["ExitCode"] =!= 0, Return[tmp]];
  dir = StringTrim[tmp["StandardOutput"]];
  exact = Export[FileNameJoin[{dir, "result.wxf"}], report, "WXF"];
  text = ToString[report, InputForm, PageWidth -> 100];
  preview = Export[FileNameJoin[{dir, "preview.txt"}],
    StringRiffle[Table[StringTake[text,
      {i, Min[i + 999, StringLength[text]]}],
      {i, 1, StringLength[text], 1000}], "\n"], "Text"];
  (* 强制分行的预览只供阅读；反序列化用 WXF。 *)
  {preview, exact, report["Failed"], report["Messages"]}
]
```

确认导出成功后，用 `read` 分段读取换行预览；不以 `Short`／`Shallow` 代替完整导出。WXF 保存完整表达式而非内核状态；重用前恢复对应包、定义与规则。若核查工具的输出截断，在 `xact_run` 中复现同一设定、残差与规范化步骤后导出；不假设核查接口提供文件参数，也不偷偷换管线。只写新建私有产物目录，不覆盖研究原文。
