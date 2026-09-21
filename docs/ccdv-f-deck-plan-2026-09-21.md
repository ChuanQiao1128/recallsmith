# Claude Developer Foundations（CCDV-F）卡组规划（2026-09-21）

> 状态：规划，未写卡。来源：官方考试指南 v1.0 + Anthropic Academy 课程大纲 + docs 可测事实清单 + 题型分析（四路搜索汇总，2026-09-21）。
> 同类文档：`docs/aws-saa-c03-card-backlog-2026-09-19.md`（AWS 的写题清单）、`docs/mcq-card-type-plan-2026-09-18.md`（MCQ 卡型）。

**结论 + 蓝图 + 计划：CCDV-F 卡组（DeveloperCards）**

## 1. 结论：混合型 —— AWS 型骨架，C# 型的 `CODE:` 块只用在 API 机制卡上

一句话理由：官方 3 道样题全是"场景 + 取舍"的 4 选 1（官方指南 §8），FAQ 写明题型是 "multiple choice and scenario-based multiple response"，两个开源题库 138 题里场景题占 64% / 84%、纯回忆 ≤ 10%（question-style §3）——这和 AWS 卡组的"concept / feature / pattern + MCQ 带限定词"完全同构；但 D2 API Mechanics 6.8% + D5 Technical Fundamentals 6.1% + SWE Foundations 7.4% ≈ 20% 考的是 API/SDK 的实际行为，社区题干里出现 ~60 处内联标识符（`stop_reason: "refusal"`、`budget_tokens`、`PreToolUse`），这部分卡带一段 JSON/Python `CODE:`（C# 卡组的做法，导入格式本来就允许任何卡带 `CODE:`，`console-import-plan.md` §一）记得更牢。

不选纯 C# 型：C# 卡是"知识 Q/A + 代码"，没有限定词、没有干扰项 WHY，练不到考试真正计分的"四个都像对的里选最佳"。不选纯 AWS 型：AWS 没有代码层，而这门考试有 streaming 事件顺序、`cache_control` 位置、`tool_result` 排序规则这类必须看到形状才记得住的东西。

## 2. 蓝图表

推导规则（对照 `saa-c03-exam-facts-and-deck-size-2026-09-19.md` §4.1 的 R1–R6）：

| 规则 | AWS SAA-C03 | CCDV-F | 依据 |
|---|---|---|---|
| R1 概念卡 | 每条 knowledge bullet 1 张 → 107 | 官方指南 §6 没有 knowledge/skills bullet，只有 24 条 objective 句子；数句子里逗号分隔的**点名项**，每项 1 张 → **130** | 官方指南 §6（各域点名项数见下表） |
| R2 服务卡 → 特性卡 | 每个 in-scope 服务 1 张 → 118 | 没有服务附录；以 docs-surface 枚举的 **78 个 docs 页面**为单位，每页 1 张"是什么 / 何时用 / 何时不用"，再加 3 个只列了 URL 的 Claude Code 页（skills、headless、plugins）→ **81** | docs-surface 页数表 |
| R3 模式卡 | 每个 "(for example…)" 项 1 张 → 97 | 每个蓝图或 docs 里**显式写成 "X vs Y / tradeoffs / when to use"** 的取舍 1 张 → **90**（第 3 节的标题就是从这份清单里挑的） | 官方指南 §6 + docs-surface |
| R4 MCQ | 每条 skills bullet × 2 = 170，即 170/65 = 2.6 张/题 | 没有 skills bullet；沿用 **2.6 张/题**：53 × 2.6 = 138 → 取 140，按域权重分配，D3/D4 地板 5 张（每条 objective ≥ 2 道）→ **142** | 官方指南 §5（53 题）、AWS backlog §0（170） |
| R5 分配 | 概念按 bullet 分布，MCQ 按 30/26/24/20 | 概念/特性/模式按 docs 分布（细节在哪就写到哪），MCQ 按 14.7/33.1/3.1/2.6/16.8/11.0/8.1/10.6 | 官方指南 §6 |
| R6 地板/天花板 | 212–215 / 500–550 | 地板 = 130 概念 + 24 objective × 3 MCQ = **202**（只有覆盖没有深度，不推荐）；天花板 ≈ **505**（docs-surface 每条事实 1 张，再多没人学完） | docs-surface（~505 条事实） |

