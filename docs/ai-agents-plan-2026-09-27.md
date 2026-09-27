# DeveloperCards AI agent 规划：出题 agent + 错题讲解助手（2026-09-27）

> 目的：给 DeveloperCards 加两个真正上线的 AI agent 功能，用来申请 AI / automation 岗位。本文只是规划，不改代码。
> 时间：1.7.0（Wave I）提审之后开始，作为 1.8.0 主线。手机端部分是纯 TS，可以用 OTA 发到 runtime 1.7.0，不必重新提审。

---

## §0 结论速览

- **做两个 agent，一个面向作者，一个面向学习者**。两者共用同一个 AI 平台层：模型网关、检索、评估、成本和监控。
  - **出题 agent（后台，自动化）**：资料进来，经过起草、核查、质检三步，进入人工审核队列，采纳后走现有的发布流水线。这证明你能把一段人工流程做成可控的自动化：有状态机、有人工确认、有审计、能回滚、能量化节省了多少时间。
  - **错题讲解助手（面向用户）**：答错选择题后，只根据这张卡的解析和出处原文解释为什么错，再推荐 3 张相关的错题复习。这证明你懂面向用户的 AI 该怎么做：引用原文、限定范围、控成本、防注入、保护隐私。
- **架构上和现有系统无缝衔接**：
  - 模型用 **Amazon Bedrock 上的 Claude**，通过 VPC 接口端点调用。IAM 鉴权、没有 API key、流量不出 AWS。
  - 多步流程用 **Step Functions** 编排，人工审核用 callback 等待。
  - 向量检索用 **RDS PostgreSQL 17 + pgvector**。
  - 异步任务沿用已有的 SQS、DLQ 和幂等设计。
- **评估不需要用户量**：
  - 质检 agent 用埋雷测试：从现有 893 张卡里复制一批并故意注入错误，测它能抓出几成。
  - 出题准确率由人工对照出处抽检。
  - 讲解忠实度用 LLM 当评委，再加人工抽检。
  - 效率指标是出一张卡的耗时，手工对比 agent。
- **工作量**：平台层约 4 天，出题 agent MVP 约 1.5 周，讲解助手 MVP 约 1 周，评估、看板和演示视频约 4 天。合计约 4 周。
- **按市场补缺（§10，SEEK 上 13 个新西兰 AI/automation 岗位，含 Ray White）**：除了两个 agent，再加 5 个便宜、真实的功能：
  - 出站 webhook 加两个 n8n 配方（集成）。
  - 控制台"自动化账本"页，量化省时和拦错（度量）。
  - Python 写的评估 harness 和 PDF 导入 Lambda（Python、文档 AI）。
  - DeveloperCards MCP server（MCP）。
  - 给非技术作者的操作指南和 3 分钟视频（培训）。
  Ray White 最看重其中的度量、集成、流程改造案例和培训材料。
- **月成本**：基础设施约 $8（Bedrock 端点）。模型按用量计费：出 400 张卡约 $10–20；讲解有缓存后每次不到 $0.002。另设预算告警和一键关停开关。

---

## §1 招聘方想看到什么，这两个模块怎么对上

| 招聘常见要求（AI / automation） | 在本项目里的证据 | 落在哪 |
|---|---|---|
| LLM 应用落地，不是只写 demo | 两个功能在已上架 app 和线上控制台里真实运行 | 模块 A、B |
| Agent：工具调用、多步推理 | 出题 agent 自己调用工具：查资料段落、查已有卡、查重、自动校验、存草稿 | §3.3 |
| RAG / 向量检索 | pgvector 存资料切片和卡片向量；生成和讲解都必须引用检索到的原文 | §2.3、§3.4、§4.3 |
| 评估（evals）和质量度量 | 埋雷测试的精确率/召回率、人工抽检准确率、讲解忠实度、拒答测试 | §5 |
| Guardrails 和安全 | 必须标出处、核查 agent 做蕴含检查、MCQ 规则校验、防 prompt 注入、只在范围内回答 | §3.5、§4.5 |
| Human-in-the-loop | 审核队列一键采纳/修改/拒绝；Step Functions 等待人工 callback | §3.6 |
| 自动化和编排 | Step Functions 状态机、SQS、幂等、DLQ、失败重试 | §2.2 |
| 成本和延迟控制 | 模型分级、prompt caching、结果缓存、每人每日额度、预算告警 | §4.4、§6 |
| 可观测性 | 每次调用记录 token、成本、延迟和模型版本；CloudWatch 看板 | §2.5 |
| 隐私和合规 | 不把个人信息发给模型；日志保留期；App Store 隐私标签 | §4.6 |
| 业务结果 | 每张卡耗时从 X 分钟降到 Y 分钟、采纳率、错误拦截率 | §5、§7 |

