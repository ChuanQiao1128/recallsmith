# 卡片内置中文翻译：决定、格式契约与上线顺序（2026-10-18）

状态：owner 已批准（2026-10-18 聊天）。本文是 owner 文档，记录决定、导入格式契约和上线步骤。
本轮只做格式、后端、控制台和 App 的支持，用测试夹具验证；SAA-C03 改写、Basics 改写和真正的中文内容以后再做。
代码分三条分支并行实现：后端 `feat/card-translations-backend`、控制台 `feat/card-translations-console`
（本文所在分支）、App `feat/card-translations-mobile`。文中带反引号的 frontend/ 路径都在本分支上，
行号以本分支提交为准；另外两条分支上的文件只写文件名。

## 一、owner 的决定

| # | 决定 | 落到哪里 |
|---|---|---|
| 1 | 一个考试只有一个卡包。英文是唯一的原文（source of truth），默认显示英文 | 翻译只是英文卡上的一层文字，正确答案、选项 key、乱序只来自英文 |
| 2 | 卡片自带预先做好的简体中文翻译，学习时一键切换 EN / 中文，App 记住用户的选择 | App 偏好 key `recallsmith:card-lang:v1`，值 `en` / `zh-CN`，默认 `en`，整台设备共用 |
| 3 | 中英文进度共享。进度属于卡片（stableUid），和语言无关 | 切换语言不改变进度、排程、评分、乱序顺序和已选选项 |
| 4 | 第一版只做简体中文（`zh-CN`），不做繁体 | 校验只接受 `zh-CN`（`TRANSLATION_BAD_LOCALE`） |
| 5 | 整体英文为主，卡包里允许一键切换成中文翻译；Basics 也改成英文为主、配中文翻译 | 内容以后做；Claude 卡包没有翻译，不显示切换按钮 |
| 6 | 考试类卡包全部是选择题，不要问答题；入门课也用选择题 | App 的入门课要能用选择题卡（App 分支负责） |
| 7 | 每个错误选项都必须写“为什么错”（必填） | 英文规则早已是 `MCQ_WHY_MISSING`；翻译规则 `TRANSLATION_WHY_MISMATCH` 要求中文和英文一一对应 |
| 8 | 只改翻译不能让 revision 变大 | 否则已学会的卡会被当成“已更新”重新推给学习者 |

## 二、数据形状（数据库 jsonb、API JSON、deck.json 三处同名同形）

卡片字段 `translations`，没有翻译时为 null 或不出现：

```json
"translations": {
  "zh-CN": {
    "v": 1,
    "question": "…",
    "explanation": "…",
    "realWorldUsage": "…",
    "mcq": {
      "qualifier": "最安全",
      "options": {
        "a": { "text": "…", "why": null },
        "b": { "text": "…", "why": "…" }
      }
    }
  }
}
```

- `question` 必填；`explanation` 在英文有解析时必填；`realWorldUsage` 和英文同有同无；`mcq` 只在英文是选择题时出现。
- `qualifier` 和英文同有同无，并且要出现在中文题干里（不区分大小写）。
- `options` 的 key 必须和英文的 key 完全相同；`why` 和英文同有同无。
- 翻译里永远不放：`correct`、`shuffle`、选项数组或顺序、key 改名、代码、`topic`、`source`（引文保持英文原文）、难度、revision、stableUid、orderInDeck。

## 三、Markdown 导入格式（`content/decks/FORMAT.md` §1.4、§1.6、§1.7、§3.4）

规则一句话：每个可翻译的英文段落后面紧跟一个 `_ZH` 段落，就是它的简体中文。