| 域 | 权重 | ≈题数 | 蓝图点名项 | docs 可测事实 | 概念 | 特性 | 模式 | MCQ | 合计 |
|---|---|---|---|---|---|---|---|---|---|
| D1 Agents & Workflows | 14.7% | 8 | 13 | ~50（8 页） | 13 | 8 | 10 | 21 | **52** |
| D2 Applications & Integration | 33.1% | 18 | 31 | ~135（19 页） | 31 | 18 | 16 | 46 | **111** |
| D3 Claude Code | 3.1% | 2 | 13 | ≈45（借 D2/D1/D7 的 CLAUDE.md、settings、hooks、sub-agents、MCP、security 页，不重复计入 505） | 13 | 3 | 6 | 5 | **27** |
| D4 Eval / Testing / Debugging | 2.6% | 1 | 4 | ≈25（借 errors + stop-reasons 页，同上） | 4 | 1 | 5 | 5 | **15** |
| D5 Model Selection & Optimization | 16.8% | 9 | 20 | ~95（13 页） | 20 | 13 | 13 | 24 | **70** |
| D6 Prompt & Context Engineering | 11.0% | 6 | 16 | ~60（11 页） | 16 | 11 | 12 | 15 | **54** |
| D7 Security & Safety | 8.1% | 4 | 14 | ~40（6 页） | 14 | 6 | 12 | 11 | **43** |
| D8 Tools & MCPs | 10.6% | 6 | 19 | ~125（21 页） | 19 | 21 | 16 | 15 | **71** |
| **合计** | 100% | 53 | **130** | **~505（78 页）** | **130** | **81** | **90** | **142** | **443** |

点名项怎么数（官方指南 §6 原句）：D1 = 4 + 4 + 5；D2 = 2 + 2 + 10（messages, tools, streaming, vision, thinking, caching, third-party vendors, data access patterns, batch, realtime-vs-batch）+ 7 + 5 + 5；D3 = 5 组件 + 5 特性 + 3；D4 = 4；D5 = 10 + 2 + 4 + 4；D6 = 4 + 8 + 4；D7 = 6 + 3 + 1 + 4；D8 = 8 + 7 + 4。≈题数 = 权重 × 53 四舍五入（官方只给百分比）。特性卡 D2 = 19 页 − errors 页（移到 D4）；MCQ = 权重 × 140 四舍五入，D3/D4 抬到 5。

**推荐总数 443（区间 330–500）；Q/A 301 + MCQ 142，MCQ 占 32%（AWS 是 170/492 = 35%）。**

和 AWS 492 张的对照——为什么少 10%：(1) 53 题 vs 65 题（官方指南 §5 / SAA 官方 65）；(2) 没有 118 个 in-scope 服务的附录，特性卡只有 81；(3) D3 + D4 合计 5.7%，你天天用，只给 42 张。为什么没有少更多：docs-surface 是 78 页 / ~505 条事实，比 AWS 的 189 条 bullet 细；蓝图点名项 130 > AWS 的 107 条 knowledge bullet；90% 场景题意味着取舍卡（90）不能省。每题卡数：AWS 7.6、CCDV-F 8.4，量级一致。像 AWS 的 D4 一样，这里 D8 权重 10.6% 却有 21 个 docs 页（server tools 一页一个），是"权重低、条目多"的域；D3 27 张排最后写。

MCQ 内部比例：多选题官方只说"each item states how many responses to select"，比例没公布，两个开源题库 0 道，供应商估 15–25%（question-style §1）——取 20% ≈ 28 张 choose-two（星号数推导，`MCQ_CHOOSE_N_MISMATCH` 校验），其余 4 选 1。难度按 MCQ 方案 §10：d1 单事实、d2 两方案由限定词决定、d3 多约束或 choose-two。概念/特性 d1–d2，模式 d2–d3。

## 3. 每域必出卡片标题（原创；`uid`（类型 · d[· 限定词]）— 要教的）