---

## §2 共用 AI 平台层

### 2.1 为什么选 Bedrock
- core-vpc 和 worker-lambda 都在 VPC 里，没有外网。现有端点只有 S3 gateway 和 SQS interface。
- **方案 1（推荐）：Bedrock + `bedrock-runtime` VPC 接口端点**
  - 单 AZ 约 $7–8/月。
  - Lambda 执行角色只授权调用指定模型（`bedrock:InvokeModel`，Resource 精确到模型或推理配置 ARN），和现有的最小权限设计一致。
  - 没有密钥需要轮换。
  - 简历上可以写 "private networking to Bedrock"。
- **方案 2（备选）**：在 VPC 外新建一个 `ai-runner` Lambda 调 Anthropic API，密钥放 SSM SecureString；结果经 SQS/S3 回到 VPC 内的 worker 写库。
  - 省掉端点费用，但多一跳，还多一个密钥。
  - 如果需要的 Claude 模型在 Bedrock（含跨区推理配置）上不可用，就用这个方案。
- **已核实（2026-09-27，ap-southeast-2，只读查询）**：
  - Bedrock 上有 Claude Opus 5.5、Opus 5、Sonnet 5、Haiku 4.5，都通过推理配置调用。
  - 其中有 `au.` 前缀的澳洲推理配置（例如 `au.anthropic.claude-opus-5-5`），数据不出澳洲，对新西兰用户的隐私说明更好写。
  - 向量模型有 `amazon.titan-embed-text-v2:0`。
- **Bedrock 上能用和不能用的功能**：
  - 能用：工具调用、structured outputs（`strict: true`）、adaptive thinking 和 effort、prompt caching、**Citations**。
  - 不能用：Message Batches、Files API、MCP connector、Managed Agents、服务端 fallbacks。
  - 由此得出：
    - agent 循环在我们自己的 Lambda 里跑，用官方 SDK 的 tool runner（C# 是 `BetaToolRunner`，client 用 `AnthropicBedrockMantleClient`）。
    - 批量出题用 Step Functions 的 Map 并发，不用 Batches。
    - 拒答回退用 SDK 的客户端 fallback 中间件。
    - PDF 以 base64 的 document 块直接传入。
- **Citations 怎么用**：把资料切片作为 `document` 块传入并开启 `citations`，模型回答时会带上原文片段和字符位置。
  - 适用于讲解助手（"只根据原文回答"可以逐句核对），也适用于核查步骤。
  - Citations 和 structured outputs 不能同时用，所以**起草**用 strict 工具输出卡片 JSON，**核查和讲解**用 Citations。
- **模型选择**（配置化，按任务可换）：
  - 默认全部用 **Claude Opus 5**（`anthropic.claude-opus-5`，通过推理配置调用）。起草和核查用 adaptive thinking、effort `high`；讲解用 effort `low`。
  - 要不要换成更便宜的型号，是**你的决定**：
    - 讲解助手可以在评测集上比较"Opus 5 + low effort"和 Haiku 4.5，看质量、延迟、成本。
    - Opus 5.5 更便宜（一方价 $4/$20 每百万 token，对比 Opus 5 的 $5/$25），而且有 `au.` 配置，但你没点名之前不默认用它。
  - 先量"最强模型 + 低 effort"，往往就够好，也省去维护多模型级联和多套缓存。
- **向量**：Titan Text Embeddings V2，1024 维。
- **价格**：Bedrock 由 AWS 定价，和 Anthropic 一方价不同，以 AWS Bedrock 价目页为准。

### 2.2 编排
- **出题流水线用 Step Functions 标准工作流**：
  - 每一步是一个 Lambda（在 VPC 内），带重试和超时。
  - 人工审核步骤用 `.waitForTaskToken`：流水线停在"待审核"，作者在控制台点"采纳"后回调继续。
  - 执行历史就是审计轨迹，不用自己写。
