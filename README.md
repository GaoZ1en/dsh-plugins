# koishi 的 DSH 插件

给同学和师弟分享的三个自用插件，目标版本为 **DeepSeek Harness 0.2.1-rc.2**。不是 DeepSeek 官方插件，未发布 npm，也不承诺兼容其他版本。

> **使用前请先调整喵。** 这些插件保留了 koishi 的个人偏好和本机环境假设，没有做通用化。实际使用时，请先在 DSH 的**创造模式**下，根据自己的需求和环境检查、调整插件，再安装或启用；不要把创造模式理解为权限或沙箱设置。尤其要检查研究预设中的私人笔记绝对路径、数学 MCP 工具名称、Sage / Wolfram / TeX / Poppler 路径与环境说明：它们不是你电脑上的事实。

| 插件 | 版本 | 内容 |
|---|---|---|
| [配色与消息样式](<chatgpt-desktop-ui/README.md>) | 0.2.3 | 蓝紫配色、用户气泡、复制与时间戳、展开思考细线 |
| [研究预设](<koishi-research-preset/README.md>) | 0.1.1 | 数学与理论物理研究指令、精选技能、计算证据存档、研究摘要及子代理 |
| [Skills & MCP 管理器](<skills-mcp-manager/README.md>) | 0.2.1-koishi.3 | 技能浏览与 DSH-only 启停、导入与回收、原生及受管 MCP 管理 |

## 安装与调整

```sh
git clone https://github.com/GaoZ1en/dsh-plugins.git
cd dsh-plugins
```

这个仓库不是一个整体 bundle，也不是 pnpm workspace。请先阅读对应插件说明，在创造模式下完成个人调整，然后通过 DSH 官方插件管理器**分别安装所需插件的子目录**。包名保留 `@koishi`；`private: true` 只表示不发布 npm，不禁止源码分享或本地安装。

可以向创造模式提供这样的任务：

> 请先只读检查我要安装的插件。根据我的研究需求、笔记位置、数学 MCP 与本机工具环境列出需要调整的地方，确认后再修改并测试，最后通过官方插件管理器安装。不要修改 DSH 应用包，也不要直接改写 profile 清单。

研究预设首先检查 [persona](<koishi-research-preset/persona.md>)、[技能目录说明](<koishi-research-preset/README.md#使用>)及 [bundle 配置](<koishi-research-preset/cordis.patch.yml>)。它不附送私人笔记、数学 MCP 服务端或计算内核；Wolfram 等外部软件的安装和许可由使用者自行处理。

研究结果会保存在 `$DSH_HOME/research-results`，未设置 `DSH_HOME` 时为 `~/.dsh/research-results`；其中包含数学工具的输入、原始输出和元数据，**默认不自动清理**。请按未发表研究资料管理，不要把结果目录提交到公开仓库。管理器的技能回收、持久状态与 MCP profile 级启停范围见其 [说明](<skills-mcp-manager/README.md#状态与权限>)。

## 开发与验证

建议使用 Node 24 和 pnpm。仓库保留源码和客户端构建产物；调整源码后请重建，再按官方插件管理流程应用。重建成功不代表已热更新；可能需要刷新现有页面或重启 DSH。

```sh
# 配色与消息样式
cd chatgpt-desktop-ui
node scripts/build.mjs
node --check lib/client.js
node --test test/*.test.mjs

# 研究预设
cd ../koishi-research-preset
node --test tests/*.test.js

# Skills & MCP 管理器
cd ../skills-mcp-manager
pnpm install --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org/
pnpm run typecheck
pnpm test
pnpm run build
```

发布检查与实机验证的边界见 [验证摘要](<VERIFICATION.md>)。这些是自用试用插件：界面视觉与点击尚未完成全面验收；研究预设没有实测自动压力压缩和真实提供商上下文溢出。Next Prompt 不在本次分享范围。

## 许可与上游

koishi 原创代码、文档和原创图标采用 [MIT](<LICENSE>)。管理器改编自 **zebbkira/dsh-skills-mcp-manager**，保留上游 MIT 声明；来源、固定提交与署名事实见 [上游记录](<skills-mcp-manager/UPSTREAM.md>)，许可条款见 [管理器许可证](<skills-mcp-manager/LICENSE>)。本仓库的许可证不取代上游或外部依赖的条款。

本仓库不包含依赖缓存、DSH profile、凭据、原始会话、私人验收产物或私人笔记正文。