**D1**
- `ccdvf-workflow-vs-agent-decision`（模式 · d2）— 步骤能预先写成代码就是 workflow；步数由内容决定才用 agent（building-effective-agents）
- `ccdvf-five-workflow-patterns`（概念 · d1）— chaining / routing / parallelization / orchestrator-workers / evaluator-optimizer 各适用什么
- `ccdvf-agent-sdk-vs-client-sdk-vs-managed`（模式 · d2）— Agent SDK 免写循环；Client SDK 自己写循环；Managed Agents 托管沙箱（agent-sdk overview 决策表）
- `ccdvf-subagent-fresh-context`（特性 · d1）— subagent 拿到全新隔离上下文、只回摘要；父上下文因此不涨
- `ccdvf-hooks-deterministic-actions`（概念 · d1）— 必须"每次都发生"的动作放 hook，不放 prompt
- `ccdvf-managed-agents-four-concepts`（特性 · d2）— Agent / Environment / Session / Events；self-hosted vs Anthropic-hosted 沙箱
- `ccdvf-agent-iteration-cap-mcq`（MCQ · d2 · most reliable）— 开放式任务的终止条件：max iterations + 可验证的完成信号，不是"让模型自己决定停"
- `ccdvf-fixed-pipeline-not-agent-mcq`（MCQ · d1 · least complexity）— 每次输入都一样的五步流程，过度工程化选项是陷阱

**D2**
- `ccdvf-batch-vs-realtime-mcq`（MCQ · d1 · least cost）— 非紧急、隔夜、只看成本 → Batches（50% off、24 h 窗口、按 `custom_id` 对结果）
- `ccdvf-streaming-event-order`（特性 · d2 · `CODE: json`）— `message_start → content_block_start/delta/stop → message_delta(usage 累计) → message_stop`，`ping` 随时可出现，HTTP 200 之后仍可能收到 error 事件
- `ccdvf-prompt-cache-prefix-hierarchy`（模式 · d2）— `tools → system → messages`，改上游让下游全失效；断点放最后一个 tool 上
- `ccdvf-messages-api-stateless`（概念 · d1）— 每次都发完整历史；`system` 是顶层参数不是 role
- `ccdvf-tool-result-first-rule`（特性 · d2 · `CODE: json`）— `tool_result` 必须紧跟 assistant 的 tool_use 消息、在 user 消息里排最前，否则 400
- `ccdvf-model-id-pinning-dateless`（概念 · d2）— 4.6+ 无日期 ID 本身就是快照；更新走新 ID；行为变化不会"悄悄"进生产
- `ccdvf-settings-precedence`（特性 · d2）— managed → `--settings` → `.claude/settings.local.json` → `.claude/settings.json` → `~/.claude/settings.json`；allow/deny 列表跨层合并
- `ccdvf-third-party-platform-gaps-mcq`（MCQ · d3 · choose two）— 迁到 Bedrock/Vertex/Foundry 会失去什么（Batches、Files、server tools 等按 docs 逐平台列）

**D3**
- `ccdvf-claude-md-hierarchy`（特性 · d1）— managed / user / project / local 四层；启动时加载 cwd 及全部祖先，子目录按需；`@import` 最多 4 跳
- `ccdvf-rule-skill-command-agent-choice`（模式 · d2）— 常驻约束 = Rule；按需程序 = Skill；用户触发 = Command；需要隔离上下文 = Agent
- `ccdvf-headless-p-output-json`（特性 · d1）— CI 里非交互跑：`-p --output-format json`
- `ccdvf-permission-modes`（概念 · d2）— default / acceptEdits / plan / auto / bypassPermissions 各放行什么
- `ccdvf-compact-vs-clear`（模式 · d1）— 还要延续任务用 `/compact`，换任务用 `/clear`
- `ccdvf-mcp-config-scopes`（特性 · d2）— local（`~/.claude.json`）/ project（`.mcp.json` 提交）/ user；优先级 local > project > user

**D4**
- `ccdvf-http-error-taxonomy`（特性 · d2）— 400/401/402/403/404/409/413/429/500/504/529 各代表什么
- `ccdvf-retriable-vs-terminal`（模式 · d1）— 429/5xx/连接错误退避重试（SDK 默认 2 次、尊重 `retry-after`）；4xx 请求错误不重试
- `ccdvf-stop-reason-playbook`（模式 · d2）— `max_tokens` 提上限或续写；`tool_use` 执行并回传；`refusal` 读 `stop_details`；`pause_turn` 原样重发
- `ccdvf-retrieval-vs-model-fault-mcq`（MCQ · d2 · first）— trace 显示模型忠实总结了错的文档 → 缺陷在检索层
- `ccdvf-schema-valid-but-wrong`（概念 · d2）— 通过 schema 校验 ≠ 语义正确；需要语义 eval

