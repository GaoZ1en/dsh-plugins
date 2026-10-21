# Wolfram

环境：Wolfram Engine 14.3；本机 CLI 为 `/opt/homebrew/bin/wolframscript`。工具 `mcp__mathematica__evaluate_mathematica` 只接收 `code`；每次新内核，定义、假设、精度及待算表达式都放在本次代码中。

传输成功不表示计算成功：结果可以是 `$Failed`、未求值的原式或带消息的部分结果。用 `Block[{$Messages = {}, $MessageList = {}}, result = ...; <|...|>]` 同时返回值与消息名；这是暂存诊断，不是用 `Quiet` 抹去诊断。`$MessageList` 仅记录该作用域内的消息；需要消息正文时保留正常消息输出或单独复现相关操作。

显式给 `Assumptions`、变量域、数值精度及容差；区别条件表达式、一般分支与特殊参数。检查 `$Failed`、`$Aborted`、未求值子式及消息，不仅看外层工具成功状态。Mathematica 与 xAct 都用 Wolfram 内核，不是独立的计算实现。

## 完整输出落盘

以下代码中的关联是自行生成的计算报告，不是工具参数或返回 schema。替换示例计算；同次调用保存完整报告和可读预览，仅返回路径与简短诊断。macOS 的 `mktemp -d` 在 `$DSH_HOME/research-results/kernel-exports` 下创建唯一、权限 0700 的私有目录；未设置 `DSH_HOME` 时用 `~/.dsh`，不依赖系统临时目录的保留期限。

```wolfram
Module[{result, report, tmp, dir, exact, preview, text},
  report = Block[{$Messages = {}, $MessageList = {}},
    result = Expand[(x + y)^20]; (* 替换为实际计算 *)
    <|"Result" -> result,
      "Failed" -> (result === $Failed || result === $Aborted),
      "Messages" -> (ToString[#, InputForm] & /@ $MessageList)|>
  ];
  tmp = Module[{home = Environment["DSH_HOME"], root},
    If[!StringQ[home] || home == "",
      home = FileNameJoin[{$HomeDirectory, ".dsh"}]];
    root = FileNameJoin[{home, "research-results", "kernel-exports"}];
    If[!DirectoryQ[root], CreateDirectory[root, CreateIntermediateDirectories -> True]];
    RunProcess[{"mktemp", "-d", FileNameJoin[{root, "wolfram.XXXXXX"}]}]
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

确认导出结果是路径而非 `$Failed`，再用 `read` 分段读取预览。WXF 保存完整表达式，不保存整个内核；保留本次输入与定义以便复算，不依赖 `%` 或前次调用。预览采用 `InputForm` 与有限页宽，不以 `Short`／`Shallow` 裁掉正文；机器文件保留原精度。路径必须是新建私有产物目录，不得换成现有笔记文件。