- **短任务仍走 SQS + worker**，例如单张卡重新生成、单次查重。
- **幂等**：
  - 每个任务的键是 `sha256(资料内容 + 考点 + prompt 版本 + 模型)`，同一份资料不会重复出题。
  - 失败进 DLQ，沿用 E03 的做法。

### 2.3 数据模型（新 migration，编号接在 025 后面）
| 表 | 作用 |
|---|---|
| `ai_sources` | 作者上传的资料：URL、PDF 存 S3 的位置、标题、所属卡组、哈希 |
| `ai_source_chunks` | 资料切片：文本、位置（页码或段落）、`embedding vector(1024)`，HNSW 索引 |
| `card_embeddings` | 已有卡片（题干 + 答案）的向量，用于查重和"相关错题" |
| `ai_jobs` | 一次出题任务：卡组、考点范围、状态、Step Functions 执行 ARN、token 和成本汇总 |
| `ai_drafts` | 草稿卡：`card_json`（与 FORMAT.md 同结构）、`citations`、核查结论、质检结论、状态、模型、prompt 版本、token、成本 |
| `ai_review_events` | 审核记录：谁在什么时候采纳、修改还是拒绝，修改前后差异（复用 F09 的 admin_audit 思路，只追加） |
| `ai_explanations` | 讲解缓存：`(card_id, chosen_option, prompt_version)` → 讲解文本和引用 |
| `ai_usage` | 每人每日调用计数，user_sub 加盐哈希，只存计数 |

### 2.4 模型网关（一个共享模块，.NET）
- 统一入口 `LlmGateway.InvokeAsync(task, messages, tools, schema)`，负责：
  - 按任务类型选模型。
  - 超时、重试、指数退避；限流时降级到小模型。
  - **结构化输出校验**：用 JSON Schema 校验模型返回，不合格就带着错误让模型重试一次，再不合格就标失败。
  - 记录 token、成本和延迟，通过 EMF 发成 CloudWatch 指标（沿用 E04 的 `DeveloperCards` 命名空间）。
  - prompt 集中管理，带版本号；每条草稿和讲解都记下 prompt 版本，方便回溯和 A/B。
  - **prompt caching**：同一份资料的切片和系统提示在多次调用间复用，降成本。
- 远程配置开关（沿用 app 的 remote config）：`ai.authoring.enabled`、`ai.explain.enabled`、`ai.explain.dailyQuota`，出问题时一键关停。

### 2.5 可观测性
- CloudWatch 看板 `developercards-ai`：
  - 调用次数、错误率。
  - p50/p95 延迟。
  - 每日 token 和成本。
  - 讲解缓存命中率。
  - 草稿采纳率和质检拦截数。
- 告警：
  - Bedrock 成本超预算（AWS Budgets，按服务过滤）。
  - 调用错误率高于 5%。
  - 讲解 p95 超过 8 秒。

---

## §3 模块 A：出题 agent（作者用）

### 3.1 目标
把你已经手工验证过的出题流程产品化：AWS 那次出了 139 张，Claude 那次 441 张。作者给资料，agent 出带出处的卡片和选择题，自动核查和质检，作者只负责最后审核。

### 3.2 输入和输出
- **输入**：
  - 考试大纲，也就是 TOPIC 列表。现有卡组的 TOPIC 值在 `content/decks/FORMAT.md` §5。
  - 资料来源：官方文档 URL、PDF，或直接粘贴文本。
  - 参数：目标张数、MCQ 比例、难度分布。
- **输出**：草稿卡进入审核队列。结构与 `content/decks/FORMAT.md` 一致（Q、A、TOPIC、QUALIFIER、OPT、WHY），**新增 `SOURCE:` 字段**，记录出处 URL 和原文片段。
  - 这个字段要先加进 FORMAT.md、导入器和发布导出。旧卡没有这个字段也照常可用。