**D5**
- `ccdvf-model-lineup-price-context`（特性 · d1）— Fable 5.1 / Opus 5 / Sonnet 5 / Haiku 4.5 的定位、$/MTok、context window、输出上限（models overview，标注核对日期）
- `ccdvf-effort-levels`（特性 · d2）— low/medium/high/xhigh/max，默认 high；改 effort 使 cache 失效；"调 effort 常比换模型更好"
- `ccdvf-adaptive-vs-manual-thinking`（模式 · d2）— `budget_tokens` 在 4.7+ 返回 400；4.6+ 用 `adaptive` + effort
- `ccdvf-cache-ttl-5m-vs-1h`（模式 · d2）— 5m 写 1.25×、1h 写 2×、读 0.1×；1 次命中 / 2 次命中回本；间隔 5–60 min 的对话选 1h
- `ccdvf-cache-min-prefix-by-model`（概念 · d2）— 512 / 1,024 / 2,048 / 4,096 token 门槛因模型而异，不够长会**静默**不缓存
- `ccdvf-cost-per-completed-task`（模式 · d2）— 比"每任务成本"不比"每 token 价格"；输出 token ≈ 5× 输入
- `ccdvf-fast-mode-scope`（特性 · d2）— 只有 Opus 5 / 4.8，提升 OTPS 不是 TTFT，不能和 Batch 叠加
- `ccdvf-right-size-classifier-mcq`（MCQ · d1 · least cost）— 大模型跑简单分类且 eval 显示小模型同精度 → 降档，先跑 eval 再换

**D6**
- `ccdvf-long-data-top-query-bottom`（模式 · d1）— 20k+ token 长文放上、问题放最后，"up to 30%"
- `ccdvf-compaction-vs-context-editing`（模式 · d2）— compaction = 服务端摘要（默认 150k 触发）；context editing = 清掉旧 tool result（默认 100k、留 3 个）
- `ccdvf-structured-outputs-schema-rules`（特性 · d2 · `CODE: json`）— `output_config.format`；`additionalProperties: false`、全 `required`；不能和 citations 同用
- `ccdvf-tool-output-pruning`（概念 · d1）— 50k JSON 里只用 2 个字段 → 在工具层裁剪，不是加更大 context
- `ccdvf-subagent-context-isolation`（概念 · d1）— 大量读文件的探索交给 subagent，父只收摘要
- `ccdvf-defensive-parsing-retry-mcq`（MCQ · d2 · sturdiest）— 1/50 次坏 JSON：schema 强制 + 校验 + 带错误重试，不是 try/except 吞掉
- `ccdvf-few-shot-3-to-5`（概念 · d1）— 3–5 个多样例子包在 `<example>` 里；例子和指令矛盾时模型跟例子
- `ccdvf-system-vs-user-placement`（模式 · d1）— 稳定的角色/行为在 system；每次变的内容在 user

**D7**
- `ccdvf-direct-vs-indirect-injection`（模式 · d1）— 用户是攻击者 vs 第三方内容是攻击者，两种威胁模型的对策不同
- `ccdvf-untrusted-content-in-tool-result`（模式 · d2）— 不可信内容只放 `tool_result`，永远不进 `system` 或裸 user 文本；标来源、JSON 编码
- `ccdvf-hook-exit-code-2-blocks`（特性 · d2）— exit 0 放行、2 阻断并把 stderr 喂给模型、其它码非阻断；exit 1 的 hook 挡不住 `rm -rf`
- `ccdvf-api-key-vs-wif-vs-app-attest`（模式 · d2）— 静态 key 给脚本/服务器；WIF 给 CI/云工作负载；App Attest 给 iOS/macOS 客户端；key 永不下发到客户端
- `ccdvf-workspace-isolation`（特性 · d1）— key、限额、Files、Batches、cache 按 workspace 隔离；dev/staging/prod 各一个
- `ccdvf-web-fetch-exfiltration`（概念 · d2）— fetch 只能访问已在上下文出现的 URL；敏感数据场景用 `allowed_domains`/`max_uses`
- `ccdvf-least-privilege-tool-scope-mcq`（MCQ · d2 · most secure）— "agent 绝不能触发退款"由工具范围 + hook 保证，不是 system prompt 请求
- `ccdvf-zdr-eligibility`（概念 · d2）— Files、MCP connector、code execution、Skills、Managed Agents 不在 ZDR 内

