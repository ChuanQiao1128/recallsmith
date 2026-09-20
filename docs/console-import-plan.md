# Web 控制台录题/发布优化计划(2026-08)

> 核心判断:录题的瓶颈不是编辑器不好用,是**只能一张一张录**(CardForm 357 行 + NewCardPage,
> 无任何批量入口)。日常真实工作流是"在编辑器里写一批题 → 想一次性进库"。
> 所以本波只做一件大事:**Markdown 批量导入(导入即对账)**,附带把 frontend 的测试地基立起来。
> 发布链路(DeckListPage 轮询 + 幂等拦截)已经够好,不动。
>
> 基线:HEAD=7829308;frontend 无测试框架、`npm run build` 通过;
> 卡片 schema 见 src/types/card.ts(stableUid/question/difficulty 0-4/explanation/
> codeSnippet+codeLanguage/realWorldUsage/orderInDeck/version 乐观并发)。
> 稀有度由 difficulty 映射(移动端 cardRarity.ts 为准:>=3 LEG,==2 RAR,else COM)。

## 范围纪律

- 只碰 frontend/**(新文件为主)+ .github/workflows/ci.yml 加一个 frontend job。
- **服务端零改动**:导入走既有 createCard/updateCard/fetchCardsByDeck API。
- 不碰 " 2.*" 副本文件、_archive_duplicates/、node_modules。
- 绝不 git commit/push。注释英文写"为什么",禁 em-dash。
- 每步收尾:`npm run build` 通过 + 新增 vitest 全绿。

## 一、Markdown 导入格式(与 C# 题库设计文档共用同一规范)

行导向、人手可写、对空行/CRLF 宽容:

```markdown
# deck: csharp-backend-fundamentals

## cs-async-001 | d2
Q:
await 一个已完成的 Task 时会发生线程切换吗?为什么?
A:
不一定。await 先检查 Task 状态,已完成则同步继续执行,
不排队回调,这是 fast path。
CODE: csharp
var t = Task.FromResult(42);
var v = await t; // no context switch here
USAGE:
热路径上大量 await 已完成任务时,fast path 是性能不塌的原因。
```

规则:
- `# deck: <slug>` 文件头一次;`## <stableUid> | d<0-4>` 开卡。
- `Q:` 与 `A:` 必填,多行,遇下一个标记行(`CODE:`/`USAGE:`/`##`)结束。
- `CODE: <language>` 与 `USAGE:` 可选。Q → question,A → explanation,
  CODE → codeSnippet+codeLanguage,USAGE → realWorldUsage,TOPIC → topic,OPT / WHY / QUALIFIER → mcq。
- orderInDeck = 卡片在文件中的出现序(×10,留插缝空间)。
- `TOPIC: <text>`（2026-09 增补，可选，每卡最多一次，紧跟 `## <stableUid> | d<0-4>` 头之后、`Q:` 之前；去空白后 1–80 字符，否则 `BAD_TOPIC`；第二次出现 `DUPLICATE_TOPIC`，以第一条为准）。
- `OPT: <a–f>[ *]` / `WHY:` / `QUALIFIER:`（2026-09 增补，MCQ 卡：`OPT: a` 开一个选项段、`OPT: c *` 标正确项，每个错误项必须有 `WHY:` 段；`OPT:` 载荷不合法报 `MCQ_BAD_OPT_LINE` 且绝不粘进上一段）。语法与全部校验码见 `docs/mcq-card-type-plan-2026-09-18.md` §4.1–4.5。

## 二、实现(三件套)

### 1. 纯函数核心:`frontend/src/lib/deckImport.ts`(解析 + 校验 + 对账计划)

- `parseDeckMarkdown(text): {deckSlug, cards[], errors[]}`——错误带行号,一处坏不废全文。
- `validateCards(cards)`:**uid 全文件唯一**(这是抽卡重复发卡那个生产 bug 的
  authoring 侧防线,注释点名 poolSelection 的教训)、difficulty ∈ [0,4] 整数、
  Q/A 非空、uid 格式(kebab,与 ensureStableUid 兼容)。
- `planImport(parsed, existingCards): {creates[], updates[], unchanged[], conflicts[]}`——
  **导入即对账**:按 stableUid diff,已存在且内容相同 → unchanged;内容不同 → update
  (带服务端 version,乐观并发);不存在 → create。**重跑同一文件幂等**。
- 这层是纯函数,配 vitest 单测 + fast-check 性质测试(解析-序列化 round-trip、
  重复 uid 必报错、任意乱序空行不改变解析结果)。**frontend 第一批测试从这里立起**
  (vitest + @testing-library 装进 devDependencies)。

### 2. 导入页:`frontend/src/pages/DeckImportPage.tsx`

- 入口:CardListPage 顶部加 "Import Markdown" 按钮。
- 三步向导:粘贴/选文件 → **预览表**(每卡校验结果 + creates/updates/unchanged 计数 +
  复用现有 RarityDistribution 组件显示稀有度分布)→ 执行
  (逐卡调 createCard/updateCard,进度条,单卡失败不中断、失败清单可单独重试;
  VERSION_CONFLICT 提示重新拉取对账)。
- 样式对齐现有 console 组件,不引新 UI 库。

### 3. CI:`.github/workflows/ci.yml` 加 frontend job(npm ci + vitest + build)

## 三、明确不做

- 服务端 bulk 端点(几百张卡的逐卡 POST 完全够用;等真的慢再谈)。
- 富文本/Monaco 编辑器、拖拽排序、图片上传。
- 清理 " 2.*" 副本(用户手动文件,列清单请用户自己删)。
- 发布链路改动(docs/publish.md 那套幂等+轮询已达标)。

## 四、验收

1. 把 docs/csharp-deck-design.md 里的示例卡整段粘贴 → 预览全绿 → 导入成功 →
   CardListPage 出现新卡且稀有度分布正确。
2. **同一文件再导一次 → 全部 unchanged,零写入**(幂等的可见证明)。
3. 改一张卡的 A 再导 → 恰好 1 个 update。
4. vitest 全绿,`npm run build` 通过,mobile/src_C 测试不受影响。
5. 把 `docs/mcq-card-type-plan-2026-09-18.md` §4.3 的两张示例卡（`aws-sqs-order-buffer-mcq-01`、`aws-s3-compliance-copy-mcq-02`）追加到 AWS 文件 → 预览全绿 → 导入成功；**同一文件再导一次 → 全部 unchanged，零写入**。

## 五、2026-09 增补（Wave C：topic 列 + MCQ 卡型）

§范围纪律 `:16` 的"服务端零改动"是 2026-08 的基线,保留为历史;Wave C 已改服务端 —— `cards.topic`(迁移 018,C05)与 `cards.mcq`(迁移 019,C08)两列。

- 导入器新增标记:`TOPIC:`(C06)、`OPT:` / `WHY:` / `QUALIFIER:`(C11),标记行宽松匹配、载荷严格校验。
- issue codes `BAD_TOPIC` / `DUPLICATE_TOPIC` 与 `MCQ_*` 家族全部阻断导入(非阻断警告层仍在 Phase 4 / Wave D,本波不做)。
- 对账字段 `COMPARABLE_FIELDS` 顺序为 `…, 'realWorldUsage', 'topic', 'mcq'`,其中 `mcq` 按归一化后的 JSON 字符串比较(服务端 `null` == 文件缺席),PG jsonb 的空格差异不会误判 update。
- runner 在 create/update 时一并发送 `topic` 与 `mcq`(显式 `null` 表示清空);当首张 MCQ 写入的回显缺少 `mcq` 时报 `SERVER_NOT_READY_MCQ` 并停止后续写入(防迁移 019 或 Lambda 未部署)。
- 每卡往返顺序:`header, TOPIC:, QUALIFIER:, Q:, OPT: (… *), WHY:, A:, CODE:, USAGE:`。
