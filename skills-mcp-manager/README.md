# Skills & MCP Manager — koishi fork

基于 [zebbkira/dsh-skills-mcp-manager](https://github.com/zebbkira/dsh-skills-mcp-manager) 的 koishi 维护分支，目标 **DeepSeek Harness 0.2.1-rc.2**。不是 DeepSeek 官方插件，未发布 npm。上游基线、MIT 许可声明和署名事实见 [UPSTREAM.md](<UPSTREAM.md>)。

> 这是 koishi 的自用设定，未做通用化。实际使用前，请在 DSH **创造模式**下按自己的需求检查、调整并测试，再通过官方插件管理器安装；尤其确认技能目录边界和 MCP 启停对整个 profile 的影响。创造模式不等于权限或沙箱模式。完整说明见[仓库首页](<../README.md>)。

在 DSH 的 **设置 → 技能与 MCP** 中统一管理，不另起 Web 应用。

## 首版行为

### Skills

- 浏览用户级 `.dsh/skills`、`.agents/skills`，以及显式选择的已注册工作区的对应目录；空选择只显示用户级。只发现直接目录包与平铺 Markdown，不递归搜整盘，也不展示内置/运行时技能。
- 查看正文、搜索、筛选、显式扫描目录后选中导入。目的地固定为用户 DSH skills；同名内容不覆盖。列表读取不会创建目录。
- **启停只改变 DSH 的可见性，不修改源文件、invocation 前言或链接。** 全局视图设置当前 profile 的默认值；选定工作区后的开关仅覆盖该工作区，与技能文件来源无关。链接项也能切换。停用按技能名称生效，同名副本不能绕过；重新启用只解除管理器的限制，不强制开放源文件本身禁止的调用方式。
- 停用项不进入后续生成的模型技能目录，官方 `skill` 加载入口和 `/name` 注入也被拒绝；管理器 UI 仍可预览正文，Agent 管理工具则按真实工作区与请求范围双重检查，不能省略 `cwd` 绕过。**已进入对话历史的目录、正文和工具结果不会被抹除**；完整清空旧内容需新会话或压缩。这不是文件访问安全沙箱。
- 当前 live Agents 与后续新建、恢复、clear/compact 的 Agents 都安装近作用域过滤；不主动唤醒闲置 Agent。冷会话的独立用户技能选择器仍可能显示条目，激活后的首个模型步骤才执行过滤；已在途的加载不保证中途撤回。
- 删除实际移入私有回收区，可恢复且不会覆盖现存同名内容；没有永久删除入口。显式链接进技能目录的技能正常展示，即使目标在其他目录；链接项的源文件只读，但 DSH 启停开关独立可用；不增加链接来源徽标，也不递归遍历目标资源。开关不会扩大修改或导入链接目标的权限。
- 工作区目录本身是授权边界，不向其父目录寻找 Git 根；不会扫描未注册的项目路径。

### MCP

- 当前 profile 已配置且可管理的原生 `dsh-mcp-client` 条目也支持启停，通过官方 Plugin Manager 的生命周期保存当前 DSH profile 的启停状态。停用真正卸载连接、工具和服务器说明；重新启用按原配置连接。原生条目的配置编辑、凭证和删除仍只读，不复制到管理器的受管连接文档，不修改其他应用的配置。需要重启或只保存未应用时显示明确错误，不伪报已生效。MCP 开关影响该 profile 的所有会话。
- 新增受管连接支持 stdio / Streamable HTTP；新增默认禁用，显式启用或测试会真实运行命令/连接端点。编辑、启停、删除、真实连接测试使用官方 `dsh-mcp-client`。
- `envRefs` 将子进程变量名映射到现有 DSH 凭证/环境变量引用名；`headerRefs` 将 HTTP header 名映射到引用。header 引用的内容是**完整 header 值**，例如 Authorization 所引用的值需自行包含 `Bearer `。管理器不提供秘密录入表单，也不把解析后的秘密放进自己的 JSON、列表或工具结果。
- 引用在连接/测试时解析。凭证变更后需重新启停或保存连接才能更新该连接；不声称底层凭证服务一定加密，也不声称能清洗用户主动放进 URL 查询或命令参数的秘密。请不要在那里放秘密。
- 「已加载」只表示 SDK 已完成初始加载，不是持续健康证明；工具数是注册数量。SDK 自带断线重连；本插件不伪造健康探针。
- 测试使用独立的临时 scope，即使同名连接已加载也重新握手；测试结束会清理。连接替换等待旧实例卸载；不合作的清理超时会拒绝替换。
- 首版不支持 OAuth、旧式 SSE、MCP prompts 或市场；resources 仍按官方客户端能力工作。

## 状态与权限

默认状态目录：`$DSH_PROFILE_DIR/data/koishi-skills-mcp-manager/`。MCP 文档为其中 `mcp.json`，DSH-only 技能规则为 `skill-policy.json`，源文件回收区在 `skills/`。策略文档带 revision 与独立写锁，原子保存成功后才发布内存并失效运行时缓存；显式刷新可重新读取其他进程写入的有效规则，不进行源树轮询。损坏或已经加载过的文档消失时保留 last-good 过滤并报错，不静默解禁。文件按 0600、私有状态目录按 0700 创建/维护。

上游 `~/.dsh/mcp.json` 只检测是否存在，**不自动读取、启用或迁移**；请按需人工重建引用式配置。自己的状态带 schema/revision，损坏时拒绝写入，不默默当作空配置。管理接口仅允许 DSH 认证后的本地访问，路径/对象 ID、版本和写入目标均在 Host 校验。

Agent 使用 `skills_mcp_manager`，与 UI 共享同一 Host 实现。变更与连接测试会请求会话审批；策略为 `never` 时拒绝，不能用工具代替用户批准。目录列表不请求变更审批；Agent 正文读取仍受实际工作区的停用规则限制，UI 预览不改变调用权限。管理器不向所有会话注入长篇系统公告。

## 开发

本仓库独立于笔记库与 DSH 安装目录。包名为 `@koishi/dsh-skills-mcp-manager`，行/槽位 ID 为 `koishi-skills-mcp-manager`，API 为 `POST /api/koishi-skills-mcp/action`。

使用 DSH 提供的 Node / pnpm，或满足 engines 的 Node（开发验证使用 Node 24.21）：

```sh
pnpm install --ignore-scripts --registry=https://registry.npmjs.org/
pnpm run typecheck
pnpm test
pnpm run build
```

开发依赖安装不运行安装脚本。SDK peers 固定当前版本；旧 `dsh-client-runtime` 已退休，不再依赖。Host 构建外置 SDK 包，Client 外置宿主 React；CSS 在 Client apply 时注册，并在卸载时移除。不要直接 require 宿主 UI primitive 包。

通过官方 `plugin_manager install_bundle` 安装本目录到目标 profile，不手工编辑 profile 包清单或补丁。安装会影响该 profile 的所有会话。以返回的 `application` 判断是否已生效；后续替换已安装代码可能需要重启 DSH 并刷新已有页面，不能仅凭重建成功声称热更新完成。不要启动另一个服务器替代当前 GUI。

## 测试与限制

测试只用临时文件/目录和一次性 stdio MCP，覆盖源文不变、DSH-only 策略持久化与作用域覆盖、真实 SDK 模型目录/加载/用户注入排除、当前与后续 Agent 生命周期、热缓存失效、原生 MCP 的真实工具/服务器说明卸载恢复，以及原有路径/链接、导入、回收、认证与凭证回归。不会切换或删除真实技能，也不在测试中停用原有五个 MCP 内核。

保守限制：跨文件系统的回收移动安全拒绝；崩溃留下的锁需人工检查，不能自动删除；失败导入可能保留隐藏 staging 便于恢复；备份/回收区不自动清理。Node 路径检查不是内核沙箱，不能宣称抵御同 UID 非合作进程在系统调用间恶意换目录。支持范围只针对当前固定 DSH，其他版本需重新测试。

运行时安装与可视验证记录见 [VERIFICATION.md](VERIFICATION.md)。