**D8**
- `ccdvf-tool-description-quality`（概念 · d1）— 描述是"by far the most important factor"：做什么、何时（不）用、每个参数、注意事项，≥ 3–4 句
- `ccdvf-client-vs-server-tools`（模式 · d2）— client tool 你执行并回 `tool_result`；server tool（web search/fetch、code execution…）永远不回 `tool_result`
- `ccdvf-tool-choice-modes`（特性 · d2）— auto / any / tool / none；any + strict 保证结构合法调用；改 tool_choice 使 messages cache 失效
- `ccdvf-builtin-vs-custom-vs-skill-vs-mcp`（模式 · d2）— 内置能做就内置；单应用私有逻辑 = custom tool；可复用程序性知识 = Skill；跨应用/独立维护的外部系统 = MCP
- `ccdvf-mcp-tools-resources-prompts`（概念 · d1）— tools 模型控制、resources 应用控制、prompts 用户控制
- `ccdvf-stdio-vs-streamable-http`（模式 · d2）— 本地进程 stdio、远程多客户端 Streamable HTTP；MCP connector 只连 HTTP、只用 tools
- `ccdvf-tool-search-threshold`（特性 · d2）— ≥ 10 个工具 / 定义 > 10k token 时 `defer_loading`；至少一个工具不能 defer
- `ccdvf-overlapping-tools-mcq`（MCQ · d2 · most direct）— 40 个重叠工具选错 → 先修描述、合并同类，不是换更大模型

## 4. 素材来源与红线