### 3.3 流水线（Step Functions）
```
上传资料 → ①切片+向量化 → ②拆考点（对照大纲）→ ③按考点起草（agent，带工具）
        → ④核查（逐条对照出处原文）→ ⑤质检（规则+LLM 评委）→ ⑥查重
        → ⑦待人工审核（waitForTaskToken）→ ⑧采纳后写入 cards → 现有发布流水线
```
- **③ 起草 agent 的工具**（工具调用由 agent 自己决定调用哪个、调用几次）：
  - `search_source(query, k)`：在本资料切片里做向量检索，返回原文和位置。
  - `get_topic(topic)`：取考点说明，以及这个考点已有卡片的摘要，避免重复出。
  - `find_similar_cards(text)`：跨卡组查重，返回相似度和卡片 id。
  - `lint_card(card)`：复用导入器已有的校验规则，例如 MCQ 恰好一个正确答案、QUALIFIER 必须原样出现在题干、每个错误选项都要有 WHY、不能引用选项字母。
  - `save_draft(card, citations)`：只有带出处的卡才允许保存。
- **④ 核查**：
  - 另起一次调用，用更强的模型，只给卡片和它引用的原文。
  - 逐句判断"原文是否支持这句话"：支持、部分支持或不支持。不支持的句子会被标红，并附上原因。
- **⑤ 质检**：
  - **规则部分**：导入器现有的校验全部复用。
  - **评委部分**：检查题干是否有歧义、是否有两个选项都对、答案是否在题干里泄露、干扰项是否太离谱、事实是否可能过时，并输出严重度。
  - 严重问题直接挡在审核队列外；其余问题附在草稿上给作者看。
- **⑥ 查重**：和现有卡片的余弦相似度超过阈值（例如 0.9）就标记为"疑似重复"，附上最相近的卡。
- **覆盖报告**：按考点统计已有卡、本次新卡和仍然缺卡的考点，直接回答"还缺什么"。

### 3.4 检索（RAG）细节
- 切片大小约 500–800 token，重叠 15%，记下页码和标题路径，方便引用。
- 检索先按考点关键词过滤，再做向量相似度排序，取前 k 条。
- 每条引用只存片段的偏移位置，不存整段原文，审核页面按位置高亮显示。

### 3.5 Guardrails
- 没有出处的卡不能保存，核查"不支持"的句子不能直接采纳。
- 资料里的文字视为数据，不当作指令：系统提示明确声明，资料中的"忽略以上指令"一类内容一律不执行。
- 单个任务设 token 上限和成本上限，超了就暂停，提醒作者。
- 所有模型输出都经过 JSON Schema 校验，不合格不入库。

### 3.6 控制台（人工审核）
- **资料页**：上传或粘贴资料，查看切片和向量化进度。
- **任务页**：发起出题任务，显示流水线进度、已用 token 和成本。
- **审核队列**：
  - 左边是卡片，右边是高亮的出处原文，下面是核查和质检结论。
  - 按钮有"采纳"、"改后采纳"、"拒绝（选原因）"、"重新生成"。
  - 支持批量采纳全部通过的卡。
  - 每个动作写入 `ai_review_events`。
- **指标页**：采纳率、平均审核时长、拒绝原因分布、每张卡成本。

### 3.7 验收标准（MVP）
- 给一份官方文档（例如一篇 AWS 白皮书），端到端产出至少 30 张带出处的草稿。
- 规则校验 100% 通过。
- 人工抽检 30 张：事实准确率 ≥ 90%，出处可核对率 100%。
- 埋雷测试（§5.1）：质检 agent 对严重问题的召回率 ≥ 80%，精确率 ≥ 70%。
- 同一份资料重复提交不会重复出题（幂等）。
- 一张卡从发起到可审核平均少于 60 秒。

---

## §4 模块 B：错题讲解助手（学习者用）

### 4.1 目标
学生答错选择题后，点"为什么错了？"，得到一段针对他所选选项的讲解，附原文出处，再推荐 3 张相关的卡去复习。

### 4.2 交互
- **入口**：选择题判定为错之后，在判定条下方出现按钮；翻面卡点"没看懂"也可以进入。
- **讲解内容**：底部弹出面板，150 字以内，分三部分：
  1. 你选的选项为什么不对，基于这个选项的 WHY。
  2. 正确答案的关键点，基于 A 和 SOURCE 原文。
  3. 一个记忆提示。
  下面列出出处链接，点开能看到原文片段。