| 标记 | 对应字段 | 规则 |
|---|---|---|
| `QUALIFIER_ZH:` | `mcq.qualifier` | 单行；英文有 `QUALIFIER:` 时才写 |
| `Q_ZH:` | `question` | 必须含汉字（`TRANSLATION_NOT_TRANSLATED`） |
| `OPT_ZH:` | `mcq.options[key].text` | 不带任何参数，翻译它上面最近的 `OPT:`；`OPT_ZH: *` 报 `TRANSLATION_CORRECT_MARK`，其他参数报 `ZH_BAD_OPT_LINE`，整张卡丢弃 |
| `WHY_ZH:` | `mcq.options[key].why` | 翻译它上面最近的 `OPT:` 的 `WHY:`；英文有 `WHY:` 才写 |
| `A_ZH:` | `explanation` | 必填 |
| `USAGE_ZH:` | `realWorldUsage` | 英文有 `USAGE:` 才写 |

- 规范顺序：header、TOPIC、QUALIFIER、QUALIFIER_ZH、Q、Q_ZH、（OPT、OPT_ZH、WHY、WHY_ZH）…、A、A_ZH、CODE、USAGE、USAGE_ZH、SOURCE。
- 一张卡只要出现一个 `_ZH` 段落，就必须把英文有的每一段都翻译齐（`ZH_MISSING_FIELD`，逐段点名，整张卡丢弃）。不允许半翻译，否则 App 会中英混排。
- 其它 `<名字>_ZH:`（`SOURCE_ZH:`、`CODE_ZH:`、`TOPIC_ZH:` 等）一律报 `ZH_UNSUPPORTED_FIELD`，正文丢弃，不会粘到上一段里。
- 已翻译卡的英文段落里出现汉字报 `EN_FIELD_HAS_CJK`（通常是把中文贴错了段落）。没有翻译的卡不查，所以本身就是中文的 `aws-saa-fundamentals` 卡包不受影响。
- 中文多选标记：英文题干有 `(Choose two.)` / `(Choose three.)` 时，中文题干必须有 `（选择两项。）` / `（选择三项。）`，反过来也一样（`TRANSLATION_CHOOSE_N_MISMATCH`，正则 `[（(]\s*选择?\s*(两|二|三|2|3)\s*项\s*[。.]?\s*[）)]`）。
- 中文里保留 AWS 服务名和功能名的英文写法（Amazon S3、AWS KMS、S3 Versioning、MFA Delete、s3:PutObject），和 AWS 官方简体中文考试指南的做法一致，不自造中文译名。

完整示例（就是 FORMAT.md §3.4 的那张卡；本分支的测试直接读取 FORMAT.md 里的这一段来解析，保证文档和解析器一致）：

```markdown
## sample-mcq-zh-04 | d2
TOPIC: 1.3 Data security controls
QUALIFIER: MOST secure
QUALIFIER_ZH: 最安全
Q:
A team stores customer exports in an S3 bucket. Security requires that objects are encrypted with a key the team controls and rotates, and that no object can be uploaded unencrypted. Which combination of actions is the MOST secure way to meet both requirements? (Choose two.)
Q_ZH:
一个团队把客户导出文件存放在 Amazon S3 存储桶中。安全要求是：对象必须用团队自己控制并轮换的密钥加密，并且任何对象都不能以未加密的方式上传。哪种操作组合是同时满足这两项要求的最安全方式？（选择两项。）
OPT: a *
Create a customer managed KMS key with automatic rotation enabled and set it as the bucket's default encryption key.
OPT_ZH:
创建一个启用了自动轮换的客户托管 AWS KMS 密钥，并将其设为存储桶的默认加密密钥。
OPT: b
Enable SSE-S3 default encryption on the bucket.
OPT_ZH:
在存储桶上启用 SSE-S3 默认加密。
WHY:
SSE-S3 keys are owned and rotated by S3, not by the team, so the "key the team controls" requirement is not met even though objects are encrypted at rest.
WHY_ZH:
SSE-S3 的密钥由 Amazon S3 拥有并轮换，不由团队控制；即使对象已静态加密，也不满足“团队控制的密钥”这一要求。
OPT: c *
Add a bucket policy that denies s3:PutObject unless the request specifies aws:kms server-side encryption.
OPT_ZH:
添加一条存储桶策略：除非请求指定 aws:kms 服务器端加密，否则拒绝 s3:PutObject。
OPT: d
Enable S3 Versioning so an unencrypted upload can be rolled back.
OPT_ZH:
启用 S3 Versioning，以便回滚未加密的上传。
WHY:
Versioning keeps prior copies of an object; it neither prevents an unencrypted upload nor encrypts anything, so it addresses recovery rather than the stated control.
WHY_ZH:
Versioning 只保留对象的旧版本，既不能阻止未加密的上传，也不会加密任何内容；它解决的是恢复问题，而不是题目要求的控制。
OPT: e
Enable MFA Delete on the bucket.
OPT_ZH:
在存储桶上启用 MFA Delete。
WHY:
MFA Delete protects object versions from deletion; it has no effect on whether uploads are encrypted or which key is used.
WHY_ZH:
MFA Delete 保护对象版本不被删除，对上传是否加密、使用哪个密钥都没有影响。
A:
Use a customer managed KMS key with rotation as the bucket default and a bucket policy that denies any PutObject lacking KMS encryption. The key gives the team ownership and rotation; the deny statement makes unencrypted uploads impossible rather than merely unlikely. SSE-S3, Versioning and MFA Delete each solve a different problem and leave one of the two requirements open.
A_ZH:
把启用轮换的客户托管 AWS KMS 密钥设为存储桶的默认加密密钥，再用存储桶策略拒绝任何未使用 KMS 加密的 PutObject。密钥让团队拥有控制权并能轮换；拒绝语句让未加密的上传变得不可能，而不只是不太可能。SSE-S3、Versioning 和 MFA Delete 各自解决的是别的问题，都会让两项要求之一落空。
USAGE:
Default encryption sets what happens when a client says nothing; only a deny policy turns "should be encrypted" into "cannot be stored otherwise".
USAGE_ZH:
默认加密只决定客户端什么都不指定时的行为；只有拒绝策略才能把“应该加密”变成“不加密就无法存储”。
```