**只允许的出处（ledger `sourceUrl` 白名单）**：`platform.claude.com/docs/en/…`（docs-surface 列出的 60+ 页：Messages API、streaming、prompt-caching、batch-processing、vision、pdf-support、files、token-counting、errors、rate-limits、thinking / extended-thinking / effort / fast-mode、context-windows / compaction / context-editing、structured-outputs、citations、handling-stop-reasons、models/overview、pricing、choosing-a-model、model-ids-and-versions、model-deprecations、optimizing-for-cost-and-intelligence、prompt-engineering/*、mitigate-jailbreaks、reduce-prompt-leak、tool-use/*（overview、define-tools、handle-tool-calls、parallel、strict、server-tools、web-search、web-fetch、code-execution、programmatic-tool-calling、computer-use、text-editor、bash、memory、tool-search、tool-use-with-prompt-caching）、mcp-connector、agent-skills/overview、managed-agents/overview、authentication、workspaces、api-and-data-retention、claude-in-amazon-bedrock / claude-on-vertex-ai / claude-in-microsoft-foundry）；`code.claude.com/docs/en/…`（memory、settings、hooks、sub-agents、mcp、security、permissions、skills、headless、plugins、agent-sdk/{overview,permissions,hooks,sessions,custom-tools}）；`modelcontextprotocol.io/docs/learn/architecture`；`anthropic.com/engineering/{building-effective-agents,effective-context-engineering-for-ai-agents,writing-tools-for-agents}`；官方指南 PDF（everpath-course-content…Exam+Guide.pdf，本地副本 scratchpad `official-ccdvf.pdf`）。
**风格校准用**：官方指南 §8 三道样题；Anthropic Academy 公开课大纲（Building with the Claude API、Claude Platform 101、Intro to MCP、MCP Advanced、Claude Code 101/in Action、Intro to Agent Skills/Subagents、AI Capabilities and Limitations）作主题清单；Partner Academy 5 门 prep 课只有公开的学习目标可用作主题图。

**不能做的**：
1. 不抄、不改写、不翻译 Amey-Thakur（80 题）和 asampath1（58 题）的题干/选项/解释；付费题库（CertSafari 524、Preporato 318、Tutorials Dojo、Udemy）一条不碰。它们只贡献题型频率（question-style §3 的 13 个高频主题）——和 SAA 那份 1019 题 PDF 的处理方式一样（MCQ 方案 §10）。
2. 官方 3 道样题只用来校准题干长度、限定词和干扰项角度，不做成卡、不换皮。
3. 考过之后不能凭记忆写真题（官方指南 §13 NDA）。
4. 不引用 Partner Academy 登录后的课程内容（伙伴专属）。
5. 卡组文案不说 "official / Anthropic-approved"；照 AWS 卡组加非关联声明："Claude and Anthropic are trademarks of Anthropic, PBC. DeveloperCards is not affiliated with, sponsored by, or endorsed by Anthropic."
6. docs-surface 里标 "(summary)" 的数字（150k/50k compaction、100k/keep-3 context editing、24 h grammar cache、600 s hook timeout、25,000 MCP output tokens）没核原页前不能进卡。
7. 数字只在决定取舍时才进 MCQ（50% / 24 h / 1.25×–0.1× / 512–4,096 / 4 breakpoints / exit code 2）；价格、模型名单这种会变的写进特性卡并带 `lastVerifiedAt`，考前重核（Haiku 4.5 退役不早于 2026-10-15，models overview）。

## 5. 工作量、流程、命名

**工作量**（按 AWS backlog §0 的费率：Q/A 30 min、MCQ 35 min）：Q/A 301 × 0.5 h ≈ 151 h；MCQ 142 × 35/60 ≈ 83 h；合计 ≈ **233 h**，再加 ~150 张带数字的卡各 10 min 核对 ≈ 25 h → **≈ 260 h**。按你的 3 周复习计划切批（写卡就是复习）：

| 批次 | 域 | 张数 | 小时 | 对应复习周 |
|---|---|---|---|---|
| B1 黄金 5 张 Q/A（含 2 张带 `CODE:`）跑通新卡组的导入→发布→手机 | D2/D5 | 5 | 3 | 现在 |
| P0 | D2 + D5（50% 权重） | 181 | ≈ 96 | 第 1 周 |
| P1 | D6 + D8 | 125 | ≈ 65 | 第 2 周 |
| P2 | D1 + D7 | 95 | ≈ 50 | 第 3 周 |
| P3 | D3 + D4 | 42 | ≈ 22 | 考前，可砍 |
| 黄金 5 张 MCQ（4 域各 1 + 1 choose-two） | — | 5 | 3 | MCQ 导入器（1.6 wave C11）落地后 |

时间不够时的地板：130 概念 + 72 MCQ ≈ 202 张 ≈ 107 h。

**流程**（沿用 AWS 的四步）：
1. **写清单再写卡**：先出 `docs/ccdv-f-card-backlog-<date>.csv`（uid、type、P、d、domain、objective、要教的、qualifier、distractor_angles、source_url），和 AWS 的 492 行表同列；MCQ 每个错误选项的 WHY 点名 8 个干扰项角度之一（prompt 请求代替强制 / 真技术错变量 / 粗暴换模型 / 过度工程 / 治标 / 吞错 / 机制对范围错 / 反向操作，question-style §4）。
2. **事实核对**：每张卡的每个数字回到 `source_url` 原页核一次（不是核 docs-surface 摘要）；ledger 记 `lastVerifiedAt`；docs 快照日期写进卡组描述。
3. **导入器校验**：Q/A 卡今天就能进（`deckImport.ts`：uid 全文件唯一、Q/A 非空、d 范围）；MCQ 卡等 C11（`OPT:`/`WHY:`/`QUALIFIER:` + 全部 `MCQ_*` 阻断码，MCQ 方案 §4.5）；导入前跑仓库外的 8 词 shingle 比对，对象换成 Amey-Thakur + asampath1 的全文（MCQ 方案 §10 的独立性守卫）。
4. **导入**：控制台新建卡组 → 预览全绿 → 导入 → 发布 → 手动 rebuild manifest → 手机从 Home 装（Library 对未安装卡组会抛错，demo plan §验证）；MCQ 内容追加在文件末尾，走 1.6.1 OTA 的采用门（release-1.6.0 M8）。

**依赖顺序的现实**：MCQ 手机端在 1.6.1 OTA 列车（≈ 第 66 天，release-1.6.0-plan M8），所以这门卡组先以 301 张 Q/A 上线（老客户端也能学），142 张 MCQ 按文件末尾追加、随 AWS 的 MCQ 一起放量。

**命名**：slug `claude-ccdv-f`（和 `aws-saa-c03` 同构：厂商-考试代码；官方代码是 CCDV-F，不用第三方写的 CCD-F）；标题 "Claude Developer Foundations (CCDV-F)"；uid 前缀 `ccdvf-`，MCQ 为 `ccdvf-<topic>-mcq-NN`；描述 "Scenario cards for the Claude Certified Developer – Foundations exam (guide v1.0, July 2026; docs verified 2026-09-21). Not official Anthropic material, not an exam simulator." 封面：`packArt.ts` 只把含 `aws` 的 slug 映射到 cloud 封面，新 slug 会落到程序化卡背，需要一张和 C#/AWS 同规格（1024×1536）的封面。

一句话回答你的三个问题：**混合型（AWS 骨架 + C# 的 CODE: 块）；约 440 张（301 Q/A + 142 MCQ，地板 202、天花板 505）；≈ 260 小时，按 D2+D5 → D6+D8 → D1+D7 → D3+D4 的顺序写，写卡就是复习。**