- **追问**：最多 2 轮。超出这张卡范围的问题会礼貌拒答，并引导回卡片。
- **相关复习**：从这个用户最近 30 天答错的卡里，按向量相似度挑 3 张，一键加入今天的复习。
- **离线或关闭时**：显示卡片自带的 WHY，功能照常可用。

### 4.3 检索和上下文
- 上下文只有这几样：
  - 这张卡的题干、正确答案、所选选项及其 WHY。
  - 卡片 SOURCE 指向的原文片段（从 `ai_source_chunks` 取）。
  - 同考点 1–2 条相关原文。
- 卡片内容以服务端存的版本为准，客户端只传 `cardId` 和所选选项，不传卡片原文，防止篡改。

### 4.4 成本和额度
- **结果缓存**：`(card_id, chosen_option, prompt_version)` 相同的讲解，所有用户共用。一张卡最多 3 个错误选项，所以缓存命中率会很高，大多数请求不调模型。
- 模型见 §2.1（默认 Opus 5 + low effort，是否换小模型由你按评测结果决定）；限制最多 400 输出 token，超时 10 秒；用 Citations 返回原文出处。
- **每人每日额度**：例如免费 10 次，订阅用户 50 次。这也是一个付费点。
- 追问不走缓存，但会计入额度。

### 4.5 安全
- 用户输入（追问）视为不可信：系统提示限定"只根据给定卡片和原文回答"；检测到越狱或无关请求就返回固定拒答。
- 输出后检查：讲解中的每一个事实性短句都必须能在上下文中找到依据（轻量评委，或关键词覆盖检查）；不通过就退回显示静态 WHY。
- 内容标注"AI 生成"。

### 4.6 隐私
- 发给模型的内容里不含邮箱、用户名这类个人信息，只有卡片内容和用户的追问文字。
- `ai_usage` 只存加盐哈希后的 user_sub 和计数。追问文本默认不落库；如果为了质量改进要存，需要用户同意，保留 30 天。
- 更新 App Store 隐私标签和隐私政策页（落在 E09 建的官网上），说明 AI 功能怎么处理数据。

### 4.7 发布
- **服务端**：新增 `POST /api/v1/user/explain`（走 E08 的 mobile authorizer，只有登录用户能用；未登录时显示静态 WHY）。
- **手机端**：纯 TS，用 OTA 发到 runtime 1.7.0。
- 通过远程配置灰度：先对自己的账号开放，再对所有人开放。

### 4.8 验收标准（MVP）
- 离线评测集是 100 个（卡片，错误选项）组合：
  - 忠实度 ≥ 95%：LLM 评委判断没有超出上下文的事实，人工抽 20 条复核。
  - 越狱和跑题测试集 30 条：拒答率 100%。
- 线上指标：
  - p95 延迟 ≤ 5 秒（命中缓存时 ≤ 300 毫秒）。
  - 单次平均成本 ≤ $0.002。
  - 点赞率 ≥ 70%（每条讲解下面有赞和踩）。

---

## §5 评估体系（不依赖用户量）

### 5.1 质检 agent 埋雷测试
- 从现有 893 张卡里抽 100 张复制出来，按固定比例注入 6 类缺陷：
  - 答案错误
  - 两个正确选项
  - 答案在题干里泄露
  - 歧义题干
  - 过时事实
  - QUALIFIER 不匹配
- 另外 100 张不动，作为对照组。
- 计算每类缺陷的召回率和精确率，结果写进 `evals/` 目录，接入 CI（只在 prompt 或模型版本变化时跑）。

### 5.2 出题准确率
- 每次改 prompt 或换模型，随机抽 30 张生成的卡，人工对照出处打分：正确、小错、错误；出处可核对与否。
- 结果记录在评估表里，形成"版本对比"曲线。这是面试时最有说服力的一张图。

### 5.3 讲解忠实度
- 100 个固定组合，每次评测都用同一个评委 prompt 打分，另外人工复核 20 条。
- 越狱测试集覆盖：忽略指令、索要答案以外的内容、要求写代码、要求透露系统提示。

### 5.4 效率
- 计时对比：手工出一张带解析的选择题平均要 X 分钟；agent 起草加人工审核平均要 Y 分钟。
- 以你之前 AWS/Claude 卡组的实际耗时作为基线，这就是简历里的"节省了多少时间"。