lint 结果：`1 cards, 1 mcq, 0 issues, 2 warnings, 1 zh-CN`，退出码 0。两条 warning 是“正确选项最长”的提示，英文一条、中文一条，不阻断。

## 四、校验错误码（服务端和控制台同一套，全部阻断）

| 错误码 | 什么时候报 |
|---|---|
| `TRANSLATION_BAD_SHAPE` | 未知字段、类型不对、`v` 不是 1 |
| `TRANSLATION_BAD_LOCALE` | 不是 `zh-CN`，或者和卡包自己的语言相同 |
| `TRANSLATION_QUESTION_EMPTY` / `TRANSLATION_ANSWER_EMPTY` | 中文题干 / 解析为空 |
| `TRANSLATION_FIELD_MISSING` / `TRANSLATION_FIELD_EXTRA` | realWorldUsage、mcq 的有无和英文不一致 |
| `TRANSLATION_OPTION_KEYS_MISMATCH` | 选项 key 集合和英文不同 |
| `TRANSLATION_CORRECT_MARK` | 翻译里出现 `correct`（任何层级、任何大小写），或 Markdown 里写了 `OPT_ZH: *` |
| `TRANSLATION_OPTION_EMPTY` / `TRANSLATION_OPTION_TOO_LONG` / `TRANSLATION_OPTION_TEXT_DUPLICATE` | 选项为空、超过 600 字、两个选项文字相同 |
| `TRANSLATION_WHY_MISMATCH` | 英文有“为什么错”而中文没有，或反过来 |
| `TRANSLATION_QUALIFIER_MISMATCH` / `TRANSLATION_QUALIFIER_NOT_IN_STEM` | 限定词有无不一致 / 中文限定词不在中文题干里 |
| `TRANSLATION_CHOOSE_N_MISMATCH` | 中文多选标记和英文正确个数不一致 |
| `TRANSLATION_NOT_TRANSLATED` | 中文题干里没有一个汉字 |

服务端遇到第一个错误就拒绝写入；控制台一次列出所有错误，而且按服务端的检查顺序排列，所以控制台列出的第一个错误码就是服务端会返回的那个。
只在 Markdown 里出现的错误码：`ZH_UNSUPPORTED_FIELD`、`ZH_MISSING_FIELD`、`ZH_BAD_OPT_LINE`、`ZH_WITHOUT_OPTION`、`EN_FIELD_HAS_CJK`。
不阻断的提示：`ZH_WARN_CORRECT_LONGEST`（中文正确选项比错误选项中位数长 1.4 倍以上）、`ZH_WARN_MAYBE_STALE`（这次导入改了英文，但中文没改）。

## 五、控制台分支做了什么（证据）

| 内容 | 位置 |
|---|---|
| 校验器 `validateTranslation`，错误码和服务端相同，检查顺序和服务端相同 | `frontend/src/lib/translationRules.ts:130` |
| 汉字判断和中文多选正则（源码里写成 \u 转义，因为控制台 src/ 不允许出现中文字符） | `frontend/src/lib/translationRules.ts:28`、`frontend/src/lib/translationRules.ts:39` |
| 比较用的规范化（locale 和 key 排序、去空白、空 why 等于 null、去掉 v；服务端 null 等于文件里没有） | `frontend/src/lib/translationRules.ts:347` |
| `_ZH` 标记的词法规则、保留的 `<名字>_ZH:` | `frontend/src/lib/deckImport.ts:226`、`frontend/src/lib/deckImport.ts:234` |
| 完整性检查 `ZH_MISSING_FIELD` | `frontend/src/lib/deckImport.ts:405` |
| `EN_FIELD_HAS_CJK` 和翻译校验接入 `validateCards`（所以 planImport 会把它们变成 INVALID_CARD 冲突） | `frontend/src/lib/deckImport.ts:1050` |
| `translations` 进入 COMPARABLE_FIELDS 的规范化比较 | `frontend/src/lib/deckImport.ts:1132` |
| `TRANSLATIONS_WOULD_BE_CLEARED` 冲突，需要勾选才会清除 | `frontend/src/lib/deckImport.ts:1253` |
| `ZH_WARN_MAYBE_STALE` | `frontend/src/lib/deckImport.ts:1282` |
| 序列化按规范顺序输出 `_ZH` 段落 | `frontend/src/lib/deckImport.ts:1313` |
| 导入请求总是带 `translations`（没有就是 null）；没勾选就要清除翻译的更新不会发出去 | `frontend/src/lib/deckImportRunner.ts:149`、`frontend/src/lib/deckImportRunner.ts:160`、`frontend/src/lib/deckImportRunner.ts:291` |
| API 类型与规范化：Card.translations、translationStatus、Deck.translationLocales | `frontend/src/api/authoring.ts:40`、`frontend/src/api/authoring.ts:50` |
| 编辑卡片页的只读中文面板（按 key 对齐，显示英文 ✓，Missing / Stale / OK 标签） | `frontend/src/components/CardTranslationPanel.tsx`、`frontend/src/pages/EditCardPage.tsx:289` |
| 预览页 English / Chinese 切换；翻译不完整的卡整张显示英文并标注 | `frontend/src/pages/DeckPreviewPage.tsx:176`、`frontend/src/lib/translationView.ts` |
| 卡片列表的“中文缺失 / 中文过期”筛选和行内标签 | `frontend/src/pages/CardListPage.tsx:274`、`frontend/src/lib/cardListFilter.ts` |
| 卡包设置 Translation locales（只有 super_admin 能改，只在改动时才发送） | `frontend/src/pages/DeckEditPage.tsx:240`、`frontend/src/pages/DeckEditPage.tsx:562` |
| 举报列表显示学习者当时看的语言 | `frontend/src/api/cardReports.ts:130`、`frontend/src/pages/ReportsPage.tsx:362` |
| 导入页的“删除中文翻译”确认框 | `frontend/src/pages/DeckImportPage.tsx:291`、`frontend/src/pages/DeckImportPage.tsx:524` |
| lint 的 `--locales zh-CN` 参数（缺翻译报 `TRANSLATION_MISSING`，和发布门禁一致） | `frontend/scripts/lint-deck.mts:99`、`frontend/scripts/lint-deck.mts:150` |