---

## §6 成本估算（以 Bedrock 当时价目为准，下面是数量级）

| 项目 | 估算 |
|---|---|
| Bedrock VPC 接口端点（单 AZ） | 约 $7–8/月 |
| Step Functions、SQS、pgvector | 可忽略（免费额度内，或只多一点 RDS 存储） |
| 出题：每张卡（起草、核查、质检三次调用） | 按 Opus 5 一方价估算约 $0.04–0.10；400 张约 $20–40（开 prompt caching 后更低） |
| 向量：资料切片和卡片 | 几美分，一次性 |
| 讲解：未命中缓存的单次 | Opus 5 + low effort 约 $0.005–0.01；如果你决定用 Haiku 4.5，约 $0.001–0.003 |
| 讲解：命中缓存 | 约 $0 |

同时设置：AWS Budgets 只看 Bedrock 服务、月度上限；远程配置开关随时关停。

---

## §7 里程碑（按求职优先级排序，已并入 §10 的市场差距）

| 阶段 | 内容 | 预计 | 交付物 | 补哪个缺口 |
|---|---|---|---|---|
| P0 平台层 | Bedrock 端点和 IAM（Terraform）、LlmGateway、prompt 版本、EMF 指标、开关、pgvector 扩展、migration | 约 4 天 | 能在 VPC 内安全调模型 | LLM API、AWS |
| P1 集成与度量 | ①出站 webhook（HMAC 签名，经现有 SQS/DLQ 重试），事件有 `deck.published`、`card.flagged`、`review.queued`、`import.failed`；②仓库里放两个 n8n 配方：卡片被标记后发 Slack/Teams 并写 Google Sheet，另一个是每周学习周报邮件；③控制台"自动化账本"页，列出每个自动化的运行次数、替代的人工分钟数（用你自己计时的基线）、错误率前后对比，并用 893 张卡的真实历史回填 | 约 5 天 | 能演示"把不互通的系统连起来"和"省了多少小时" | 集成、度量（Ray White 核心） |
| P2 出题 agent MVP | Python 写的 PDF/笔记导入 Lambda（pypdf，扫描件用 Textract）→ 切片和向量化 → 起草 agent（工具调用）→ 核查 → 规则质检 → 查重 → Step Functions 人工审核 → 审核队列；新增 SOURCE 字段 | 约 1.5 周 | 从一份资料到可审核草稿，全程跑通 | Agent、HITL、RAG、Python、文档 AI |
| P3 MCP server | TypeScript 写的 DeveloperCards MCP server，复用控制台 API 客户端和 Cognito PKCE；工具有 `list_decks`、`search_cards`、`draft_cards`、`submit_for_review`；在 Claude Desktop 里说"用这篇文档出 10 张卡"，草稿直接进审核队列 | 约 2 天 | 一段 MCP 演示视频 | MCP |
| P4 讲解助手 MVP | explain 接口、缓存、额度、护栏、手机端弹窗、相关错题推荐 | 约 1 周 | OTA 上线，先只对自己开放 | 面向用户的 AI、成本控制 |
| P5 评估与展示 | Python + pytest 评估 harness（埋雷测试、LLM 评委忠实度、在 CI 跑，结果显示在控制台）；CloudWatch 看板；"如何审核 AI 起草的卡"一页指南和 3 分钟教学视频；一页"出题流程改造"案例（前后数字） | 约 5 天 | 面试可展示的数字、视频和文档 | Evals、Python、培训、沟通 |
| 可选 | Power Automate 流程消费同一个 webhook，再用 OpenAPI 生成自定义 connector（1 天）；另考 PL-900 证书（约 1 周自学） | — | 只在投 Microsoft 技术栈的岗位（Allura、Tribe、FUJIFILM）时做 | Power Platform |
| 以后 | 内容过期巡检 agent（EventBridge 每周跑）、质检 agent 挂到每次发布前 | 约 1 周 | 顺手补上 E12 的定时任务 | 定时自动化 |

用现有的 Wave 方式推进：每个阶段拆成 issue，写 brief 和 verify 脚本，由 worker 执行，我负责部署和验收。合计约 5–6 周；**如果只能做一部分，先做 P1 和 P2**。

---

## §8 求职材料（做完后可以直接写）

### 8.1 简历条目（英文，完成态口径）
- Built an **agentic content pipeline** on AWS: Claude on Amazon Bedrock over a private VPC endpoint, orchestrated by Step Functions with a human-approval step. It turns official documentation into exam cards with cited sources; drafts are checked for factual support and quality before an author reviews them, cutting authoring time from X to Y minutes per card.
- Added **retrieval-augmented generation** with PostgreSQL pgvector: source chunks and card embeddings drive grounded generation, duplicate detection (cosine ≥ 0.9) and per-topic coverage reports.
- Shipped an **in-app AI tutor** that explains a learner's wrong answer strictly from the card and its cited source. It uses per-answer caching (hit rate Z%), per-user daily quotas, prompt-injection refusals and a static fallback, at under $0.002 per explanation and p95 under 5 s.
- Built an **evaluation harness without real users**: seeded-defect tests (QA recall R%, precision P%), human-graded accuracy on sampled cards, and an LLM-as-judge faithfulness suite that runs in CI when prompts or models change.

- Connected the product to other tools with **signed outbound webhooks** (retried through SQS with a DLQ) and n8n recipes: flagged cards go to Slack and a Google Sheet, and a weekly digest goes out by email.
- Built an **Automation Ledger** that measures each automation's runs, minutes of manual work replaced and error rate before and after: H hours saved per week, E defects caught before publish.
- Exposed the authoring tools as an **MCP server**, so an author can draft cards from Claude Desktop straight into the human review queue.
- Wrote the **evaluation harness and PDF ingestion in Python** (pytest in CI, pypdf and Textract), and a non-technical guide plus a training video for deck reviewers.

### 8.2 面试可以讲的取舍
- 为什么要人工审核：内容会直接影响学习者，错一张就损失信任；让 agent 负责量，人负责最后把关，采纳率和拦截率都能量化。
- 为什么强制引用出处：能核对、能回溯，也让核查 agent 有东西可比对。
- 为什么讲解要缓存：同一个错误选项的讲解对所有人都一样，缓存让成本几乎为零，延迟也更低。
- 为什么选 Bedrock 加 VPC 端点：私有网络、IAM 最小权限、没有密钥，和现有的安全设计一致。
- 为什么用 Step Functions，而不是在一个 Lambda 里写完：每一步可重试，人工等待不占算力，执行历史就是审计记录。

### 8.3 演示脚本（3 分钟）
1. 控制台上传一篇 AWS 文档，发起出题任务（20 秒）。
2. 看流水线进度和成本实时变化（20 秒）。
3. 审核队列：左边是卡，右边高亮出处，核查标红了一句，改掉后采纳（40 秒）。
4. 发布，手机上刷到这张新卡（20 秒）。
5. 故意答错，点"为什么错了"，讲解附出处；追问一个无关问题，被礼貌拒绝（40 秒）。
6. 看板：采纳率、埋雷召回率、平均成本、缓存命中率（40 秒）。

---

## §9 需要你决定的事（每项附推荐默认）

| # | 问题 | 推荐 |
|---|---|---|
| 1 | 用 Bedrock 还是直接调 Anthropic API | **Bedrock + VPC 端点**；需要的模型在 Bedrock 不可用时，再用方案 2 |
| 2 | 讲解助手是否作为付费功能 | 免费每天 10 次，订阅用户 50 次 |
| 3 | 追问文本是否保存 | 默认不保存；用户同意后保存 30 天 |
| 4 | SOURCE 字段是否对旧卡补齐 | 新卡必须有；旧卡用出题 agent 的"补引用"模式批量补，作者审核 |
| 5 | 先做哪个 | **先做 P1 集成与度量（约 5 天，Ray White 最看重），再做 P2 出题 agent**；讲解助手要依赖 SOURCE 和资料切片，放在后面 |
| 6 | 开工时间 | 1.7.0 提审后立即开始，与审核期并行 |

---

## §10 市场差距分析（SEEK 新西兰，2026-09-27，13 个岗位）