界面文案全部是英文（控制台的 `frontend/tests/uiLanguage.test.ts` 不允许 src/ 里出现中文），所以切换按钮写成 English / Chinese，标签写成 zh-CN，没有用“中文”两个字。

英文卡包完全不受影响：本分支对 `content/decks/` 下全部 35 个卡包文件做了前后对比，解析结果、序列化结果、导入计划和 lint 输出与 main 逐字节一致；测试里也逐个文件验证解析无错、没有 translations 字段、序列化后再解析内容不变。

## 六、上线顺序

每一步都要等上一步确认完成再做。

1. **数据库迁移**：执行 047_card_translations.sql（纯新增、可重复执行）。新增 cards.translations、cards.translation_basis、decks.translation_locales（默认空数组）、card_reports.display_locale。先迁移再部署代码。
2. **后端**：部署 core-vpc 和 Worker。列为空时行为不变；没有翻译的卡哈希和 deck.json 字节不变，所以现有 AI QA 结论不会失效，两边分开部署的窗口里也不会出现 AI_QA_STALE。
3. **控制台**：部署本分支（同时生效的还有 lint 和 MCP server，它们打包的是同一个解析器，MCP 的 dist 需要在本机重新 build）。必须在任何带 `_ZH` 的文件出现之前上线，因为旧解析器会把 `Q_ZH:` 这类行悄悄粘进英文段落。
4. **内容**：写好中文后用 Markdown 导入。先用 `node frontend/scripts/lint-deck.mts --locales zh-CN <文件>` 检查，0 issues 再导入。
5. **设置 translation_locales**：所有卡都有中文、lint `--locales zh-CN` 通过之后，由 super_admin 在 Edit Deck › Translation locales 勾选 zh-CN。勾选之后，任何缺翻译或翻译过期的卡都会让发布失败（TRANSLATION_PUBLISH_GATE），所以不能提前勾。
6. **发布**：发布卡包；manifest 里出现 `translationLocales: ["zh-CN"]`，deck.json 的卡片带上 translations。
7. **App 2.1.0 + 强制更新**：App 读取翻译、显示切换按钮。新版本在 App Store 上线、并确认 itunes lookup 返回 2.1.0 之后，才把远程配置的 minSupportedVersion 提到 2.1.0（不能提前，否则用户点更新只看到旧版本，被锁在门外）；改远程配置时 features 块要原样保留。

## 七、本分支的测试与验证

| 命令（在 `frontend/` 下） | 结果 |
|---|---|
| `npx vitest run` | 167 个测试文件、1619 个测试全部通过（新增 5 个文件：translationRules、deckImport.translations、translationsApi、cardTranslationsConsole、lintDeckLocales） |
| `npx tsc -b`（真正的类型检查入口；`npx tsc --noEmit` 在这个仓库里什么都不查） | 通过 |
| `npx eslint .` | 0 个错误（1 个 DeckListPage 的旧 warning，与本次无关） |
| `npm run build` | 通过 |
| MCP server：`npm run build` 和 `npx vitest run`（在 `tools/mcp-server/` 下） | 通过；dist 不入库 |

## 八、风险与注意

- **整文件导入会清除翻译**：导入一份没有 `_ZH` 段落的英文文件，会把服务器上这些卡的翻译清掉。现在这种情况会变成 `TRANSLATIONS_WOULD_BE_CLEARED` 冲突并阻断，必须在预览里勾选“Delete the Chinese translation”才能继续；导入执行器也会再检查一次。
- **翻译过期**：只改英文、不改中文时，导入会把翻译重新标成“最新”（服务端每次带翻译的写入都会重新盖章），所以控制台用 `ZH_WARN_MAYBE_STALE` 提醒。在控制台表单里改英文则不会碰翻译，服务端会标成 stale，卡片列表可以筛出来。
- **revision**：只改翻译不要手动提高 revision。
- **翻译质量**：中文需要人工复核；服务名保留英文，避免生造译名。
- **体积**：371 张全选择题卡加中文后，deck.json 大约从 1.05 MB 涨到 1.9–2.6 MB，传输压缩后约 0.6–0.7 MB。