读了 13 个 AI 和 automation 岗位，其中 3 个是 graduate 或 junior 级：
- Ray White：Graduate AI & Automation Architect
- Allura（医疗机构）：AI & Automation Engineer
- FUJIFILM：Graduate Developer – Power Platform & Automation
- Tribe：AI & Automation Engineer
- OneReg：AI & Automation Lead
- Momentum、Acumen：AI Engineer
- Crescent：AI Developer .NET（2 个）
- Sunstone：Java Fullstack AI Engineer（LLM / RAG / MCP / AWS）
- Upper Echelon：AI Solution Engineer
- CarbonScape：Software & AI Engineer
- Wallace and Stratton：Junior Software Developer

| 技能 | 提到的岗位数 | 你的现状 | 本计划里怎么补 |
|---|---|---|---|
| API / 系统集成 | 10 | 已有（API Gateway、SQS、Snowflake 链路） | P1 webhook + n8n 让集成面向业务 |
| 工作流 / 流程自动化 | 9 | 部分有：自动化了自己的开发流程，还没有业务流程 | P1 + P2，外加流程改造案例 |
| 与非技术人员沟通、培训、写文档 | 8 | **缺**：现在只有面向开发的中文文档 | P5 操作指南和教学视频 |
| Python | 7 | **缺** | P2 导入 Lambda、P5 评估 harness |
| AI agent / 工具调用 | 7 | 部分有：多 agent 交付守护进程；产品内 agent 在计划中 | P2 出题 agent、P3 MCP |
| 从原型到生产 | 7 | 已有（已上架、OTA、CI） | 讲故事时强调 |
| Evals | 6 | 计划中 | P5 |
| SQL / Postgres | 6 | 已有 | pgvector 加分 |
| Azure / Power Platform | 6 | **缺** | 可选：Power Automate connector + PL-900，不在主产品里硬塞 |
| Guardrails / 人工确认 / 负责任的 AI | 5 | 计划中 | P2、P4 |
| 调用 LLM API | 5 | 部分有：大量使用工具，还没有生产集成 | P0 |
| RAG / 向量 | 5 | 计划中 | P2、P4 |
| TypeScript、测试和 CI、C#/.NET、可观测性 | 4–5 | 已有 | 已是强项 |
| 量化成效（省时、减错） | 2（Ray White、OneReg 都是核心要求） | **缺** | P1 自动化账本 |
| MCP | 2 | **缺** | P3 |
| 文档 / 非结构化数据 | 2 | **缺** | P2 PDF 导入 |

**不值得在这个产品里硬做的**：微调、Kubernetes、语音 AI、Dynamics 365、只为套名字的 LangChain。面试被问到就说：选择直接用 Bedrock SDK 是有意的，调用链更短，更好测，也更好控成本。

**针对 Ray White 最该准备的 5 样**（和岗位原文的 Create / Build / Implement / Train 一一对应）：
1. 自动化账本：用数字说明省了多少小时、少了多少错误（对应 Implement 里的 measure whether it saves time and reduces errors）。
2. webhook + n8n：把 app 和 Slack、表格、邮件连起来（对应 connect systems that don't talk to each other）。
3. 一页流程改造案例：出题流程和 delivery wave，写清前后对比（对应 redesign processes end to end）。
4. 给非技术人员的指南和 3 分钟视频（对应 Train 和 clear communication）。
5. 人工把关的出题 agent 演示，可以从 Claude Desktop 通过 MCP 发起（对应 build AI-powered workflows and agents）。

来源：[Ray White](https://nz.seek.com/job/94319629)、[Allura](https://nz.seek.com/job/94697411)、[Tribe](https://nz.seek.com/job/94347422)、[OneReg](https://nz.seek.com/job/94524820)、[FUJIFILM](https://nz.seek.com/job/94568086)、[Sunstone](https://nz.seek.com/job/94810878)、[Upper Echelon](https://nz.seek.com/job/94377373)、[Momentum](https://nz.seek.com/job/94878149)、[Acumen](https://nz.seek.com/job/94655743)、[Crescent](https://nz.seek.com/job/94541537)、[Crescent（基督城）](https://nz.seek.com/job/94560095)、[CarbonScape](https://nz.seek.com/job/94869900)、[Wallace and Stratton](https://nz.seek.com/job/94563421)。

<!-- paths-not-on-disk
     本文档提到、但磁盘上还没有的路径（计划要新建的目录），规则见 frontend/tests/docsPaths.test.ts。
- evals/
-->
