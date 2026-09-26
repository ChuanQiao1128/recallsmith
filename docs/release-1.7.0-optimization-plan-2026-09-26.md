# DeveloperCards Release 1.7.0 优化计划（2026-09-26）

> 范围：web console 前端、console 后端（core-vpc / worker）、手机端 React Native 逐页、AWS 加强（Wave E）。
> 数据：7 个审计区逐页审计 + 复核，共 170 条发现；复核结果（CONFIRMED / DOWNGRADE）在表中注明；证伪 0 条；失败的审计区：无。
> 路径约定：`frontend/`、`src_C/`、`infra/`、`mobile/` 相对仓库根。抽卡区证据里的 `src/...` 指 `mobile/src/...`；壳区证据里不带前缀的 `App.tsx`、`app.json`、`package.json`、`BottomTabBar.tsx` 等指 `mobile/` 下对应文件。Wave E 文档在 `/Users/qc/src/recallsmith-merge/docs/delivery/r16-issues/`，控制目录 `~/.rimv-delivery/r16-e-prod`。

---

## §0 结论速览

- **两个 P0，今天就该处理。** AWS-01：发布 worker 的 SQS 触发器（ESM 29e34447）自 2026-09-22 17:19Z 起处于 Disabled，原因是 E05 收紧权限后没做 publish-version/update-alias，worker:prod v6 还挂在被削权的 core-vpc 角色上。结果是 console 的所有发布都卡在 PENDING，1.7.0 的新内容也发不出去。MCORE-01：CardDetail 的 hero 固定 260x364 且 overflow hidden，owner 报的"题目显示不全"在 Library -> 卡片这条路径上依然存在。另外两个成因是 MCQ 选项阶段题干截 3 行（MCORE-02）和切卡时滚动位置不复位（MCORE-03）。
- **Web console 以接线为主，基本不用写新的服务端逻辑。** 最该先修的几条：表单丢字段，选了 Paid 的卡组按 Starter 创建并发布成免费（CFE-01）；所有 4xx 都丢掉 error.code/traceId，生产环境里 VERSION_CONFLICT 恢复逻辑永远不会触发（CFE-02）；导入时中间插卡撞上不可延迟的 `uq_cards_deck_order`（CBE-02）；改卡组后不重建 manifest，删掉的卡组 app 里还能下载（CBE-03）；Admin Users 页调用了错误路径，整页不可用（CBE-01）。
- **手机端 69 个 Screen 里只有 22 个在生产导航图中可达，其余 47 个是 mock、spec 壳或孤儿页。** 结构问题：tab 每点一次就 push 一个新屏，栈一直变长（MSHELL-01）；没有任何崩溃或错误遥测（MSHELL-02）。账号侧有 6 个 P1：删号不删服务端数据、没有找回密码、注册未确认就进死路、5 天后静默掉登录、access token 不刷新、点过"Not now"后提醒再也开不了。抽卡仪式卡顿的根因是时序跑在 JS 线程上（MGACHA-05/03/02）。
- **AWS 加强进度 5/15。** E01-E05 已 apply，但 E04 和 E05 各留下一个线上回归（AWS-02 告警没有收件人，AWS-01 ESM 停用）。E06 BLOCKED（代码已完成，卡在 gate 和 drift 上），E07-E15 共 10 个未开始。按工作量算约完成 30%，剩余约 12 个工作日，每月成本增加约 $2-5。
- **1.7.0 的分工：** 手机端所有 P0/P1 和绝大多数问题都是纯 TS 或资源，先作为 OTA 推到 runtime 1.6.1（Wave G）。binary 只放必须原生的改动：Expo SDK 升级、Sentry、NetInfo、splash、Keychain、相册写入权限字符串、associatedDomains、音频引擎（Wave H）。console 和 server 走独立部署，不经过 App Store 审核（Wave F）。
- **推荐顺序：** 今天先做 E0 止血（AWS-01/02/09），然后 E06 -> E07 -> E08 -> E09，约 5 天。同一时期并行 Wave F 服务端高杠杆项（CBE-02/03/04/06）、CFE-01/02，以及 Wave G1。等 G 合并、E09 落地、AWS verify 脚本跑完之后再把 app.json 升到 1.7.0，切 Wave H binary，然后提审。E11、E13、E14、E15 放到 1.7.x。
- **总计 170 条：** P0 2、P1 22、P2 99、P3 47。

### 0.1 当天已处理（2026-09-26，supervisor）

| 项 | 做了什么 | 验证 |
|---|---|---|
| AWS-01 / E0-1 | `worker-lambda` 从 `$LATEST` 发布 v7（代码 `KUGNWMXN…` 与 v6 相同，环境/VPC/运行时配置哈希一致，只有角色换成 `developercards-worker-lambda-role`），`prod` 别名 6 -> 7，ESM `29e34447` 重新 Enabled | `get-event-source-mapping` State=Enabled；队列与 DLQ 均为 0 条；terraform 的 ESM drift 消失。**端到端发布冒烟还没做**：owner 在 console 随便发布一个卡组，任务应变成 SUCCESS；如果 09-22 以后有卡在 PENDING 的任务，用 `POST /api/v1/admin/publish/reap` 清掉再重发 |
| AWS-02 / E0-2 | 用 terraform 重建 `alerts_email` 订阅（只加 1 个资源的 plan，已 apply） | 订阅状态 `PendingConfirmation`；**owner 须在 2026-09-29 前点 info@timeawake.co.nz 里的 AWS 确认邮件**（未确认的订阅 3 天后自动删除，上一次就是这样没的） |
| E0-6 的前提 | 以上两步后 prod root 的 `terraform plan` = **No changes** | E06 的 plan 形状 gate 不会再被 drift 挡住 |
| main 与生产对齐 | PR #161 把 `delivery/r16-e-prod`（E01–E05）合进 main；分支上的 `src_C` 就是生产在跑的代码（`core-vpc:prod` v50、worker 同码） | 合并树 `dotnet test` 536/536 通过；CI 通过后合并 |

| 区域 | P0 | P1 | P2 | P3 | 合计 | 通道分布 |
|---|---|---|---|---|---|---|
| console 前端 | 0 | 2 | 13 | 10 | 25 | console 21 / server 1 / infra 3 |
| console 后端 | 0 | 2 | 14 | 9 | 25 | server 21 / console 3 / infra 1 |
| 手机 核心学习 | 1 | 2 | 14 | 6 | 23 | ota 22 / binary 1 |
| 手机 抽卡/经济/付费 | 0 | 1 | 19 | 5 | 25 | ota 24 / binary 1 |
| 手机 账号/设置 | 0 | 6 | 15 | 4 | 25 | ota 21 / binary 1 / infra 2 / server 1 |
| 手机 壳/导航 | 0 | 2 | 14 | 9 | 25 | ota 16 / binary 7 / infra 2 |
| AWS | 1 | 7 | 10 | 4 | 22 | infra 16 / server 6 |
| **合计** | **2** | **22** | **99** | **47** | **170** | |

---

## §1 版本定位

### 1.1 三条发布通道

| 通道 | 放什么 | 是否过审 | 代表项 |
|---|---|---|---|
| **1.7.0 binary** | 原生依赖升级与新增、app.json/infoPlist/entitlements、构建期 EAS env、Privacy manifest | 过审 | MSHELL-14 Expo SDK 升级；MSHELL-02 `@sentry/react-native`；MSHELL-11 NetInfo；MSHELL-13 `expo-splash-screen`；MSHELL-04 `NSPhotoLibraryAddUsageDescription`；MSHELL-19 associatedDomains + AASA；MACCT-10 `expo-secure-store`（Keychain）；MGACHA-06 `react-native-audio-api`；MCORE-23 `userInterfaceStyle`（深色，见 §8）；MSHELL-23 资源压缩；AWS-16 eas.json staging channel；AWS-17 `EXPO_PUBLIC_API_BASE=https://api.developercards.app`；MSHELL-01 bottom-tabs 完整迁移；归档里复查 PrivacyInfo.xcprivacy |
| **OTA（runtime 1.6.1）** | 纯 TS 与图片资源。1.7.0 之前先推给 1.6.1 用户，同时进入 1.7.0 的 embedded bundle | 不过审 | 手机端其余 83 条（全部 P0/P1 手机项都在这里，MACCT-01 需要先有服务端端点）；MGACHA-04 必须同时进 1.7.0 embedded bundle |
| **server / console / infra** | core-vpc 与 worker 部署、`frontend/deploy.sh`、terraform | 不过审 | Wave F、Wave E 全部；MACCT-04/AWS-08（refresh token 有效期）、MACCT-20（config 托管）、MSHELL-15/16（CI 与 OTA 脚本） |

### 1.2 runtimeVersion 规则（必须遵守）

- `runtimeVersion` policy 为 `appVersion`，所以 1.7.0 binary 会分叉出新的 runtime "1.7.0"。**以 runtime 1.7.0 发布的 OTA 只会到达 1.7.0 binary**；1.6.1 用户只收得到 runtime 1.6.1 的 OTA。
- 由此推出：
  1. 所有 OTA-safe 的修复（Wave G）先在 1.6.1 上发，两类用户都能拿到，再并入 1.7.0 的 embedded bundle。
  2. 1.7.0 上线后，每个 hotfix 都要对 1.6.1 和 1.7.0 **分别发布**，直到 1.6.1 的占比降下来（服务端能从 `clientCapabilities.ts` 上报的 updateId 看到 OTA 采用情况）。
  3. 没有应用内更新检查（MSHELL-05），OTA 要到发布后的**第二次冷启动**才生效，所以要尽早发。
  4. OTA 一律用 `eas update --channel production --environment production`。不带 `--environment` 会把 `EXPO_PUBLIC_*` 内联成空值，导致所有 1.6.x 用户同步和登录全挂（MSHELL-16，suspected）。先补 `scripts/release/ota.sh` 再发任何 OTA。
- E08（API authorizer）不需要 OTA 或 binary：1.6.1 代码一直带着 access token（`mobile/src/api/apiClient.ts:43-46`、`deckRepository.ts:200-214`）。E09 的 `hosts.ts` 可以 OTA 到 1.6.1，但应在 1.7.0 的 EAS env 里写死。
- 冻结文件（`deckRepository.ts`、`progressSync.ts`、`review/model.ts`）：所有推荐修复都不需要改它们。唯一例外是可选地删掉 `progressSync.ts:141` 那份重复的 AsyncStorage token（MACCT-10），这需要签字例外。

---

## §2 Web console 前端

### 2.1 逐页结论

| 页面 | 文件（行） | 入口 | 结论 | 主要问题 | 修复（发现） | 工作量 |
|---|---|---|---|---|---|---|
| LoginPage | frontend/src/pages/LoginPage.tsx (90) | /login，公开，eager | polish | next= 安全、错误码映射好；但会打印 Cognito domain/clientId，品牌仍是 RecallSmith，session_expired 用的是通用文案，Back to Home 回环到 /login | CFE-18、CFE-17 | S |
| AuthCallbackPage | frontend/src/pages/AuthCallbackPage.tsx (60) | /auth/callback | ok | StrictMode 安全，state+PKCE 校验，URL 只带稳定错误码，重定向已消毒 | 无 | - |
| DeckListPage | frontend/src/pages/DeckListPage.tsx (723) | / ，lazy + 预取 | needs-work | super_admin 分页路径扎实；editor 会请求只有 super_admin 能访问的 manifest（红色横幅、全部显示 Unpublished）；失败原因不显示；30s 轮询从不暂停；有死统计块 | CFE-04、09、10、22、21 | S+S+M+S+S |
| NewDeckPage | frontend/src/pages/NewDeckPage.tsx (409) | /decks/new | broken | 收集了 deckType/locale/contentVersion/freeCardCount，一个都没发；选 Paid 的卡组以 deck_type=1 创建并免费发布；label 没关联 | CFE-01、19、17 | S |
| DeckEditPage | frontend/src/pages/DeckEditPage.tsx (580) | /decks/edit?deckId= | needs-work | deckType/author/locale/version 的修改被静默丢弃；description 清不掉；为了数卡数先拉 deck 再拉 cards；totalCards 靠手动维护 | CFE-01、03、05、11、16 | S+S+M+S+M |
| DeckPreviewPage | frontend/src/pages/DeckPreviewPage.tsx (420) | /decks/preview?deckId= | needs-work | 客户端自己重实现 deck.json：没有 MCQ，Version 固定 0.0.0，下载的文件和 worker 发布的不一致 | CFE-08、05 | M |
| DeckImportPage | frontend/src/pages/DeckImportPage.tsx (648) | /decks/cards/import?deckId= | polish | 三步对账与幂等设计好；运行中不能取消，离开页面不拦截，串行且无退避；冲突提示在生产环境失效 | CFE-07、02、19；服务端 CBE-02 | M |
| CardListPage | frontend/src/pages/CardListPage.tsx (360) | /decks/cards?deckId= | polish | 唯一用 React Query 且带类型化错误的页面；441 行全量渲染，没有搜索/过滤/排序；重试和 trace 体验依赖的 code 在 4xx 时丢失 | CFE-06、02 | M |
| NewCardPage | frontend/src/pages/NewCardPage.tsx (262) | /decks/cards/new?deckId= | polish | 下一个 orderInDeck 算得对，但为此下载整组；没有 topic/MCQ 录入；没有未保存守卫 | CFE-05、16、24 | M |
| EditCardPage | frontend/src/pages/EditCardPage.tsx (351) | /decks/cards/edit | needs-work | VERSION_CONFLICT 恢复在生产环境不触发；snippet/explanation 清不掉；明明有 ?id= 过滤还拉整组 | CFE-02、03、05、16、24、25 | S+S+M |
| AdminUsersPage | frontend/src/pages/AdminUsersPage.tsx (840) | /admin/users（super_admin） | polish（后端 broken） | 'Reset & migrate' 承诺 DROP，服务端却忽略 reset；新建用户的输入框没有 label；标题仍是 'RecallSmith Console'；用户列表/新建走错路径 | CBE-01、CFE-20、19、17 | S |
| ContentIntelligencePage | frontend/src/pages/ContentIntelligencePage.tsx (471) | /content-intelligence | polish | fetch effect 不可取消，慢的旧响应会覆盖新的 | CFE-12 | S |
| ConsoleShell | frontend/src/components/console/ConsoleShell.tsx (118) | 12 页里只有 4 页用 | polish | 导航本身干净；card/import/preview/new-deck 页绕开了它，导航、登出、品牌不一致 | 横切（见 2.4） | 未估 |
| src/api/* | frontend/src/api/authoring.ts 等 (1330) | 模块 | needs-work | single-flight refresh 与 401 处理好；非 2xx 一律丢掉 error.code/traceId；错误 helper 重复两份；有死导出 | CFE-02、21、05；CBE-23 | S |
| src/auth/* | frontend/src/auth/tokenStore.ts 等 (673) | 模块 | ok | PKCE S256、state 校验、按 origin 消毒、保留 refresh token；token 存 sessionStorage 但没有 CSP；两个 JWT decoder、两个 SessionUser 类型 | CFE-15、21 | S |
| App.tsx 路由/分包 | frontend/src/App.tsx (137) | root | ok | 受保护路由全 lazy，DeckList chunk 预取，ChunkErrorBoundary 导航时重置，入口约 90 kB gz | CFE-23、13 | S |
| features/deckList | frontend/src/features/deckList/useDeckPagination.ts 等 (1014) | DeckListPage 内部 | polish | 纯函数行模型和 keyset 分页有测试；状态/类型过滤只作用于已加载页；tabs/搜索缺 ARIA | CFE-19、04 | S |

### 2.2 P1 详情

**CFE-01（P1，DOWNGRADE）卡组表单丢掉 deckType/locale/version/author，选 Paid 的卡组按 Starter 创建并免费发布**
- 证据：`frontend/src/pages/NewDeckPage.tsx:145-150`（payload 只有 slug/title/author/description），`:283-303`（Paid 单选）；`frontend/src/pages/DeckEditPage.tsx:225-236`（PUT 省略 deckType/author/locale/version）；`src_C/Vpc/Authoring/Decks.cs:127-140`（服务端接受 locale/deckType，deck_type 默认 coalesce 为 1）；`src_C/Vpc/Authoring/Publish.cs:80-85`（InferTier：deckType 1 -> free）；`frontend/tests/deckFormFieldDrop.test.tsx:9-19`（缺陷被测试钉住，没有修）。
- 影响：作者选 'Paid (subscription)'，得到的是 deck_type=1；除非之后手动覆盖 tier，worker 会发布到免费层。zh-CN locale、内容版本和作者的修改都被静默丢弃。
- 复核：丢字段属实。但 `DeckEditPage:471-480` 显示 'Effective tier' 并提供 tier 覆盖，而且只有一个作者，可以补救，所以降级。
- 修复：创建时发送 locale、deckType、version（previewCards 取自 freeCardCount），PUT 时发送 deckType/author/locale/version；把 `deckFormFieldDrop.test.tsx` 改成断言完整 payload。和 CFE-03 共用一个 `buildDeckBody/buildCardBody`（`deckImportRunner` 的规则已经对了：发 '' 和显式 null）。S，console。**1.7.0 console 第一项。**

**CFE-02（P1，CONFIRMED）所有 4xx 丢掉服务端 error.code/traceId，生产环境 VERSION_CONFLICT 恢复永不触发**
- 证据：`frontend/src/api/http.ts:20-23`（默认 validateStatus，4xx 抛异常）；`frontend/src/api/authoring.ts:10-31`（fail() 把 code 写死为 NETWORK_ERROR、traceId 为 ''），`:499-501`；`src_C/Shared/RecallSmith.Lambda.Common/Res.cs:161-162`（BadRequest = HTTP 400）；`src_C/Vpc/Authoring/Cards.cs:349`；`frontend/src/pages/EditCardPage.tsx:290`；`frontend/src/lib/deckImportRunner.ts:153-155`；`frontend/tests/editCardVersionConflict.test.tsx:42`（mock 的是 api 层，没经过 axios）。
- 影响：'Retry with latest version'、导入的 'Re-run the preview' 提示、基于 NOT_FOUND 的重试抑制、失败页的 trace ID，在生产环境全是死代码，任何拒绝都显示成网络错误。
- 修复：`authoring.ts` 和 `admin.ts` 的 toApiErrorMessage/fail 在 `err.response.data` 是 ApiResult envelope 时原样返回，保留 code 与 traceId；加一个经过真实 axios 400（adapter mock）的测试。S，console。

### 2.3 其余发现（P2/P3）

| ID | 级别 | 标题 | 证据 | 修复 | 量 | 通道 |
|---|---|---|---|---|---|---|
| CFE-03 | P2 | 编辑时清空 snippet/language/explanation/description 静默无效 | frontend/src/pages/EditCardPage.tsx:264,271-272（`\|\| undefined`）；DeckEditPage.tsx:228；api/authoring.ts:474-487；lib/deckImportRunner.ts:18-22 | 清空的可选文本发 ''，只省略表单没显示的字段 | S | console |
| CFE-04 | P2 | editor 永远看到 'Manifest Sync Error'，所有卡组都是 Unpublished | features/deckList/useDeckPagination.ts:131；pages/DeckListPage.tsx:212-215,229-239,592-601；src_C/Vpc/Runtime/AdminManifest.cs:44；features/deckList/deckListRows.ts:117-119 | 非 super_admin 跳过 fetchAdminManifest，状态从 latestBuildId/version 推导 | S | console |
| CFE-05 | P2 | 每个卡片页重新下载 441 张整组，缓存不共享 | api/queryClient.ts:62-63（staleTime 0、gcTime 0）；EditCardPage.tsx:94-97,235-247；src_C/Vpc/Authoring/Cards.cs:26（已有 ?id=）；NewCardPage.tsx:87-90；DeckEditPage.tsx:145,181；DeckPreviewPage.tsx:153 | 全部页面迁到 useDeck/useCards，staleTime 约 30s；单卡走 /authoring/cards?id=；用 deck.totalCards 计数 | M | console |
| CFE-06 | P2 | 441 张卡的列表没有搜索/过滤/排序/窗口化 | pages/CardListPage.tsx:273-348 | 客户端过滤（uid/question/topic/MCQ/difficulty）+ useDeferredValue + memo 行；超过约 1k 再上窗口化 | M | console |
| CFE-07 | P2 | 导入不能取消，离开页面不拦截，串行且无退避 | DeckImportPage.tsx:243-261,314-316；lib/deckImportRunner.ts:182-234；api/http.ts:22（15s 超时） | Cancel + beforeunload；429/5xx/超时退避重试；Retry 改为重新预览 | M | console |
| CFE-08 | P2 | Preview/Download 的 deck.json 缺 MCQ，与 worker 构建不一致 | DeckPreviewPage.tsx:9-19,201,216-238；src_C/Worker/Services/PublishJobProcessor.cs:72,230 | 服务端 dry-run 端点返回真实 payload；至少补 mcq/topic 并标注"近似" | M | console |
| CFE-09 | P2 | 失败的发布任务不显示 errorMessage | features/deckList/components/PublishJobsPanel.tsx:55-79；api/authoring.ts:584-591；src_C/Vpc/Authoring/PublishJobs.cs:28 | FAILED 行显示 errorMessage 并链接 jobId | S | console |
| CFE-10 | P2 | 回滚、manifest 重建、分页卡片端点没有 console UI | src_C/Vpc/Authoring/DeckRollback.cs:10-11；src_C/Vpc/VpcFunction.cs:207；CardsPage.cs:9-16；frontend/src/App.tsx:102-126；api/authoring.ts | 每个卡组加 Builds 面板（SUCCESS 构建 + 键入确认的回滚），super_admin 加 'Rebuild manifest' | M | console |
| CFE-11 | P2 | 卡数依赖手动点 'Apply to totalCards'（疑似 manifest 过期） | DeckEditPage.tsx:259-267；src_C/Vpc/Authoring/Decks.cs:211；deckListRows.ts:98,118；src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs:135 | 服务端在卡片增删或发布时重算 total_cards（并入 CBE-06）；短期在导入结果页提示 | S | server |
| CFE-12 | P2 | ContentIntelligence 请求不可取消，旧响应覆盖新响应 | pages/ContentIntelligencePage.tsx:154-168 | effect cleanup 加 cancelled/AbortController，或改用 useQuery([deckSlug, days]) | S | console |
| CFE-13 | P2 | 生产错误上报是空操作 | lib/reportError.ts:37-43；frontend/.env.production:1-17；main.tsx:16 | 加 edge-public beacon 端点（或 CloudWatch RUM），部署时设置 VITE_ERROR_REPORT_URL 与 VITE_BUILD_ID | M | infra |
| CFE-14 | P2 | console 仍在裸 CloudFront 域名上，调用的是 '/dev' stage | frontend/.env.production:11,15-16；infra/modules/edge/cdn.tf:141-142；frontend/vite.config.ts:8-10 | ACM 证书 + alias console.developercards.app，补 Cognito 回调/登出 URL 与 CORS，重建（依赖 E09） | M | infra |
| CFE-15 | P2 | access + refresh token 存 sessionStorage，console 没有 CSP | auth/tokenStore.ts:176；api/http.ts:75；infra/modules/edge/cdn.tf:171；frontend/index.html:3-18；components/CardForm.tsx:575（innerHTML） | 自定义 response-headers policy，严格 CSP；缩短 console 客户端的 refresh token | S | infra |
| CFE-16 | P3 | 卡片/卡组表单没有未保存守卫 | frontend/src/main.tsx:22（BrowserRouter）；EditCardPage.tsx:345；grep 无 beforeunload/useBlocker | CardForm 与 DeckEditPage 跟踪 dirty + beforeunload；迁到 createBrowserRouter 以使用 useBlocker | M | console |
| CFE-17 | P3 | 品牌分裂：RecallSmith Console 与 DeveloperCards Console 并存 | frontend/index.html:17；LoginPage.tsx:38；DeckListPage.tsx:564；DeckEditPage.tsx:301；AdminUsersPage.tsx:401,424；NewDeckPage.tsx:56,256 | 统一 CONSOLE_NAME，按路由设置 document.title，默认作者改为 'DeveloperCards' | S | console |
| CFE-18 | P3 | 会话过期显示通用失败文案；登录页打印配置并回环 | api/http.ts:107,135,164（error=session_expired 或 unauthorized）；LoginPage.tsx:21-27,76-83,86 | 为这两个 code 加文案，非 DEV 隐藏配置块，去掉 Back 链接，按钮改名 'Sign in' | S | console |
| CFE-19 | P3 | 无 label 的输入、没有 role 的 tab、静态标题、progress 不播报 | NewDeckPage.tsx:212-223,229-238；AdminUsersPage.tsx:488-515；DeckFilterBar.tsx:60-65；DeckConsoleHeader.tsx:75-86；DeckImportPage.tsx:558-565；index.html:17 | id/htmlFor、aria-label、tablist/tab、role=progressbar、useDocumentTitle | S | console |
| CFE-20 | P3 | 'Reset & migrate (DEV only)' 承诺的 DROP 服务端从不执行 | AdminUsersPage.tsx:348-393,680-688；api/admin.ts:83-94；src_C/Vpc/Db/Migrate.cs:129-190 | 删掉 reset 按钮（或用生产构建没有的 env 开关门控），DB 工具移到 /admin/system | S | console |
| CFE-21 | P3 | 死 API/auth 导出（其中一个会 405）、残留注释、40 行注释 JSX | api/authoring.ts:516-556,575-582,696；src_C/Vpc/Authoring/Permissions.cs:20-22；auth/tokenStore.ts:142-152,185-208；auth/pkce.ts:21-30；DeckListPage.tsx:624-665 | 删除，由 tests/apiSurfaceCensus.test.ts 钉住收缩后的接口 | S | console |
| CFE-22 | P3 | 发布任务轮询每 30s 永远在跑 | DeckListPage.tsx:492-498,616；lib/publishJobsPolling.ts:29,116-123 | 页面 hidden 时暂停，非 super_admin 跳过，连续空闲 N 次后停止 | S | console |
| CFE-23 | P3 | deploy.sh 删除旧 hash chunk，每次部署都让已打开的 tab 下次导航出错 | frontend/deploy.sh:20（s3 sync --delete）；infra/modules/edge/cdn.tf:151-161；components/ChunkErrorBoundary.tsx:12-16 | assets 同步不带 --delete，约 7 天以上的 chunk 另行清理 | S | console |
| CFE-24 | P3 | MCQ 选项和 topic 只能导入；表单提交前不跑 mcqRules | components/CardForm.tsx:72-76,596-620,7-14；EditCardPage.tsx:260-284；src_C/Vpc/Authoring/Cards.cs:271-285 | 有 mcq 时对表单值跑 validateMcq 并内联提示；后续加 topic 字段和简易选项编辑器 | M | console |
| CFE-25 | P3 | snippet 每次按键重新高亮；axios 给首屏路由加 19 kB gz | CardForm.tsx:345-358；/Users/qc/src/recallsmith-release/frontend/dist/assets/http-DyweveEy.js（49.7 kB raw / 19.1 kB gz；入口 90.1 kB gz） | useDeferredValue(codeSnippet) 并跳过 highlightAuto；可选：约 40 行的 fetch 包装替代 axios | S | console |

### 2.4 前端横切

- 服务端 envelope 在非 2xx 时丢失：`authoring.ts` 和 `admin.ts` 各有一份 toApiErrorMessage/fail，把所有 4xx 压成 NETWORK_ERROR、traceId 为空。所有按 code 分支的 UX 只在 mock 测试里有效（CFE-02）。
- 表单收集了却不发送（NewDeckPage/DeckEditPage），而且用 `|| undefined`，字段清不掉。`deckImportRunner` 的规则已经是对的，抽一个共享的 buildCardBody/buildDeckBody 就能同时修好两处（CFE-01/03）。
- 两种取数风格并存：只有 CardListPage 用 React Query，另外 8 页手写 useEffect + cancelled。全局 staleTime 0 / gcTime 0，没有任何共享，每次跳转都重新下载整组（CFE-05）。
- 12 页里只有 4 页用 ConsoleShell。卡片、导入、预览、新建卡组页的 header 是临时拼的，没有导航和登出；登出逻辑复制了 4 份，没用 `AuthContext.signOut`。
- 品牌和基础设施命名落后于产品：'RecallSmith' 字样、裸 CloudFront 域名、API stage '/dev'、`cdn.tf` 注释写着 '(dev)'。
- 已知缺陷被测试钉住而不是修掉（`deckFormFieldDrop.test.tsx`、console-refactor-plan §五 第 1/6/7 条、8.6 F7）。清单现成，1.7.0 从 CFE-01 开始。
- bundle 和分包健康：入口约 90 kB gz，按路由分 chunk，CardForm/highlight.js 独立（19 kB gz）。剩下的收益在缓存和重取，不在包体积。
- 后端已有、console 没有入口的能力：rollback、manifest rebuild、dashboard 聚合、分页卡片、单卡 GET。console 1.7 的工作主要是接线。
- 除 CFE-11（server）和 CFE-13/14/15（infra）外，其余都随 `deploy.sh` 发布，与手机 1.7.0 binary 和 OTA 无关。

---

## §3 Web console 后端

### 3.1 按端点分组

| 端点组 | 文件（行） | 入口 | 结论 | 主要问题 | 发现 | 工作量 |
|---|---|---|---|---|---|---|
| VpcFunction dispatch | src_C/Vpc/VpcFunction.cs (329) | API GW ANY /{proxy+} -> core-vpc:prod | polish | RouteMetrics 里一条 EndsWith 链；每个请求 2 行 info 日志；admin users 仍是 501 占位；没有 scheduler 事件入口 | CBE-24、16、01；AWS-15 | S |
| Authoring decks | src_C/Vpc/Authoring/Decks.cs (295) | /api/v1/authoring/decks | needs-work | CRUD 可用；编辑后不重建 manifest；slug 改名不设防且不校验；total_cards 手工维护；editor 字段丢弃不报；无测试 | CBE-03、06、09、13、22、15 | S×5 + M |
| Authoring cards + keyset page | src_C/Vpc/Authoring/Cards.cs (+CardsPage.cs 211) (402) | /api/v1/authoring/cards；/cards/page 无调用方 | needs-work | 乐观版本与 MCQ 校验扎实；列表不设上限；字段无长度限制；VERSION_CONFLICT 返回 400；分页路由没被采用 | CBE-11、09、22 | M+S+S |
| Deck import | frontend/src/lib/deckImportRunner.ts + Cards.cs (237) | DeckImportPage | needs-work | 逐卡写，非原子；位置 x10 重排在中间插入时撞上不可延迟的 uq_cards_deck_order；没有服务端批量端点 | CBE-02 | M |
| Publish enqueue/status/jobs | src_C/Vpc/Authoring/Publish.cs (+PublishStatus.cs 45, PublishJobs.cs 39) (377) | POST publish、GET status/jobs | polish | MCQ gate、15 分钟去重、部分唯一索引出 409、SQS 失败补偿都好；editor 能读所有卡组的 jobs；[DEBUG] info 日志；卡住的任务无人回收 | CBE-21、24、04 | S |
| Worker publish path | src_C/Worker/WorkerFunction.cs (+PublishJobProcessor.cs 233, JobRepository.cs 126) (209) | SQS -> worker-lambda:prod | polish | 接收计数、ReportBatchItemFailures、进程内重建 manifest、live_build_id 都已到位；系统错误把任务留在 PROCESSING 且无原因；FAILED 任务会被重新获取 | CBE-04、17 | M+S |
| Admin permissions | src_C/Vpc/Authoring/Permissions.cs (266) | /api/v1/admin/permissions(+/bulk) | polish | 批量替换有事务；无操作人/审计；FK/check 错误返回 500；客户端残留一个会 405 的 PUT /bulk | CBE-12、22、23 | S |
| Admin users / Cognito admin | src_C/Vpc/VpcFunction.cs:284-308 (25) | console 调 /api/v1/admin/users -> core-vpc（501/404） | broken | 路径错误，网关路由到 core-vpc 占位，列表和新建都失败 | CBE-01 | S |
| Admin manifest 读取 + 重建 | src_C/Vpc/Runtime/AdminManifest.cs (+ManifestRebuild.cs 28) (82) | GET /admin/manifest；POST rebuild 只能 curl | polish | 读代理正常，重建走共享的条件写 ManifestBuilder；没有 console 按钮；卡组编辑从不调用 | CBE-03、CFE-10 | S |
| Deck rollback | src_C/Vpc/Authoring/DeckRollback.cs (112) | POST /api/v1/admin/decks/{id}/rollback（无 console 调用方） | polish | 校验 SUCCESS 构建、移动指针、进程内重建；不记操作人；卡组列表显示按日期最新而不是 live 指针 | CBE-12、18、CFE-10 | S |
| Publish reaper | src_C/Vpc/Authoring/PublishReaper.cs (69) | POST /api/v1/admin/publish/reap（只能 curl） | polish | 不相交 CTE 正确且有测试；只能手动，无调度、无按钮 | CBE-04、AWS-15 | S |
| Admin DB routes | src_C/Vpc/Db/Migrate.cs (+ContentIntelligenceDemo.cs 105, Netcheck.cs 78) (337) | POST /admin/db/migrate（AdminUsersPage），其余 curl | needs-work | 破坏性和 demo 路由在生产二进制里；secret 比较非常量时间；advisory lock 无超时且跑在 30s 网关限制内；用第二个连接池 | CBE-08、10、20 | S+M+S |
| Admin decks keyset list | src_C/Vpc/Authoring/AdminDecks.cs (148) | GET /api/v1/admin/decks | ok | 精确到微秒的 keyset，ILIKE 已转义；latestBuildId 没用 live_build_id | CBE-18 | S |
| Dashboard | src_C/Vpc/Authoring/Dashboard.cs (280) | GET /authoring/dashboard（无前端调用方） | dead | 必然 500：两个并行查询共用一个连接，并把 DateTime 转 Int64；另有一份重复的 manifest 逻辑 | CBE-19：删除 | S |
| Content Intelligence | src_C/Vpc/Authoring/ContentIntelligence.cs (+SnapshotImport.cs 533, OutboxPublisher.cs 267) (429) | GET /authoring/content-intelligence | needs-work | 快照分支不查新鲜度，还把 generatedAtMs 标成 now；导入逐行 upsert、从不清理、无调度；live 路径在当前规模可用 | CBE-05、25；E12/E13 | S+S |
| Pagination | src_C/Vpc/Pagination/KeysetCursors.cs (231) | admin/decks、cards/page、sync pull | ok | 带版本的 base64url JSON 游标，严格解码，行比较 keyset；KeysetCursorTests 覆盖 | 无 | - |
| Shared Db | src_C/Shared/RecallSmith.Lambda.Db/Pg.cs (+DbUtil.cs 72, ManifestBuilder.cs 455) (148) | 所有 DB 路由 + worker | polish | 单池 + auto-prepare，manifest 条件写带重试；无 CommandTimeout；Npgsql 8.x/10.x 分裂；Vpc/Db 还有一个重复池 | CBE-10、14、20 | M+S+S |
| Shared Common | src_C/Shared/RecallSmith.Lambda.Common/Auth.cs (+JwtVerifier.cs 393, Res.cs 220, Log.cs 182, RouteMetrics.cs 507) (383) | 每个请求 | polish | RS256 用内置 JWKS 校验、失败即拒；route metrics 有界；envelope 统一；admin gate 不绑定 console issuer/client | CBE-07 | S |
| Legacy src_C/Common + Public C# | src_C/Common/*.cs、src_C/Public/*、src_C/RecallSmith.Lambda.csproj (900) | 未部署（不在 sln；线上 edge-public 是 Node） | dead | 旧副本，含 NOT SECURE 的未验证 JWT 解码 | CBE-20：删除 | S |

### 3.2 P1 详情

**CBE-02（P1，CONFIRMED）导入按 x10 重排，但 uq_cards_deck_order 不可延迟，中间插入必然失败**
- 证据：`frontend/src/lib/deckImport.ts:341`（orderInDeck = position×10）；`frontend/src/pages/DeckImportPage.tsx:232`（先 create 后 update）；`frontend/src/lib/deckImportRunner.ts:182-189`（逐卡串行）；`src_C/Vpc/Db/Migrations/001_init.sql:53`（(deck_id, order_in_deck) 上的立即唯一约束）；`src_C/Vpc/Authoring/Cards.cs:297,344`；`Helpers.cs:28-29`。
- 影响：只要不是在末尾插入或移动，新卡和每张被挤动的卡都会和相邻卡当前的 order 冲突（UNIQUE_VIOLATION），每次运行只有尾部能成功；运行又不是原子的，卡组会停在半重排状态。
- 修复：新增 `POST /api/v1/authoring/cards/import`，单事务，按 (deck_id, stable_uid) 幂等 upsert；migration 022 把 uq_cards_deck_order 改为 DEFERRABLE，并 `SET CONSTRAINTS DEFERRED`；每次调用上限约 500 张。M，server。**这会带来一个 migration，按 E12 的判定条件，E12 因此进入 1.7.0 范围（见 §5）。**

**CBE-03（P1，CONFIRMED）卡组编辑（上下架/tier/排序/标题/删除）从不重建 manifest.json**
- 证据：`src_C/Vpc/Authoring/Decks.cs:182-290`（PUT/DELETE 只写 DB）；`src_C/Shared/RecallSmith.Lambda.Db/ManifestBuilder.cs:124-141`（manifest 读取这些列）；只在 `src_C/Worker/WorkerFunction.cs:87-90`、`DeckRollback.cs:85`、`ManifestRebuild.cs:24` 重建；`frontend/src` 里没有 /admin/manifest/rebuild 的调用方。
- 影响：在 console 里下架、重排或删除卡组，app 里毫无变化，要等到下一次不相关的发布；删掉的卡组仍可下载。AWS-01 期间根本没有发布能跑，也就没有任何东西会触发重建。
- 修复：PUT 成功且改到 manifest 字段、或 DELETE 成功后，进程内调用 `ManifestBuilder.RebuildAsync`（条件写保证安全），响应里返回 manifestRebuilt；除非已排队重新发布，否则拒绝 tier 翻转。S，server。

### 3.3 其余发现（P2/P3）

| ID | 级别 | 标题 | 证据 | 修复 | 量 | 通道 |
|---|---|---|---|---|---|---|
| CBE-01 | P2（DOWNGRADE） | Admin Users 页调 /api/v1/admin/users，网关送到 core-vpc，返回 501/404 | frontend/src/api/admin.ts:102,145；AdminUsersPage.tsx:158,278；src_C/Vpc/VpcFunction.cs:284-308；infra/modules/api/main.tf:12,20；src_C/Public/PublicFunction.cs:104 | listAdminUsers/createAdminUser 改指 /api/v1/admin/cognito/users（先确认线上 Node edge-public 返回的是 AdminUser 形状），删掉 501 占位。复核：只有 admin 能进的页（App.tsx:120），单人开发，不是常用路径 | S | console |
| CBE-04 | P2 | worker 系统错误把任务留在 PROCESSING；进 DLQ 后该卡组被 409 挡住，直到手动 reap | src_C/Worker/WorkerFunction.cs:115-120；infra/modules/worker/queue.tf:12,15；Publish.cs:271-285；Helpers.cs:60-65；PublishReaper.cs:56-68；VpcFunction.cs:33-45；RouteMetrics.cs:74-82 | 系统错误写 error_message；ApproximateReceiveCount ≥ maxReceiveCount 时标 FAILED；加 E12 scheduler 分支（每 5 分钟 reap）或 console 'Reap stuck jobs' 按钮 | M | server |
| CBE-05 | P2 | Content Intelligence 用快照不查新鲜度，generatedAtMs 标成 now | ContentIntelligence.cs:30,390-399,405；Analytics/ContentIntelligenceSnapshotImport.cs:186,272；docs/backend-architecture-review-2026-09-22.md:115,150 | 返回 max(source_generated_at)，超过约 48h 回落到 live 查询；导入事务里删除本次没写到的行 | S | server |
| CBE-06 | P2 | decks.total_cards 手工维护，发布从不同步（新卡组发出去是 0） | Migrations/005_decks_manifest_v2.sql:15；PublishJobProcessor.cs:136；ManifestBuilder.cs:305；frontend/src/pages/DeckEditPage.tsx:362 | CompleteJobAsync 在设置 live_build_id 的同一语句里把 total_cards 设为导出卡数 | S | server |
| CBE-07 | P2 | admin gate 信任两个池子的 cognito:groups，id/access token 都认，不查 client_id | JwtVerifier.cs:124,239（两个 issuer，ValidateAudience=false）；Auth.cs:256-258,296-310；infra/modules/api/gateway.tf:62,65-75 | RequireAdmin/RequireSuperAdmin 要求 iss 为 console 池、client_id/aud 为 console 客户端；按 doc §2.1.1 (1)(2) 给 /authoring/* 与 /admin/* 挂 console authorizer（和 E08 一起做） | S | server |
| CBE-08 | P2 | DROP/CREATE DATABASE 与 demo 灌数路由在生产；secret 用 string.Equals 比较 | VpcFunction.cs:125,133,141；Migrate.cs:142,264,301,328；ContentIntelligenceDemo.cs:39 | API_ENV=production 时不注册 recreate/create/demo（或要求 ALLOW_DESTRUCTIVE_DB=1）；FixedTimeEquals；生产强制要求 MIGRATE_SECRET | S | server |
| CBE-09 | P2 | 请求体无上限、字段无长度限制、slug 无语法约束 | Common/Validation.cs:30-42；Cards.cs:117-132；Decks.cs:124-133,198；Publish.cs:204-208 | RawBody > 1 MB 返回 413；question/explanation/code 上限 8/16/32 KB；slug 强制 `^[a-z0-9][a-z0-9-]{0,63}$` | S | server |
| CBE-10 | P2 | 没有 CommandTimeout/lock_timeout；网关 30s 切断，Lambda 在单连接池上跑满 90s | Pg.cs:88-104；Migrate.cs:99；infra/modules/api/gateway.tf:33；core_vpc.tf:14；infra 无 reserved_concurrent_executions | CommandTimeout 约 20s 并按 RemainingTime 取消；lock_timeout='5s' 映射为 409 MIGRATION_IN_PROGRESS；core-vpc reserved concurrency 40、timeout 约 35s（与 E08/E14 合并做） | M | server |
| CBE-11 | P2 | console 通过不设上限的 GET /authoring/cards 拉整组，分页路由闲置 | Cards.cs:36-86；frontend/src/api/authoring.ts:365-381；CardsPage.cs:29-117；content/decks/aws-saa-c03.md 约 648 KB / 371 张 | 编辑和预览页改用 /cards/page（limit 200）或投影列表 + 按 id 取；未分页路由强制带 deckId | M | console |
| CBE-12 | P2 | 管理操作无审计（权限替换、回滚、migrate、reap） | Permissions.cs:56-59,87；DeckRollback.cs:83；PublishReaper.cs:66；Migrate.cs:129-191；VpcFunction.cs:85-95 | 每次管理变更发一条 {tag:'audit', actor, action, target, before, after}，同事务写入 append-only 的 admin_audit 表 | S | server |
| CBE-13 | P2 | super_admin 给已上线卡组改 slug，会让进度、发布和分析数据成孤儿 | Decks.cs:198；AdminDecks.cs:80；Worker/Repositories/ContentArtifactsRepository.cs:20；ContentIntelligence.cs:155；DeckEditPage.tsx:372-376 | 有过 SUCCESS 发布后返回 409 SLUG_LOCKED；AdminDecks 与 ContentArtifactsRepository 改用 deck_id 关联 | S | server |
| CBE-14 | P2 | Npgsql 大版本分裂：core-vpc/tests 用 10.0.0，worker 与 Shared 用 8.0.5 | RecallSmith.Lambda.Vpc.csproj:21；RecallSmith.Lambda.Db.csproj:10；RecallSmith.Lambda.Common.csproj:17；Worker csproj（无直接引用）；IntegrationTests.csproj:16 | Directory.Packages.props 统一版本，Worker 显式引用 | S | server |
| CBE-15 | P2 | Decks、Permissions、publish status/jobs、AdminDecks、Migrate 处理器无测试 | IntegrationTests 里 grep 不到 HandleAuthoringDecks/HandleAuthoringPermissions/HandlePublishStatus/HandleFetchPublishJobs/HandleAdminDecks/HandleDbMigrate/HandleDashboard；PublishMcqGateTests.cs:18；Publish.cs:339-346 无覆盖 | Testcontainers：Decks CRUD + editor 字段过滤、批量权限回滚、SQS 失败 -> FAILED、并发两次发布 -> 一个任务 + 一个 409、最后一次接收 -> FAILED | M | server |
| CBE-16 | P2 | core-vpc 冷启动：128 MB、SnapStart hook 没启用、无 PC；console 首次请求最长约 6s | infra/modules/api/core_vpc.tf:11,14；VpcFunction.cs:17-20；docs/backend-architecture-review-2026-09-22.md:113（p-max 5 955 ms） | 在 prod alias 上 A/B 512 MB 和 SnapStart，比较 REPORT 的 Init Duration（与 AWS-21 合并） | S | infra |
| CBE-17 | P3 | worker 会重新获取 FAILED 任务；被 reap 的任务之后可能成功并改写 live_build_id | Worker/Repositories/JobRepository.cs:23-25,78-89；PublishReaper.cs:20-35 | 只获取 PENDING 或过期的 PROCESSING；reaper 写专门的 REAPED 状态，worker 见到就 ack 丢弃 | S | server |
| CBE-18 | P3 | AdminDecks 的 latestBuildId 是按 slug 最新的 SUCCESS，不是 live_build_id | AdminDecks.cs:75-83；DeckRollback.cs:83；frontend/src/api/authoring.ts:286 | 同时 select d.live_build_id 作为 liveBuildId 并渲染 | S | server |
| CBE-19 | P3 | 无人调用的 dashboard 必然 500 | Dashboard.cs:29-32,101；VpcFunction.cs:218 | 删掉 Dashboard.cs、路由和 RouteMetrics 标签 | S | server |
| CBE-20 | P3 | 数据层重复：Vpc/Db 的 Pg+DbUtil 第二个池、旧 src_C/Common 与 Public | src_C/Vpc/Db/Pg.cs:1-97；DbUtil.cs:1-73；SnapStartHooks.cs:67-73；src_C/Common/Auth.cs:66-68；src_C/RecallSmith.Lambda.csproj | Vpc/Db/* 指向 RecallSmith.Lambda.Db，删除副本、src_C/Common、Public C# 与根 csproj（即 E14） | S | server |
| CBE-21 | P3 | editor 无视卡组权限能看所有卡组的发布任务/状态 | PublishJobs.cs:13,22-34；PublishStatus.cs:13,26-38；Dashboard.cs:18,76-78 | 非 super_admin 按 can_read join admin_deck_permissions，与 Cards/Decks 一致 | S | server |
| CBE-22 | P3 | 状态码漂移：CONFIG_ERROR/VERSION_CONFLICT 返回 400，23514/23503 变成 500 | Helpers.cs:14-45；Cards.cs:349；Decks.cs:34,216-222；DeckRollback.cs:72；Publish.cs:354-357 | 23514/23503/22P02 -> 400 VALIDATION_ERROR，冲突 -> 409，配置错误 -> 503；editor 被过滤的字段返回 ignoredFields | S | server |
| CBE-23 | P3 | 客户端契约漂移：migrate ?reset=1 被忽略、bulkUpdatePermissions PUT -> 405、死函数 | frontend/src/api/admin.ts:83-94；Migrate.cs:129-191；authoring.ts:542-556,516,525,575；Permissions.cs:20-22 | 删 reset 按钮与 4 个死函数，或与服务端对齐（与 CFE-20/21 同批） | S | console |
| CBE-24 | P3 | 每个请求 2 行 info 日志（'boot' + request），publish 里有 [DEBUG] 日志 | VpcFunction.cs:51-61,85-95；Publish.cs:267,283,311-313,326,337 | boot 行移到构造函数；publish 追踪压成一个结构化事件或降到 Debug | S | server |
| CBE-25 | P3 | live CI 查询在全卡组窗口上没有 event_time 索引（规模上去后疑似有问题） | ContentIntelligence.cs:154-168；Migrations/001_init.sql:159-161；009_content_intelligence_events.sql:21 | user_progress_events(event_time) 加索引（或 BRIN），>90 天窗口走夜间 mart | S | server |

### 3.4 后端横切

- **客户端到服务端映射**（`frontend/src/api/*.ts`）。正常 20 个：fetchDecks、fetchDeckById、fetchDeckBySlug、createDeck、updateDeck、deleteDeck、listAdminDecks -> Decks.cs；fetchAdminDecksPage -> AdminDecks.cs；fetchCardsByDeck、createCard、updateCard、deleteCard -> Cards.cs；publishDeck -> Publish.cs；fetchPublishJobs -> PublishJobs.cs；fetchAdminManifest -> AdminManifest.cs；fetchContentIntelligence -> ContentIntelligence.cs；saveAdminDeckPermissionsBulk -> Permissions.cs POST /bulk；runMigrate -> Migrate.cs（reset 被忽略，响应形状不同）。坏的 2 个：listAdminUsers、createAdminUser（CBE-01）。死函数 4 个：fetchPermissions、updatePermission、bulkUpdatePermissions（PUT 得 405）、checkPublishJobStatus。类型漂移：PublishJob.createdAt 类型写成 number，服务端发的是 ISO timestamptz 字符串。
- **没有 console 调用方的服务端路由：** /authoring/cards/page、/authoring/dashboard、/admin/manifest/rebuild、/admin/decks/{id}/rollback、/admin/publish/reap、/admin/analytics/outbox/publish、/admin/analytics/content-intelligence/import、/admin/db/{create,recreate,netcheck,premium-state,rc-events,content-intelligence-demo}。所有恢复操作都要 curl + bearer token。
- **2026-09-22 架构评审文档在 console 路径上的状态。** 已完成：进程内 RS256 JWT 校验（2.1.1 代码侧）；SQS visibility 3700 s、DLQ maxReceiveCount 3、ReportBatchItemFailures 与传递接收计数（2.2.1-2.2.3，`queue.tf:12-15`、`WorkerFunction.cs:60-64`）；ESM 挂 alias、0 s batching window（2.2.5，`worker/function.tf:48-50`）；worker 内重建 manifest、live_build_id 与 rollback 路由（2.2.4）；网关限流（`gateway.tf:91-92`）；日志保留 90 天（`core_vpc.tf:3`）；EMF namespace DeveloperCards（`RouteMetrics.cs:42`）。
- **仍未完成：** 网关 authorizer 与路由拆分（`gateway.tf:62` 仍是 NONE）；常量时间 secret 比较与破坏性路由（2.1.3/2.1.10）；reserved concurrency 与 53300 -> 503（2.2.6）；CommandTimeout/RemainingTime（2.2.7）；SnapStart 或加内存（2.2.9）；scheduler（2.2.11：RouteMetrics 列了内部 action，但 VpcFunction 没有事件入口）；migrate lock_timeout + schema 版本门（2.4.3：42703 回退仍在 `ContentIntelligence.cs:356-360`、`PublishJobProcessor.cs:206-215`、`JobRepository.cs:95`）；body 上限与 slug 正则（2.5.9）；删除 `Vpc/Db/Pg.cs`、`DbUtil.cs` 和 `src_C/Common`（§3 'should'）。
- **data-module-review：** Authoring 里唯一用事务的多语句写是 Permissions bulk。卡片写都是单语句并由 `version = expectedVersion` 守护，没问题。薄弱点在约束立即生效的不变量（uq_cards_deck_order、把软删除行也算进去的 uq_cards_deck_uid）、手工维护的 total_cards、以及把 slug 当 join 键。
- **resilience-test-generation（发布）：** 已覆盖：重复投递与过期 PROCESSING（WorkerReceiveCountTests）、reaper 与 23505 -> 409（PublishReaperTests）。未覆盖：SQS 发送失败 -> FAILED；并发两次 POST；SUCCESS 之后 manifest 重建失败（只能靠 3700 s 后的重投自愈，`WorkerFunction.cs:85-90,115-120`）；最后一次接收失败 -> DLQ 且行卡在 PROCESSING；S3 上传超时。这些都进 CBE-15。
- **结构模式：** 每个 handler 都重复 RequireX、开连接、400 CONFIG_ERROR 块、try/catch + HandlePgError。一张小路由表加一个错误映射中间件，就能在一处修掉 envelope 漂移（CBE-22），审计日志（CBE-12）也就是一个 hook。
- **发布切分：** 除 CBE-01、11、23（console）和 CBE-16（infra）外都是纯服务端改动，不需要手机 binary。CBE-02/03/04/06 是杠杆最高的一组，合计约 2-3 天。

---

## §4 手机端（React Native），逐页

总览：69 个 Screen 文件，**22 个在生产导航图可达**：Splash、Welcome、AudienceSurvey、PermissionPrompt、5 个 tab（Home、Draw、SessionCard、Library、More）、DrawCeremony、DrawResult、SessionSummary、CardDetail、Profile、EditProfile、Settings、HelpFAQ、Paywall、SignIn、SignUp、ConfirmSignUp，以及 7 击才能进的 DebugMenu。其余 **47 个**是 mock、spec 壳、仅 debug 可达或孤儿（46 个 verdict=dead，另有 AudienceFilter 只能从 dead 的 TagExplorer 进入）。另有 V6ShellScreen/V6DataScreen/V6QuickNavBar 也是孤儿。可达的页面都不依赖 mock。

### 4.1 核心学习（mobile-core，24 行）

| 页面 | 文件（行） | 入口 | 结论 | 主要问题 | 发现 / 建议 |
|---|---|---|---|---|---|
| HomeScreen | mobile/src/screens/HomeScreen.tsx (1405) | Home tab，Splash 之后落地 | needs-work | 冷启动卡在远端 manifest 上并跑 2 次以上全量刷新；render 里 360 行 IIFE、没用上的 calendar memo、隐藏测试探针；AWS/Claude 封面带黑边 | MCORE-05(P1)、06、15、17、23 |
| SessionCardScreen | mobile/src/screens/SessionCardScreen.tsx (1231) | Review tab、Home CTA、Library sweep、CardDetail | needs-work | 翻卡面已修（不截断）；切卡不回顶、tab 栏常驻、MCQ dock 过高、加载失败无重试 | MCORE-03、04、11、12、13、14、15、20、21 |
| SessionSummaryScreen | mobile/src/screens/SessionSummaryScreen.tsx (577) | 最后一次评分后 navigation.replace | polish | loading/error/empty 与奖励 CTA 齐全；大量 numberOfLines，大字号下会截断 | MCORE-15 |
| DeckScreen | mobile/src/screens/DeckScreen.tsx (597) | 不可达（没有 navigate('Deck')，无 deep link） | dead | 旧安装门；有空操作的权益检查和未捕获的 fetchPremiumDeckUrl 路径 | **删除**（MCORE-18） |
| CardDetailScreen | mobile/src/screens/CardDetailScreen.tsx (546) | Library 点卡；deep link card/:cardId | broken | 题目放在固定 260x364 overflow-hidden 的 hero 里，约 96% 的 AWS/Claude 题被截；不显示答案；掌握阈值错；无 loading | MCORE-01(P0)、08、09、19；MSHELL-18 |
| LibraryScreen | mobile/src/screens/LibraryScreen.tsx (430) | Library tab；deep link library | needs-work | 有 keyExtractor 的 FlatList；每次回到页面全屏 spinner，滚动位置丢失；无 getItemLayout；一个坏卡组清空卡组切换器 | MCORE-07(P1)、13、16 |
| ChallengeScreen | mobile/src/screens/ChallengeScreen.tsx (363) | 不可达（只在 mainTabs 高亮里被引用） | dead | 路线预览插页，被 Home CTA 和 Review tab 绕过 | **删除** |
| LevelScreen | mobile/src/screens/LevelScreen.tsx (503) | 只在 mock 链里 | dead | 基于 buildMockSessionCards 的完整会话 UI，最后进 Settlement 发 mock 奖励 | **删除** |
| DailyDoseScreen | mobile/src/screens/DailyDoseScreen.tsx (62) | 不可达 | dead | 静态 MOCK_DAILY_DOSE，靛蓝配色 | **删除** |
| TagExplorerScreen | mobile/src/screens/TagExplorerScreen.tsx (58) | 只经 CardDetail 的 0x0 探针和 mock 链 | dead | mock TAG_BREAKDOWN，每行都打开硬编码的 'card-1' | **删除**（连同 MSHELL-18 探针） |
| SortFilterScreen | mobile/src/screens/SortFilterScreen.tsx (69) | 不可达 | dead | 不能点的 chips；'Apply filters' 只是跳到 Library | **删除** |
| CoachOverlayScreen | mobile/src/screens/CoachOverlayScreen.tsx (31) | 不可达 | dead | 设计笔记占位；真实的 MCQ 引导在 McqCoachLine | **删除** |
| BottomTabBar | mobile/src/components/BottomTabBar.tsx (99) | Home/Draw/SessionCard/Library/More 全局 | polish | 没有 accessibilityRole/selected，glyph 会被朗读；复习中常驻，占空间 | MCORE-04、14；MSHELL-08 |
| ParchmentScaffold | mobile/src/components/ParchmentScaffold.tsx (276) | 只有 mock Plan* 页在用 | ok | 原语本身没问题 | Plan* 删除后没有消费者，一并删除 |
| CodeBlock | mobile/src/components/CodeBlock.tsx (368) | ReviewBody/McqReviewBody 答案区 | polish | 每次 render 都重新分词；VoiceOver 把行号和代码交错读出 | MCORE-21 |
| ReviewBody（翻卡面） | mobile/src/features/gacha/components/ReviewBody.tsx (423) | 非 MCQ 卡 | ok | v4 不截断题目，答案上方保留回顾；未 memo；翻开时没有触觉和播报 | MCORE-20、21 |
| McqReviewBody | mobile/src/features/gacha/components/McqReviewBody.tsx (729) | MCQ 卡（每轮最多 2 张） | needs-work | radio/checkbox 的 a11y 与 AA 配色好；选项阶段题干截 3 行，AWS 题的问句和限定词被藏住 | MCORE-02 |
| review/model.ts（冻结） | mobile/src/review/model.ts (225) | SessionCard 用的调度器 | ok | 只读；阶梯清晰、horizon 有夹逼；掌握阈值在 constants.ts，CardDetail 没用它 | 不改 |
| review/storage.ts | mobile/src/review/storage.ts (770) | 所有卡组/进度读与评分写 | polish | 每次评分整数组写入；每次 loadDeckProgress 读都无条件写 deck-meta | MCORE-11、22 |
| review/progressScope.ts | mobile/src/review/progressScope.ts (8) | 进度 key 作用域 | ok | 简单的 user/anon 作用域 helper | - |
| content/deckRepository.ts 读路径（冻结） | mobile/src/content/deckRepository.ts (1707) | 所有读卡组的页面 | needs-work | resolveDeckBySlug 每次调用都重读并 JSON.parse 整组，无 memo；更新检查远端优先，6s 超时 | MCORE-05、10（在非冻结的包装层解决，不改本文件） |
| content/activeDeck.ts | mobile/src/content/activeDeck.ts (36) | 所有页面 | ok | AsyncStorage 上的内存缓存 active slug | - |
| content/deckShortTitle.ts | mobile/src/content/deckShortTitle.ts (21) | Home tile、session header | ok | 窄位置用的精确 slug 短标题 | - |
| content/contentConfig.ts | mobile/src/content/contentConfig.ts (6) | 无引用 | dead | 指向 dev S3 桶的无用常量 | **删除** |

### 4.2 抽卡/经济/付费（mobile-gacha，23 行）

| 页面 | 文件（行） | 入口 | 结论 | 主要问题 | 发现 / 建议 |
|---|---|---|---|---|---|
| DrawScreen | src/screens/DrawScreen.tsx (1109) | Draw tab；deep link draw/:slug | needs-work | 选包 + 抽卡事务；切卡组整屏 spinner、await 串行、draw_committed 同步撞进仪式、隐藏测试探针；需要拆分 | MGACHA-03、13、19、20 |
| DrawCeremonyScreen | src/screens/DrawCeremonyScreen.tsx (822) | DrawScreen open() -> navigate('DrawCeremony') | needs-work | 相位靠 JS setTimeout/setState/effect；cue 从 effect 触发；跳过的玩家永远解锁不了快进；LEG 成功触觉丢失；需要拆分 | MGACHA-05、07、08、09、18、19 |
| DrawResultScreen | src/screens/DrawResultScreen.tsx (882) | DrawCeremony replace；deep link result/:slug | polish | 能用；'Pokedex' 商标文案；详情弹窗 3 行；剩余次数口径不一致；882 行应拆成 featured/strip/grid/modal | MGACHA-14、15、21、19；MSHELL-04 |
| SettlementScreen | src/screens/SettlementScreen.tsx (346) | 线上 UI 不可达（completionRoute 'settlement' 从未传入） | dead | 渲染 mock 卡和评分，不接真实钱包和账本 | **删除**（MGACHA-22） |
| FreePullGrantScreen | src/screens/FreePullGrantScreen.tsx (52) | 不可达（StreakMilestone mock 链） | dead | 声称 '+N pulls'，什么也不发 | **删除** |
| FreePullInventoryScreen | src/screens/FreePullInventoryScreen.tsx (54) | 不可达 | dead | 硬编码 12 ready / 2 reserve | **删除** |
| PaywallScreen | src/screens/PaywallScreen.tsx (445) | Settings、Home、Deck、SessionCard 试用 upsell | needs-work | 价格加载失败没有重试且隐藏订阅按钮；pending 当失败；premium 状态闪烁；生产构建拒绝 sandbox 权益 | MGACHA-04、17、25 |
| ceremony/StageCanvas | src/components/ceremony/StageCanvas.tsx (414) | DrawCeremony 全部相位（skia） | broken | 时钟取模导致粒子每 14s 重放；rays、时钟和 120-quad RSXform worklet 在整个页面生命周期内每帧重绘 | MGACHA-01(P1)、11 |
| ceremony/PackTear | src/components/ceremony/PackTear.tsx (333) | swipe..tear-flip | ok | GH Pan 在 UI 线程驱动撕口，canvas 已 memo | - |
| ceremony/TapCard | src/components/ceremony/TapCard.tsx (282) | cards-on-table | polish | 翻面在 UI 线程且已 memo；稀有度音效早于视觉揭示；FoilLayer 拿不到 LUT；slot 阴影在 3D 中动画 | MGACHA-07、10、12、23 |
| ceremony/FoilLayer | src/components/ceremony/FoilLayer.tsx (93) | RAR/LEG 聚焦卡 | dead | SkSL 分支不可达（没人传 lut），只渲染渐变回退；prewarm 白编译 | MGACHA-10：传 LUT 实测，不行就删 |
| ceremony/FallbackStage | src/components/ceremony/FallbackStage.tsx (142) | kill switch / 无 Skia | ok | 纯 RN 回退；responder 路径每次 touch move 重渲，但只在 kill switch 下跑 | - |
| ceremony/FeaturedCard | src/components/ceremony/FeaturedCard.tsx (72) | tapFlow 关闭时 | ok | 真机上实际用不到（有动效就开 tapFlow） | - |
| ceremony/SpillSampler | src/components/ceremony/SpillSampler.tsx (50) | 多抽 tear-flip | polish | 测试契约组件，在最忙的阶段跑 100 ms setInterval 重渲 | MGACHA-24 |
| ceremony/SwipeHint | src/components/ceremony/SwipeHint.tsx (67) | swipe 相位 | ok | UI 线程提示，对 a11y 隐藏，首次触摸即卸载 | - |
| ceremony/useCeremonyTimeline | src/components/ceremony/useCeremonyTimeline.ts (448) | DrawCeremony | needs-work | 相位到目标值的表是对的，但动画要等每次 JS 定时器换相后的 React effect 才启动 | MGACHA-05 |
| reanimatedGuard + imagePrefetch + ceremonyStyles | src/components/ceremony/reanimatedGuard.ts (563) | ceremony 引用 | ok | 受保护的 require 与回退没问题；预取只热了 RN 的缓存，没热 Skia 的 useImage | - |
| ceremonyAudio | src/components/ceremonyAudio.ts (373) | DrawScreen 预热、DrawCeremony cue | needs-work | 已预热、有池；bed 仍靠非无缝的 AVPlayer seek+play 循环；hit 是异步 seek 再同步 play；淡入淡出用 JS setTimeout；没有静音开关，不尊重静音键 | MGACHA-02、06、16 |
| ceremonyHaptics | src/components/ceremonyHaptics.ts (123) | DrawCeremony、TapCard | polish | 每秒 3 次的滚动限流吞掉 LEG 单抽的 Success | MGACHA-08 |
| features/gacha/draw（drawCommit 等） | src/features/gacha/draw/drawCommit.ts (2400) | Draw/DrawCeremony/DebugMenu | polish | commit 原子且可重放；每抽重新解析卡组文件并重写最多 50 条完整 ownedBefore 历史；perf report 缺计时器延迟数据 | MGACHA-13、18 |
| features/gacha/rewards | src/features/gacha/rewards/rewardWallet.ts (1317) | Draw、SessionCard、Home、sync | ok | 写顺序是刻意的；AsyncStorage 读改写没有 mutex，但没找到活跃竞态 | 以后加单一串行钱包队列 |
| settlementVm + constants/contracts | src/features/gacha/settlement/settlementVm.ts (191) | 只经 dead 的 Settlement/Level | dead | 只服务 mock 结算流程 | **删除** |
| premium（premiumStore、revenuecat、trialDialogs） | src/premium/revenuecat.ts (629) | Paywall、卡组门控、登录 | needs-work | 生产构建把 sandbox 权益当无效，影响 App Review 和 TestFlight 购买；premium hook 初值 false 导致闪烁 | MGACHA-04、25；MACCT-17 |

### 4.3 账号/设置（mobile-account，29 行）

| 页面 | 文件（行） | 入口 | 结论 | 主要问题 | 发现 / 建议 |
|---|---|---|---|---|---|
| SplashScreen | mobile/src/screens/SplashScreen.tsx (65) | initialRouteName（App.tsx:192） | ok | 按 onboarding 阶段路由，有安全回退；原生白色 splash 与羊皮纸 JS splash 之间有闪色 | MSHELL-13 |
| WelcomeScreen | mobile/src/screens/WelcomeScreen.tsx (184) | stage=welcome | polish | 单页欢迎；没有"已有账号"入口，换设备的老用户从匿名开始 | MACCT-18 |
| SignInScreen | mobile/src/screens/SignInScreen.tsx (300) | Settings > Account / Reminders 'Sign in' | needs-work | 无找回密码；未确认账号是死路；无 AutoFill；'already signed in' 时静默弹回 | MACCT-02、03、12、16 |
| SignUpScreen | mobile/src/screens/SignUpScreen.tsx (263) | SignIn > Create an account | needs-work | 只校验 8 位以上，池子还要求大写、小写、数字、符号；显示原始 Cognito 错误；靛蓝配色 | MACCT-11、12、23 |
| ConfirmSignUpScreen | mobile/src/screens/ConfirmSignUpScreen.tsx (248) | 只能从 SignUp replace 进入 | needs-work | 只在注册后立刻可达；无 autoSignIn，要重输密码；无 oneTimeCode 自动填充 | MACCT-03、12、23 |
| AudienceSurveyScreen | mobile/src/screens/AudienceSurveyScreen.tsx (165) | Welcome > Continue | polish | 能用并设置权限提示标记；选项无 selected 状态；词汇与 Settings/Profile 不一致 | MACCT-21、24；MSHELL-09 |
| AudienceFilterScreen | mobile/src/screens/AudienceFilterScreen.tsx (57) | TagExplorer（dead） | broken | 基于 FILTER_META 的 mock，'Apply focus' 只跳 Library，什么也不应用 | **删除**（MACCT-24） |
| PermissionPromptScreen | mobile/src/screens/PermissionPromptScreen.tsx (155) | 首次 DrawResult 'Done'（一次性） | needs-work | 时机选得好；运算符优先级 bug 把 'denied' 映射成 'granted'；文案承诺了不存在的 Settings 开关 | MACCT-06、08、09 |
| SettingsScreen | mobile/src/screens/SettingsScreen.tsx (494) | Me > Settings | needs-work | 真实的删号和 audience chips；提醒和外观只读；每次聚焦全屏 spinner；7 击调试门；重置文案误导 | MACCT-06、13、14、15、21；MGACHA-16 |
| SettingsMainScreen | mobile/src/screens/SettingsMainScreen.tsx (77) | 不可达（只被自己的子页链接） | dead | SettingsScreen 的重复实现，渲染 SETTINGS_SNAPSHOT mock | **删除**（MACCT-22） |
| SettingsAppearanceScreen | mobile/src/screens/SettingsAppearanceScreen.tsx (38) | 不可达 | dead | spec 壳，无控件 | **删除** |
| SettingsAudienceScreen | mobile/src/screens/SettingsAudienceScreen.tsx (37) | 不可达 | dead | mock audience 值 | **删除** |
| SettingsNotificationsScreen | mobile/src/screens/SettingsNotificationsScreen.tsx (37) | 不可达 | dead | mock 08:00 与产品没有的免打扰 | **删除** |
| SettingsPoolsScreen | mobile/src/screens/SettingsPoolsScreen.tsx (37) | 不可达 | dead | mock pool 列表（AWS 显示 'paused'），硬编码 csharp PoolOverview 链接 | **删除** |
| MoreScreen | mobile/src/screens/MoreScreen.tsx (171) | Me tab | ok | 真实 streak/收集统计，行有 a11y role；Notion 链接在 3 个文件重复；版本号读自打包的 app.json 而非 OTA id | MSHELL-07、25；MACCT-19 |
| ProfileScreen | mobile/src/screens/ProfileScreen.tsx (90) | Me > Profile | polish | 已是真实 streak 数据；显示原始 audience key（'all'）；唯一的 CTA 打开假的 EditProfile | MACCT-07、24 |
| EditProfileScreen | mobile/src/screens/EditProfileScreen.tsx (34) | Me > Profile > Edit profile | broken | 硬编码假字段（'Learner #local'、'Parchment sigil'、'Both'），不可编辑 | **删除**（MACCT-07） |
| AboutScreen | mobile/src/screens/AboutScreen.tsx (37) | 不可达 | dead | 内部 spec 文案（'DeveloperCards mobile v6 candidate build'） | **删除** |
| HelpFAQScreen | mobile/src/screens/HelpFAQScreen.tsx (32) | Me > Help | ok | 内容准确；'Back to me' 用 navigate('More') | MSHELL-01 的修法一并覆盖 |
| DebugMenuScreen | mobile/src/screens/DebugMenuScreen.tsx (435) | 生产：Settings 版本号 7 击 | needs-work | 钱包灌数只在 __DEV__，但 'Reset all progress/Everything' 和 dev 壳在生产可达 | MACCT-14；MSHELL-22 |
| AppInfoScreen（组件） | mobile/src/components/AppInfoScreen.tsx (207) | More/Profile/Help/Debug 与 spec 页共用 | polish | 布局统一；按钮没有 accessibilityRole；不可点的行看起来可点 | MACCT-21；MSHELL-07 |
| auth/amplify.ts | mobile/src/auth/amplify.ts (32) | App.tsx:94 模块加载时 | polish | Amplify 默认 AsyncStorage 存 token（不是 Keychain） | MACCT-10、25 |
| auth/authStore.ts | mobile/src/auth/authStore.ts (338) | 全局 store | needs-work | 会话只在冷启动和登录时读，token 会过期；删号只删 Cognito；无重置密码/确认路由；生产打印错误 dump | MACCT-01、04、05、11、16、17、25 |
| auth/AuthGateModal.tsx | mobile/src/auth/AuthGateModal.tsx (149) | 无引用 | dead | 未使用的 modal，配色不统一 | **删除** |
| notifications/reminders.ts | mobile/src/notifications/reminders.ts (301) | Home/SessionCard 调 syncDailyReminders | needs-work | 调度正确；setReminderPrefs 从未被调用；早间通知不管有没有到期卡每天都发 | MACCT-06、08 |
| config/appEnv.ts | mobile/src/config/appEnv.ts (33) | content API | ok | 生产优先的 env 解析 | - |
| config/featureFlags.ts | mobile/src/config/featureFlags.ts (127) | useFeatureFlags | ok | 默认值与校验扎实；注释说 S3，实际来自 GitHub raw | 随 MACCT-20 改注释 |
| config/forceUpdateGate.ts | mobile/src/config/forceUpdateGate.ts (68) | App.tsx:159 | ok | 非阻塞遮罩 + last-good 缓存，设计好 | - |
| config/remoteConfig.ts | mobile/src/config/remoteConfig.ts (181) | forceUpdateGate | polish | 网络优先、缓存回退；指向个人 GitHub raw URL；遮罩显示 dev 提示 | MACCT-20；MSHELL-06、22 |

### 4.4 壳/导航/小页面（mobile-shell，43 行）

30 个小页面全部不可达或仅 debug 可达，统一建议**在 1.7.0 删除**（MSHELL-03）。标"以后重做"的，是指将来在真实数据上**另立需求**，不保留现有代码。

| 页面 | 文件（行） | 入口 | 结论 | 主要问题 | 建议 |
|---|---|---|---|---|---|
| AchievementsScreen | mobile/src/screens/AchievementsScreen.tsx (44) | 不可达（ProfileScreen.tsx:83-85 故意断开） | dead | mock MILESTONE_HALL，硬编码徽章 | 删除；以后基于真实 streak/milestone 数据重做 |
| BacklogBurstScreen | mobile/src/screens/BacklogBurstScreen.tsx (50) | 只从孤立的 BacklogWarning 进 | dead | mock BURST_SESSION，带硬编码 csharp 参数推 Settlement | 删除 |
| BacklogWarningScreen | mobile/src/screens/BacklogWarningScreen.tsx (50) | 无引用 | dead | mock 计数与设计笔记文案 | 删除 |
| CollectionMilestoneScreen | mobile/src/screens/CollectionMilestoneScreen.tsx (45) | 只经 SettlementScreen:203 | dead | 'phase-A ceremony' dev 文案 | 删除 |
| DailyDigestScreen | mobile/src/screens/DailyDigestScreen.tsx (52) | 只在 FreePullInventory mock 链；没有通知响应处理 | dead | mock DIGEST_BY_DAY，打开硬编码 'csharp' 的 Level | 删除；提醒点击路由由 MSHELL-19 直达 SessionCard |
| DormantNudgeScreen | mobile/src/screens/DormantNudgeScreen.tsx (52) | 无引用 | dead | mock 'days away' | 删除 |
| ErrorGenericScreen | mobile/src/screens/ErrorGenericScreen.tsx (34) | 仅 debug | dead | 把设计 spec 文字当 UI | 删除；由 MSHELL-12 的逐屏 boundary 替代 |
| ErrorNetworkScreen | mobile/src/screens/ErrorNetworkScreen.tsx (35) | 仅 debug | dead | 只有 spec 文案，背后没有连通性检测 | 删除；由 MSHELL-11 真实离线横幅替代 |
| FreshStartConfirmScreen | mobile/src/screens/FreshStartConfirmScreen.tsx (60) | 不可达 | dead | 'Confirm' 什么也不重置 | 删除 |
| FreshStartLandingScreen | mobile/src/screens/FreshStartLandingScreen.tsx (53) | 不可达 | dead | 背后没有重置功能 | 删除 |
| MasteredCelebrationScreen | mobile/src/screens/MasteredCelebrationScreen.tsx (40) | 只经 Settlement | dead | v6 壳 dev 文案，无动画 | 删除 |
| MasteryMilestoneScreen | mobile/src/screens/MasteryMilestoneScreen.tsx (45) | 只经 Settlement | dead | phase-A dev 文案 | 删除 |
| MilestoneDetailScreen | mobile/src/screens/MilestoneDetailScreen.tsx (69) | 只经 MilestoneHall | dead | mock MILESTONE_DETAILS，把原始 milestone id 当统计显示 | 删除 |
| MilestoneHallScreen | mobile/src/screens/MilestoneHallScreen.tsx (88) | 不可达 | dead | 硬编码徽章；真实数据在 features/gacha/milestones | 删除；与 Achievements 一起以后重做 |
| MonthRewindScreen | mobile/src/screens/MonthRewindScreen.tsx (50) | 不可达 | dead | 静态 REWIND_SLIDES | 删除 |
| MonthSummaryScreen | mobile/src/screens/MonthSummaryScreen.tsx (50) | 无引用 | dead | 与 MonthRewind 同一份 mock | 删除 |
| OfflineBannerScreen | mobile/src/screens/OfflineBannerScreen.tsx (34) | 仅 debug | dead | 一整屏描述一个不存在的横幅 | 删除；MSHELL-11 |
| PausedPoolScreen | mobile/src/screens/PausedPoolScreen.tsx (49) | 不可达 | dead | 永远显示 aws 已暂停，没有暂停功能 | 删除 |
| PlanMonthScreen | mobile/src/screens/PlanMonthScreen.tsx (69) | 不可达 | dead | mock 热力图；真实负载预测在 features 里但没接 | 删除 |
| PlanOverviewScreen | mobile/src/screens/PlanOverviewScreen.tsx (96) | 不可达 | dead | 规划器入口，基于 mock | 删除；只有接上 scheduler forecast 才值得以后重做 |
| PlanTodayScreen | mobile/src/screens/PlanTodayScreen.tsx (71) | 不可达 | dead | 'Start session' 打开 mock Level | 删除 |
| PlanWeekScreen | mobile/src/screens/PlanWeekScreen.tsx (81) | 不可达 | dead | mock 柱状图，目标不持久化 | 删除 |
| PoolLaunchScreen | mobile/src/screens/PoolLaunchScreen.tsx (55) | 无引用 | dead | 'Day-15 expansion' spec 文案 | 删除 |
| PoolOverviewScreen | mobile/src/screens/PoolOverviewScreen.tsx (81) | 实际不可达（只经 CardDetail 隐藏探针） | dead | mock POOL_OVERVIEW | 删除 |
| PoolPickerScreen | mobile/src/screens/PoolPickerScreen.tsx (51) | 无引用 | dead | 传一个 HomeScreen 已不再读取的 mockState | 删除，并删 types.ts:18 mockState |
| StreakMilestoneScreen | mobile/src/screens/StreakMilestoneScreen.tsx (42) | 只经 MilestoneHall | dead | 声称是真 B-system 路由，但什么也不发 | 删除 |
| ToastHostScreen | mobile/src/screens/ToastHostScreen.tsx (35) | 无引用 | dead | 记录 toast 变体，背后没有 toast 系统 | 删除 |
| WeekPlannerPromptScreen | mobile/src/screens/WeekPlannerPromptScreen.tsx (53) | 不可达 | dead | 'Save and go home' 什么也不存 | 删除 |
| WeekStreakMilestoneScreen | mobile/src/screens/WeekStreakMilestoneScreen.tsx (42) | 不可达 | dead | 静态 'Wk N' 仪式壳 | 删除 |
| WeekSummaryScreen | mobile/src/screens/WeekSummaryScreen.tsx (67) | 无引用 | dead | 硬编码 STATS（26 reviewed、Wk 2） | 删除 |
| App shell | mobile/App.tsx (344) | root | needs-work | 70 路由单一 native stack，自定义 tab 栏在 navigator 外；tab 点击会 push；薰衣草壳色；每次导航重渲染 | MSHELL-01(P1)、12、17、20、21、24 |
| navigation/linking.ts + mainTabs.ts + types.ts | mobile/src/navigation/linking.ts (16) | recallsmith:// | polish | 只有 5 个自定义 scheme 路由，无 universal link；冷启动 deep link 跳过 Splash/onboarding；类型里有死参数 | MSHELL-19 |
| BottomTabBar | mobile/src/components/BottomTabBar.tsx (99) | 5 个 tab 路由 | needs-work | 无 role/state/label；glyph 被朗读；route 类型是 string 并通过无类型的 navigate push | MSHELL-08、01 |
| RootErrorBoundary | mobile/src/components/RootErrorBoundary.tsx (69) | 包住整个 app | polish | 唯一的 boundary；只 console.error；重试把 navigator 重挂回 Splash | MSHELL-02、12 |
| SplashScreen（启动路径） | mobile/src/screens/SplashScreen.tsx (65) | 初始路由 | polish | 白色原生 splash 之后再来一个 JS splash；一次 AsyncStorage 读后 replace；没有 expo-splash-screen hold | MSHELL-13 |
| theme tokens | mobile/src/theme/colors.ts (37) | - | needs-work | 有 token，但 UI 里有 610 个 hex 字面量、94 种颜色；羊皮纸、粉彩、旧薰衣草/靛蓝三套混用 | MSHELL-17；MCORE-23 |
| app.json / eas.json | mobile/app.json (58) | - | polish | 有图片分享却没有 NSPhotoLibraryAddUsageDescription；白色 splash；无 associatedDomains；默认更新策略；eas.json 里有 c++17 env 覆盖 | MSHELL-04、13、19；AWS-16 |
| package.json 依赖 | mobile/package.json (73) | - | polish | Expo 54.0.30 / RN 0.81.5 / Reanimated 4.1.7 / Skia 2.2.12；rxjs 未使用；没有 Sentry/NetInfo/splash-screen；没有 lint 脚本 | MSHELL-14 |
| api/apiClient.ts | mobile/src/api/apiClient.ts (78) | progressSync/drawStateSync | polish | 原始响应文本当 Error message；对象错误变成 '[object Object]'；无重试、无错误分类 | MSHELL-10 |
| config/forceUpdateGate + remoteConfig | mobile/src/config/forceUpdateGate.ts (68) | App 挂载 | polish | 非阻塞、last-good 缓存（好）；来自 raw.githubusercontent.com，只在冷启动拉取 | MSHELL-06、22 |
| sync/clientCapabilities.ts（非冻结） | mobile/src/sync/clientCapabilities.ts (83) | 进度 push | ok | 每次 push 带 updateId/features，有缓存，从不抛错；是服务端唯一类似遥测的信号 | - |
| tests + CI | mobile/vitest.config.ts (36) | CI mobile job | polish | 103 个单元 + 49 个集成 suite + tsc；没有 ESLint/expo-doctor/bundle export；约 1.4k 行测试在钉 mock 壳 | MSHELL-15 |

### 4.5 死页面处理结论

- **1.7.0 全部删除（47 个 Screen + 相关模块）**：核心区 Deck、Challenge、Level、DailyDose、TagExplorer、SortFilter、CoachOverlay、contentConfig.ts；抽卡区 Settlement、FreePullGrant、FreePullInventory、settlementVm；账号区 SettingsMain 及 4 个子页、About、AudienceFilter、EditProfile（可达但全是假数据）、AuthGateModal；壳区 30 个小页面；外加 V6ShellScreen/V6DataScreen/V6QuickNavBar、`src/mock`、`types.ts:18 mockState`、CardDetail 隐藏探针（MSHELL-18）以及钉住它们的测试（约 7 个 suite，约 1.4k 行）。
- **理由：** 这些页面都跑在 mock 上。任何一次误接的 navigate() 都会把编造的数字、'+3 pulls' 这类不发放的承诺、假的免打扰设置暴露给用户，这正是 App Review 2.1 占位内容风险。删掉还能减少打包时对约 75 个 screen 模块的 eager import。
- **以后另立需求重做（不保留代码）：** Achievements/MilestoneHall（接 `features/gacha/milestones` 的真实数据）、PlanOverview/PlanMonth（接 scheduler forecast）、离线提示与通用错误页（由 MSHELL-11 NetInfo 横幅和 MSHELL-12 逐屏 boundary 取代）。
- **FoilLayer（组件，dead）：** 先在 G42 里传 `lut={FOIL_LUT}` 做真机实测，掉帧就连同 prewarm 一起删掉（MGACHA-10）。

### 4.6 P0/P1 详情（手机端 12 条）

**MCORE-01（P0，CONFIRMED）CardDetail hero 固定 260x364 且 overflow hidden，长题被截**
- 证据：`mobile/src/screens/CardDetailScreen.tsx:276-284`（题目 slab 在 hero 内，注释却说完整渲染），`:410-418`（width 260、aspectRatio 5/7、justifyContent flex-end、overflow hidden），`:440-442`（art 窗口 minHeight 110），`:481`；`content/decks/aws-saa-c03.md` 371 题中 367 题题干 >130 字符（p50 270，最长 550）；`content/decks/claude-ccdv-f.md` 441 题中 427 题 >130 字符（p50 214）。
- 影响：owner 报告的"题目显示不全"在 Library -> 卡片路径上仍在。slab 大约只放得下 6 行（约 130 字符），几乎每道 AWS/Claude 题都被截，Dynamic Type 调大更糟。复核：在 flex-end 下先被裁的是 chips 和 art，题干超过约 280 字符时开头也被裁，大约是一半的 AWS 题。
- 修复：hero 只放 art + chips，完整题目作为正常流文本放在 hero 下方（不固定高度、不 overflow）；或者去掉 aspectRatio/overflow 让卡片随内容长高。加一个 550 字符题干的渲染测试。S，OTA。**需要真机验证。**

**MCORE-05（P1，CONFIRMED）Home 冷启动等远端 manifest（6s 超时）并跑 2 次以上全量刷新**
- 证据：`mobile/src/screens/HomeScreen.tsx:340-351`（focus 刷新），`:352-369`（forceProgressSync 后挂载时再刷一次），`:497-518`（首次刷新前一直 spinner），`:867-871`（点包 = 全量刷新）；`src/features/gacha/home/deckActionResolver.ts:110`（先 await loadDeckUpdates），`:129-162`（逐卡组串行 resolve + progress）；`src/content/deckRepository.ts:463`、`:1424-1426`（远端优先 manifest），`:149`（6_000 ms）。
- 影响：弱网下 Home 最长约 6s 显示 'Loading home...'，每次刷新都串行重解析三个卡组；选包高亮也要等一次网络往返。
- 修复：先用缓存的 manifest 和本地卡组构建 VM，后台再拉更新；多次刷新合并成一个 in-flight promise；选 tile 改为本地状态变更，重建 VM 不做 I/O。M，OTA。**真机弱网验证。**

**MCORE-07（P1，CONFIRMED）Library 每次回到页面都把网格换成全屏 spinner，滚动位置丢失**
- 证据：`mobile/src/screens/LibraryScreen.tsx:94`（每次 refresh setLoading(true)），`:152-164`（聚焦 1.5s 后刷新），`:256-274`（spinner 分支卸载 FlatList）。
- 影响：浏览 371/441 张的卡组，点开一张再返回，就闪一次 spinner 并回到顶部，每看一张卡都丢一次位置。
- 修复：只在还没有卡组时显示全屏 spinner，之后静默刷新（stale-while-revalidate），FlatList 保持挂载。S，OTA。

**MGACHA-01（P1，CONFIRMED）卡桌上的粒子每 14s 重放一次（时钟取模回绕）**
- 证据：`src/components/ceremony/StageCanvas.tsx:276-287`（clock withRepeat 0->14000），`:290-296`（burstAt），`:308-313`（elapsed = (clock-burstAt+14000)%14000），`:398-400`；`src/screens/DrawCeremonyScreen.tsx:705-717`（每个相位都挂 StageCanvas）。
- 影响：十连翻卡很容易超过 14s，金色 plus 混合的火花每 14s 重放一次，看起来像动画故障。
- 修复：burst 改为一次性，用专门的 progress 值在 reaction 里 withTiming(0->lifeMs)，去掉取模，或在第一次回绕后把 elapsed 夹到 life 以上；settle 之后卸载 Atlas。S，OTA。**真机验证。**

**MACCT-01（P1，CONFIRMED）删号只删 Cognito 用户，服务端仍保留邮箱、进度、卡片和钱包**
- 证据：`mobile/src/auth/authStore.ts:311-328`；`mobile/src/features/gacha/settings/account/AccountSection.tsx:18-19`；`src_C/Vpc/Runtime/DrawStateSync.cs:176-183,206,247,294`；`src_C/Vpc/Runtime/ProgressEvents.cs:400`；`src_C/Public/CognitoAdmin/DeleteUser.cs:18`（TODO 桩）。
- 影响：删号后 RDS 里 users（含邮箱）、user_draw_*、user_wallet、user_progress_events 仍在，不满足 Guideline 5.1.1(v) 的"删除关联数据"，也不符合隐私法预期；文案也没提醒有效订阅会继续扣费。
- 修复：新增需认证的 `DELETE /api/v1/me`，按 user_sub 级联删除（server，Wave F F15），`deleteAccountNow` 在调 Cognito deleteUser 之前先调它（OTA，G08）；加一句提示去 App Store 取消订阅。M，server + OTA。**真机验证。**

**MACCT-02（P1，CONFIRMED）没有任何找回密码流程**
- 证据：`mobile/src/screens/SignInScreen.tsx:106,113,175-187`（只有 Continue / Create account）；`mobile/src/auth/authStore.ts:4-13`（没 import resetPassword），`262-264`；`infra/modules/identity/cognito.tf:99`（已配置 verified_email 找回）。
- 影响：页面承诺"account recovery"却没有重置路径，忘记密码就丢掉同步进度；加上每 5 天掉登录（MACCT-04），问题更严重。
- 修复：新增 ForgotPassword 页，用 aws-amplify/auth 的 resetPassword + confirmResetPassword，从 SignIn 链接进入。纯 JS，可走 OTA。M。**真机验证（收邮件）。**

**MACCT-03（P1，CONFIRMED）注册未确认就是死路：登录只显示一段文字，重新注册又失败**
- 证据：`mobile/src/auth/authStore.ts:255-260`；`mobile/src/screens/SignInScreen.tsx:63-70`；`mobile/src/screens/SignUpScreen.tsx:45`（ConfirmSignUp 唯一入口）。
- 影响：用户输入验证码前离开，登录时提示"去确认验证码"，却没有输入入口；重新注册抛 UsernameExists，这个邮箱就卡死了。
- 修复：遇到 CONFIRM_SIGN_UP / UserNotConfirmedException，以及注册时遇到 UsernameExistsException，调用 resendSignUpCode 并带邮箱跳到 ConfirmSignUp。S，OTA。

**MACCT-04（P1，CONFIRMED，= AWS-08）mobile refresh token 只有 5 天且不轮换，用户会被静默登出**
- 证据：`infra/modules/identity/cognito.tf:159,162-166`（refresh_token_validity=5 days，无 rotation）；`mobile/src/auth/authStore.ts:127,156-172`（刷新失败直接变成 'anonymous'，不提示）。
- 影响：每个登录用户最迟 5 天就变回匿名，云同步停止，复习写进 pending 分区，没有任何提示让他们重新登录。
- 修复：infra 把 refresh_token_validity 提到 90-365 天，或启用 refresh token 轮换（随 E08）；app 内在曾登录用户变成匿名时显示 'Session expired, sign in to keep syncing' 横幅（OTA，G05）。S。

**MACCT-05（P1，CONFIRMED）冷启动后 access token 不再刷新，60 分钟后同步和 premium 检查都 401**
- 证据：`mobile/src/auth/authStore.ts:88,137`（只在 init 和登录时读会话）；`mobile/App.tsx:162-175`（回前台只重排同步）；`mobile/src/screens/HomeScreen.tsx:114,177-190`；`mobile/src/sync/progressSync.ts:680-688`；`infra/modules/identity/cognito.tf:148,163`。
- 影响：后台放了一小时以上再回来，app 一直用过期 token 推拉，直到下次冷启动；同步静默停摆，premium 状态检查失败。
- 修复：AppState 变 'active' 以及遇到任何 401 时调 fetchAuthSession()（Amplify 会刷新），把新 token 交给 setSyncAccessToken 和 store。抽成 getFreshAccessToken()。不用改冻结文件。S，OTA。**真机验证（后台 >60 分钟再回来）。**

**MACCT-06（P1，CONFIRMED）点过一次 'Not now' 就永远开不了提醒：Settings 没有开关**
- 证据：`mobile/src/screens/PermissionPromptScreen.tsx:74-79,88-89`；`mobile/src/screens/HomeScreen.tsx:536-538`（'Change anytime in Settings'）；`mobile/src/features/gacha/settings/reminders/RemindersSection.tsx:22-45`（只读）；`mobile/src/notifications/reminders.ts:95,111-114`（setReminderPrefs 无调用方，从不请求权限）。
- 影响：一次性提示不会再出现，权限也从没请求过，所以 app 连 iOS 设置 > 通知里都不出现。跳过的用户失去了最主要的留存提醒，而文案承诺可以在 Settings 里改。
- 修复：Settings > Reminders 显示权限状态和 'Turn on' 按钮（undetermined 时 requestPermissionsAsync，denied 时 Linking.openSettings），加早/晚开关和预设时间，接到 setReminderPrefs + refreshDailyRemindersFromCache。M，OTA。**真机验证（通知权限）。**

**MSHELL-01（P1，CONFIRMED，含 MACCT-19）tab 点击和 'Back home' 按钮都 push 新屏，每次切 tab 栈都变长（RN Nav 7）**
- 证据：`App.tsx:284-288`（navigationRef.navigate(name)）；`mainTabs.ts:3-13`；react-navigation routers 7.5.3 `StackRouter.tsx:371-381`（只有是当前路由或 payload.pop 时才复用）；`src` 里除 `SignInScreen.tsx:29` 外没有 popTo/pop:true/reset；`SessionCardScreen.tsx:226-230` 卸载时重置全局 session store。
- 影响：每次点 Home/Draw/Review/Library/Me 或 'Return home' 都挂一个新副本，会话中内存持续增长，iOS 侧滑返回会走过一串过期历史。两个 SessionCard 实例共享同一个全局 session store，卸载时会重置它（疑似会破坏进行中的复习）。
- 修复：先 OTA：tab 栏和回首页按钮用 `navigate(route, params, { pop: true })` 或 reset 到 [Home, tab]；MoreScreen 的只挂载时加载（`MoreScreen.tsx:30-52`）改 useFocusEffect。1.7.0 再迁到 `@react-navigation/bottom-tabs`，BottomTabBar 作为 tabBar，每个 tab 一个 stack。M。**真机验证。**

**MSHELL-02（P1，CONFIRMED）线上付费 app 没有任何崩溃或错误遥测，唯一的 JS 错误出口是 console.error**
- 证据：`RootErrorBoundary.tsx:7-11,20-22`；`package.json:20-57`（无 Sentry/Bugsnag）；`src` 里 grep 不到 ErrorUtils/setGlobalHandler/遥测消费方；`featureFlags.ts:26` 定义了 answerTelemetry 但没人用。
- 影响：生产 JS 异常、未处理的 rejection、boundary 命中全部不可见，OTA 或 1.7.0 binary 带来的回归只能从评论里发现；App Store 崩溃日志只覆盖原生崩溃。
- 修复：1.7.0 通过 Expo plugin 加 `@sentry/react-native`，eas build/update 时上传 source map，打上 release + updateId 标签（H02）。过渡期 OTA：ErrorUtils.setGlobalHandler + boundary 上报到一个小的 `/api/v1/client-errors` 端点（G13）。M，binary。

### 4.7 手机端其余发现（P2/P3）

**核心学习**

| ID | 级别 | 标题 | 证据 | 修复 | 量 | 通道 |
|---|---|---|---|---|---|---|
| MCORE-02 | P2（DOWNGRADE） | MCQ 选项阶段题干截 3 行，AWS 题的问句和限定词被藏 | McqReviewBody.tsx:220,307,323-334；src/config/featureFlags.ts:22-27；aws-saa-c03.md：335/371 题的最后一句在第 100 字符之后开始，36 个题内限定词全部在第 100 字符之后 | 选项阶段始终显示最后一句（问句）和限定词，只折叠前面的场景；只有 onTextLayout 报告超过 3 行时才显示 'Show full question'。复核：recallFirst 先完整显示题干，已有 'Show full stem'，maxPerRun 2 | S | ota |
| MCORE-03 | P2（DOWNGRADE） | 会话 ScrollView 切卡不复位 | SessionCardScreen.tsx:916-924,651-654,985-990 | 持有 ref，StableUid 或 attemptIndex 变化时 scrollTo({y:0, animated:false})，或用 uid+attempt 作 key。复核：答案折叠后内容变短会自动夹住 offset，只影响下一张很长的卡 | S | ota |
| MCORE-04 | P2（DOWNGRADE） | 复习时主 tab 栏常驻，占约 74-108pt | mainTabs.ts:10；App.tsx:179,281-293,308-313；BottomTabBar.tsx:26-31；SessionCardScreen.tsx:868-873,226-230 | SessionCard 聚焦时隐藏 tab 栏，退出统一走 requestPause。复核："一键放弃"不成立（navigate 是 push，SessionCard 仍挂载，评分已保存），只剩空间问题 | S | ota |
| MCORE-06 | P2（DOWNGRADE） | AWS/Claude 封面带粗黑边，Claude 封面有旧文字残影 | mobile/assets/packs/README.md；实测中行非黑范围 csharp x31-992、aws x92-924、claude x95-925；claude.png 约 (280-760,1170-1320) 区域；src/theme/packArt.ts:191-195,227-237；HomeScreen.tsx:741-746,1119-1133 | 按 C# 的边距沿轮廓裁剪（或透明外围），导出全彩 PNG/WebP，金色浮雕字，干净的 Claude 字样；图片资源可随 OTA。纯视觉问题 | M | ota |
| MCORE-08 | P2 | CardDetail 对已拥有的卡也从不显示答案 | CardDetailScreen.tsx:200-373 | meta 条下面加 'Show answer' 开关，复用 ReviewBody 的答案区、CodeBlock、renderSimpleMarkdown | M | ota |
| MCORE-09 | P2 | CardDetail 把 stage 3 标成 Mastered，Library/Home 用 stage >= 4 | CardDetailScreen.tsx:148-152；features/gacha/constants.ts:11；library/libraryMapper.ts:146-153 | chip 改由 progressSelectors 的 isMasteredProgress/isLearnedProgress 推导 | S | ota |
| MCORE-10 | P2 | 卡组 JSON（AWS/Claude 各约 0.6MB）每个页面加载都重读重解析 | deckRepository.ts:582-640,634,635；deckActionResolver.ts:162；LibraryScreen.tsx:111；SessionCardScreen.tsx:377；CardDetailScreen.tsx:86；ChallengeScreen.tsx:62 | 新增非冻结的 deckCache，按 slug + manifest 版本 memo resolveDeckBySlug，经 install/purge 包装失效 | M | ota |
| MCORE-11 | P2 | 每次评分后下一张卡要等 6-10 次串行 AsyncStorage 操作（疑似延迟） | SessionCardScreen.tsx:572-609,651-654；review/storage.ts:602-611；rewards/sessionRewards.ts:91-138 | 先打 perf mark 测量；保持 event -> progress 顺序，saveDeckProgress 之后就推进 UI，奖励结算放到串行后台任务 | M | ota |
| MCORE-12 | P2 | MCQ dock 在小屏上堆了提示、计数、2 个 56pt 按钮、48pt 链接和引导条 | SessionCardScreen.tsx:102-103,1004-1006；McqActionDock.tsx:58-106；McqCoachLine.tsx:18-31；mcq/mcqConstants.ts:33 | 收成一行（Sure / Not sure / I don't know），提示移进 a11y label，引导改成滚动内容顶部可关闭的卡片 | M | ota |
| MCORE-13 | P2 | 活动卡组缺失时 Library 清空切换器，SessionCard 没有重试 | LibraryScreen.tsx:111-127,138-143,276-316；SessionCardScreen.tsx:393-395,776-804 | 出错时保留 deckOptions 并在错误上方显示切换器 + Retry；SessionCard 错误态加 Retry 和 'Choose another deck'，离线文案单独写 | S | ota |
| MCORE-14 | P2 | 评分按钮、tab 栏、Library tile、会话控件缺 role/label/state | RatingBar.tsx:49-66；BottomTabBar.tsx:12-18；LibraryCardTile.tsx:54-63；SessionCardScreen.tsx:792-795,893-900,943-944 | 加 accessibilityRole button/tab、accessibilityState {selected, disabled}、'Again, show soon'、'Card 12, not collected yet' 等 label；装饰 glyph 隐藏 | S | ota |
| MCORE-15 | P2 | Dynamic Type 无管理：固定尺寸盒子、单行截断，没有 maxFontSizeMultiplier | DrawResultScreen.tsx:551,557（仅有的两处）；RatingBar.tsx:60-65；McqReviewBody.tsx:588-596；CardDetailScreen.tsx:410-418,511；SessionCardScreen.tsx 18 处、HomeScreen.tsx 20 处 numberOfLines | chrome 文本上限约 1.4 倍，卡片正文自由缩放，fontScale > 1.3 时评分改 2x2，9pt 标签提到 11pt | M | ota |
| MCORE-16 | P2 | Library FlatList 无 getItemLayout，滚动估高 132 对不上 154 的 tile，过滤就重挂 | LibraryScreen.tsx:330,339-352,414-422；libraryScreenStyles.ts:313；LibraryCardTile.tsx:35 | tile 固定高度并提供 getItemLayout；key 只依赖 numColumns；LibraryCardTile 用 React.memo，renderItem 用 useCallback | S | ota |
| MCORE-17 | P2 | HomeScreen 1405 行：render 内 360 行 IIFE、死 calendar memo、隐藏测试探针 | HomeScreen.tsx:98-121,457-488,581-940,942-1033,1094-1096 | 抽出 useHomeData、HomePackHero、HomePackSelector（visual decks 做 memo）；删 renderCalendar；测试改用真实控件的 testID | M | ota |
| MCORE-18 | P3 | mock/不可达页面仍在 core stack；contentConfig.ts 指向 dev S3 | DailyDoseScreen.tsx:7,21；SortFilterScreen.tsx:7；CoachOverlayScreen.tsx:5；TagExplorerScreen.tsx:7,21；LevelScreen.tsx:10,53；App.tsx:199-265；navigation/linking.ts:9-13；content/contentConfig.ts:4-7 | 删除这些路由（或只在 __DEV__ 注册），从 RootStackParamList 移除，删 contentConfig.ts | S | ota |
| MCORE-19 | P3 | CardDetail 加载中或找不到时显示占位数据；deep link 找不到其他卡组的卡 | CardDetailScreen.tsx:84-87,176-182,368；navigation/linking.ts:12 | 骨架屏；在所有已安装卡组里查 cardId；明确的 not-found 状态 | S | ota |
| MCORE-20 | P3 | 只有 MCQ 判定有触觉，翻卡评分、翻开、选项都没有 | SessionCardScreen.tsx:126-135,739,772；RatingBar.tsx:58；ReviewBody.tsx:172-176；McqReviewBody.tsx:226-237 | loadExpoHaptics：翻开/选项用 selectionAsync，评分用轻 impact，放在设置开关后 | S | ota |
| MCORE-21 | P3 | 卡片正文和 CodeBlock 在每次 SessionCard 状态变化时重渲、重分词 | SessionCardScreen.tsx:1002,985-990；ReviewBody.tsx:80-134；CodeBlock.tsx:232-253 | ReviewBody/McqReviewBody/CodeBlock 用 React.memo，token 按 code+language memo，回调用 useCallback | S | ota |
| MCORE-22 | P3 | loadDeckProgress 每次读都写 deck meta | review/storage.ts:580,421-428 | 只在 contentVersion 变化或 lastSeenAtISO 超过一天时 upsert | S | ota |
| MCORE-23 | P3 | 没有深色模式：app.json 强制 light，颜色到处硬编码 | mobile/app.json:10；src/theme/colors.ts:1-47；mobile/App.tsx:303-313；DailyDoseScreen.tsx:15 | 语义色 token + light/dark 调色板（useColorScheme），再把 userInterfaceStyle 改成 'automatic'（binary） | L | binary |

**抽卡/经济/付费**

| ID | 级别 | 标题 | 证据 | 修复 | 量 | 通道 |
|---|---|---|---|---|---|---|
| MGACHA-02 | P2（DOWNGRADE） | 背景音在卡桌阶段持续循环；expo-audio 的循环不无缝，每 8s 顿一次 | src/components/ceremonyAudio.ts:40,183,304-316；DrawCeremonyScreen.tsx:498-501,511-516；expo-audio 1.1.1（mobile/package-lock.json:11848-11849）ios/AudioPlayer.swift:278-280 | OTA：cards-on-table 约 1.5s 后把 bed 淡到 0 并暂停，正常一抽碰不到循环边界。binary：bed 改用无缝循环 buffer（react-native-audio-api AudioBufferSourceNode.loop）。复核：机制属实，0.25 增益下是否听得出没测（suspected） | S | ota |
| MGACHA-03 | P2（DOWNGRADE） | draw_committed 立即触发完整的 push+pull+drawState 同步，与仪式重叠 | DrawScreen.tsx:577,586；src/sync/progressSync.ts:1703-1717,1583-1596,1671 | 仪式结束后再调度（DrawResult 挂载时，或 delayMs ≈ toTableMs + 1s 配合 InteractionManager）；只改 DrawScreen，不需要冻结例外。复核：导致卡顿是推断，未测量 | S | ota |
| MGACHA-04 | P2（DOWNGRADE） | 生产构建忽略 sandbox 权益，App Review/TestFlight 的购买永远不解锁 | src/premium/revenuecat.ts:21-22,165-169；src/config/appEnv.ts:18-19；PaywallScreen.tsx:143-150 | 客户端把活跃的 sandbox 权益当 premium（RevenueCat 推荐做法），sandbox 管控放服务端；进 1.7.0 embedded bundle，同时 OTA 到 1.6.1。复核：规则 2025-12-27 就有，1.5/1.6 带着它过了审，拒审风险低于原判断 | S | ota |
| MGACHA-05 | P2 | 仪式编排在 JS 线程上串行：setTimeout -> setState -> render -> useEffect 才启动动画 | DrawCeremonyScreen.tsx:352-375,378-433,481-502；useCeremonyTimeline.ts:254-445 | 撕包时一次算出完整时间线，所有 shared value 用 withDelay 在 UI 线程赋值；音频/触觉 cue 从同一个起始时间戳驱动；React 的 phase 状态只用于文案和 a11y | L | ota |
| MGACHA-06 | P2 | 音效 hit 路径（疑似）：已播完的 player 先异步 seekTo 再同步 play，每次 play 都 setActive | ceremonyAudio.ts:129-134,203-217,254-268；expo-audio ios/AudioModule.swift:173-177,199-204,235-240 | OTA：keepAudioSessionActive:true，每个 player 播完或派发后立刻回卷，play 不再需要 seek。binary：SFX 迁到 react-native-audio-api（解码 buffer、GainNode 渐变、无缝循环） | M | binary |
| MGACHA-07 | P2 | 稀有度音效和翻牌音在点击时就响，比视觉翻面早约 100-700 ms | DrawCeremonyScreen.tsx:526-534；TapCard.tsx:130-132,141-148；ceremonyTimings.ts:41-43 | card-flip 在 queue delay + liftMs 时触发，稀有度音效在翻面中点触发（withDelay 回调里 runOnJS） | S | ota |
| MGACHA-08 | P2 | LEG 单抽的 Success 触觉总被每秒 3 次的限流吞掉 | ceremonyHaptics.ts:7,93-97；DrawCeremonyScreen.tsx:417-420,485-487,496-497；ceremonyTimings.ts:37 | success() 豁免限流或预留名额，并在 heavy impact 之前触发 | S | ota |
| MGACHA-09 | P2 | 跳过卡桌的玩家永远解锁不了快进（只有 Continue 才标记完成） | DrawCeremonyScreen.tsx:545-548,571-577；skipPolicy.ts:26-28 | 到达 settle 或 cards-on-table 时标记完成，或在 flash 播过后的卸载 cleanup 里标记 | S | ota |
| MGACHA-10 | P2 | 全息箔 SkSL 从不渲染：TapCard 没传 LUT | TapCard.tsx:274；FoilLayer.tsx:66,79-89；src/theme/packArt.ts:269；DrawScreen.tsx:384-387 | 传 lut={FOIL_LUT} 并真机实测，或删掉 SkSL 和 prewarm | S | ota |
| MGACHA-11 | P2 | Stage canvas 在整个页面生命周期内每帧重绘 | StageCanvas.tsx:266-269,276-287,301-316,351-355；useCeremonyTimeline.ts:237-251 | cards-on-table 时取消 raysAngle 和 clock（0.1 不透明度的 rays 可以冻结），或卡桌可交互后卸载 StageCanvas | S | ota |
| MGACHA-12 | P2 | （疑似）10 张 3D 旋转的 TapCard 带无路径 iOS 阴影，产生离屏绘制 | ceremonyStyles.ts:131,76-88；TapCard.tsx:201-209,174-178 | 翻面期间去掉 slot 阴影，或给 slot 不透明圆角背景以生成 shadowPath；用 perf report 的 UI 掉帧数验证 | S | ota |
| MGACHA-13 | P2 | 点击到仪式之间要重解析卡组文件并重写最多 50 条完整 ownedBefore 历史 | drawCommit.ts:54-58,94-103；deckRepository.ts:615-617,634-635；drawStateStore.ts:65,449-453；DrawScreen.tsx:544 | 传入 DrawScreen 已加载的卡组，或在 drawCommit 里按 buildId memo；ownedBefore 压缩存储；历史追加在导航后 fire-and-forget | M | ota |
| MGACHA-14 | P2 | 结果页文案用了 'Pokedex' 商标 | DrawResultScreen.tsx:437-440,458-460；参照 DrawScreen.tsx:711-714（Pokeball token 已因版权顾虑移除） | 改成 'Collection +N' 或 '+N to your deck' | S | ota |
| MGACHA-15 | P2 | 卡片详情弹窗把题干截到 3 行，比打开它的卡片还少 | DrawResultScreen.tsx:862-864 对比 :139,:577（featured 卡显示 6 行） | 弹窗可滚动，显示完整题干、topic、MCQ 标记，加 'Study this card' CTA | S | ota |
| MGACHA-16 | P2 | 仪式音效无视静音键，也没有音效开关 | ceremonyAudio.ts:155-163（playsInSilentMode: true）；SettingsScreen.tsx 无相关设置 | 默认尊重静音键（playsInSilentMode false），Settings 加 'Sound effects' 开关 | S | ota |
| MGACHA-17 | P2 | Paywall：价格只取一次不重试，不可用时隐藏订阅按钮，pending 当失败 | PaywallScreen.tsx:46-61,268-296,152-154；revenuecat.ts:409-417 | 聚焦时重取 offerings 并加 Retry；PAYMENT_PENDING 与网络错误映射成友好文案 | S | ota |
| MGACHA-18 | P2 | 仪式 perf report 定位不了卡顿（没有计时器延迟、commit 时间、warm/sync 标记） | ceremonyPerf.ts:12,251-262；ceremonyAudio.ts:146,260-267；DrawCeremonyScreen.tsx:241-245,174-186 | 记录每个计时器计划/实际触发 ms、每相位 effect commit 时间戳、撕包时 isWarm、syncInFlight、performance.now 延迟；UI 帧从撕包开始计；保留最近 5 份报告并可 Copy JSON | S | ota |
| MGACHA-19 | P2 | 拆分 Draw（1109）、DrawCeremony（822）、DrawResult（882），去掉隐藏测试探针 | DrawScreen.tsx:317-614,787-803,865-890；DrawCeremonyScreen.tsx:113-820；DrawResultScreen.tsx:168-880 | 抽出 useDrawChamber、useDrawTransaction、PackArt、DeckRail、useCeremonySequencer、useCeremonyCues、CeremonyTable、FeaturedResultCard、ResultStrip、CardDetailModal；测试契约改成真实元素的 testID | L | ota |
| MGACHA-20 | P2 | Draw 轨道切卡组整屏变 spinner，加载串行 await | DrawScreen.tsx:505,407,508-517,616-629,430-448 | 保留就绪 UI，只在包区域显示内联 loader；loadRewardWalletState 与 loadDrawStatus 用 Promise.all | S | ota |
| MGACHA-21 | P3 | 'N pulls left' 把 reserve 也算进去，Draw 徽标只算 available | DrawResultScreen.tsx:238-241；DrawScreen.tsx:66-68,720 | 两处共用一个"现在可用次数"selector | S | ota |
| MGACHA-22 | P3 | Settlement/FreePullGrant/FreePullInventory 带 mock 经济数据且不可达 | SettlementScreen.tsx:7-8,22-23；FreePullGrantScreen.tsx:7,17-24；FreePullInventoryScreen.tsx:7,17；src/mock/economy.ts；SessionCardScreen.tsx:162 | 删除路由、页面和 mock（或先接 rewardWallet 与账本再链接） | S | ota |
| MGACHA-23 | P3 | csharp-back.png 是 1024×1536 / 1 MB，其他卡背是 400×560 | mobile/assets/packs/csharp-back.png（1,056,633 B）；aws-back.png/claude-back.png；packArt.ts:206；TapCard.tsx:220-222 | 按 400×560 重新导出；EAS Update 可发新资源（与 MSHELL-23 合并） | S | ota |
| MGACHA-24 | P3 | SpillSampler 在多抽撕包时跑 100 ms setInterval 重渲 | SpillSampler.tsx:11,19-22；DrawCeremonyScreen.tsx:761-763 | 从相位起点一次性推导进度，或只在测试开关下渲染 | S | ota |
| MGACHA-25 | P3 | premium 状态初值 false，付费用户会短暂看到 'Not subscribed' 和可点的 Unlock | premiumStore.ts:117-131；PaywallScreen.tsx:216-220,274-276,187-188 | usePremiumUser 改三态（unknown/false/true），unknown 时显示骨架；去掉嵌套的 SafeAreaProvider | S | ota |

**账号/设置**

| ID | 级别 | 标题 | 证据 | 修复 | 量 | 通道 |
|---|---|---|---|---|---|---|
| MACCT-07 | P2 | Profile 唯一的 CTA 打开硬编码 mock 身份的假 Edit Profile | ProfileScreen.tsx:81-82；EditProfileScreen.tsx:12-22 | 去掉 CTA 或改指 Settings > Content preferences，删 EditProfileScreen（Guideline 2.1 占位风险） | S | ota |
| MACCT-08 | P2 | 提醒文案与行为矛盾（9 点每天都发；要求登录；提到晚间提醒） | PermissionPromptScreen.tsx:88；reminders.ts:24-29,159-170；RemindersSection.tsx:38-44；SettingsScreen.tsx:60-65,308-310；reminderPlanner.ts:18 | 改文案（或上次同步时没有到期卡就不发早间通知），去掉 Reminders 的登录按钮，Momentum 显示 statusLine，默认 prefs 与 reminders.ts 一致 | S | ota |
| MACCT-09 | P2 | 运算符优先级 bug 把 'denied' 映射成 'granted' | PermissionPromptScreen.tsx:21-23；HomeScreen.tsx:536-537 | `res.granted ? 'granted' : res.status === 'denied' ? 'denied' : 'undetermined'`，加单测 | S | ota |
| MACCT-10 | P2 | Cognito token（含 refresh token）存在明文 AsyncStorage，不在 Keychain | amplify.ts:19-30；package.json:20-60；progressSync.ts:141,701-702（冻结） | 1.7.0 加 expo-secure-store，用 cognitoUserPoolsTokenProvider.setKeyValueStorage 接适配器，并一次性从 AsyncStorage 迁到 Keychain；删 progressSync 的副本需冻结例外 | M | binary |
| MACCT-11 | P2 | 注册页隐藏密码规则，显示原始 Cognito 错误并打印完整错误 dump | SignUpScreen.tsx:36,106；authStore.ts:181-183,194-197,273-280；cognito.tf:115-121 | 实时密码检查清单；Cognito 错误名映射友好文案；日志放到 __DEV__ | S | ota |
| MACCT-12 | P2 | 确认后不自动登录，没有 iOS AutoFill 提示 | ConfirmSignUpScreen.tsx:50-53,109-120；authStore.ts:187-193；SignInScreen.tsx:117-145；SignUpScreen.tsx:92-120 | signUp 传 options.autoSignIn: true 并在 confirmSignUp 后调 autoSignIn()；加 textContentType/autoComplete；webcredentials 关联域名放 binary | S | ota |
| MACCT-13 | P2 | 'Clear today's schedule' 实际让所有卡组所有已学卡片立刻到期 | AccountSection.tsx:14-16,107-115；accountActions.ts:13-27；review/storage.ts:713-737 | 改名（如 'Make all learned cards due today'），显示影响数量，破坏性确认，或移到 Debug | S | ota |
| MACCT-14 | P2 | 生产 Debug 菜单（7 击版本号）能清空全部本地进度 | SettingsScreen.tsx:180-185；AboutSection.tsx:47-51；DebugMenuScreen.tsx:148-166,178-184,289-313 | 生产入口用远程开关或 userSub 白名单门控；危险区和 dev 壳只留 __DEV__ | S | ota |
| MACCT-15 | P2 | Settings 每次聚焦和 auth 加载时整屏换 spinner | SettingsScreen.tsx:116-118,142-146,195-213；67-74,126-130（不可达的 empty 分支） | 只在首次加载显示 spinner，之后后台刷新；删掉死的 empty 分支 | S | ota |
| MACCT-16 | P2 | （疑似）离线冷启动显示 'Signed out'，点 Sign in 又静默弹回 | authStore.ts:156-172；SignInScreen.tsx:64-67 | UserAlreadyAuthenticatedException 时先 init() 再离开；状态为匿名但 token 还在时，回前台和恢复网络时重试 init() | S | ota |
| MACCT-17 | P2 | 登出和删号时从不注销 RevenueCat，前一个用户的权益残留 | revenuecat.ts:340-349,367-383；authStore.ts:290-309,311-328 | signOutNow 与 deleteAccountNow 在 Cognito 登出后调 rcLogout() | S | ota |
| MACCT-18 | P2 | onboarding 没有登录/恢复入口，老用户重装后是全新匿名玩家 | WelcomeScreen.tsx:85-92；AudienceSurveyScreen.tsx:69-84；MoreScreen.tsx:84-92 | Welcome 加 'I already have an account'，打开 SignIn 后回到 onboarding | S | ota |
| MACCT-19 | P2 | （疑似）tab 栏 navigate() 在单 stack 上重复 push（= MSHELL-01，已确认） | App.tsx:284-289；BottomTabBar.tsx:12；HelpFAQScreen.tsx:26-27；package.json（native-stack ^7.8.3） | 随 MSHELL-01 修复 | M | ota |
| MACCT-20 | P2 | kill switch/强更配置托管在个人 GitHub raw URL，不在 S3/CloudFront | App.tsx:119,151；featureFlags.ts:58-61；remoteConfig.ts:17,139-146 | JSON 放到 cdn.developercards.app（S3+CloudFront，短 TTL），OTA 改指向，删掉 '(Set updateUrl…)' 提示（依赖 E09） | S | infra |
| MACCT-21 | P2 | 缺按钮 role 和选中状态；Settings 文本被硬截到 1 行 | AppInfoScreen.tsx:94-106；AudienceSurveyScreen.tsx:61；ContentSection.tsx:40-49；SettingsScreen.tsx:305；AccountSection.tsx:80,103；RemindersSection.tsx:27-35 | accessibilityRole 'button'/'radio' + accessibilityState {selected}，正文去掉 numberOfLines={1} | M | ota |
| MACCT-22 | P3 | 重复的 SettingsMain + 4 个子页 + About 渲染 mock 且不可达 | App.tsx:233-238；SettingsMainScreen.tsx:6,18-46；mock/settings.ts:1-12；AboutScreen.tsx:18,25；AuthGateModal.tsx | 删除 6 个页面、路由类型、mock/settings.ts 和 AuthGateModal | S | ota |
| MACCT-23 | P3 | 注册相关页面配色不统一；政策链接在 Notion 且复制了 3 份 | SignUpScreen.tsx:13,55,180,242；ConfirmSignUpScreen.tsx:13,72,227；SignInScreen.tsx:75-83；SettingsScreen.tsx:50-53；MoreScreen.tsx:15-22；PaywallScreen.tsx:32 | 用主题 token 和 safe-area-context 的 SafeAreaView 重做样式；链接收进一个常量模块，指向 developercards.app/privacy 与 /support | S | ota |
| MACCT-24 | P3 | audience 设置有 4 套词汇；Profile 显示原始 key；AudienceFilter 是空桩 | AudienceSurveyScreen.tsx:16-20；ContentSection.tsx:12-16；audienceRules.ts:7-11；ProfileScreen.tsx:60；AudienceFilterScreen.tsx:21-30 | 统一用 getAudiencePreferenceLabel；删 AudienceFilter 及其 TagExplorer 入口 | S | ota |
| MACCT-25 | P3 | app 用 USER_PASSWORD_AUTH 登录，公开客户端还允许 ADMIN_USER_PASSWORD_AUTH | authStore.ts:244-248；cognito.tf:155 | 先 OTA 切到默认 SRP；1.6.x 普及后从客户端移除两个密码流 | S | ota |

**壳/导航**

| ID | 级别 | 标题 | 证据 | 修复 | 量 | 通道 |
|---|---|---|---|---|---|---|
| MSHELL-03 | P2 | 约 44 个 mock 'v6 壳' 页面（约 4k 行）注册在生产 navigator 里却不可达 | App.tsx:23-51,69-77,200-263；WeekSummaryScreen.tsx:10-15；PausedPoolScreen.tsx:12；ProfileScreen.tsx:83-85；SessionCardScreen.tsx:162,660；SettlementScreen.tsx:22-43 | 删除见 §4.5 清单，含 src/mock、types.ts:18 mockState 和钉住它们的测试 | M | ota |
| MSHELL-04 | P2 | （疑似）分享面板 'Save Image' 会崩：没有 NSPhotoLibraryAddUsageDescription | app.json:28-30；shareDraw.ts:66-72；DrawResultScreen.tsx:780-787；expo-sharing 14.0.8 SharingModule.swift:15 | 1.7.0 在 app.json ios.infoPlist 加该字符串，真机验证 Save Image | S | binary |
| MSHELL-05 | P2 | 没有应用内更新检查，OTA 要到发布后第二次冷启动才生效 | app.json:51-56；src 里没有 checkForUpdateAsync/fetchUpdateAsync/reloadAsync；appEnv.ts:2；ceremonyPerf.ts:169-173 | AppState 'active' 时（节流）checkForUpdateAsync + fetchUpdateAsync，在安全时机（Home 空闲或下次启动）reloadAsync，记录 updateId 结果 | S | ota |
| MSHELL-06 | P2 | kill switch 与版本门来自 raw.githubusercontent.com，只在冷启动拉取 | App.tsx:119；forceUpdateGate.ts:38-65；remoteConfig.ts:95-133 | 从 cdn.developercards.app 提供，回前台按最小间隔重取，保留 last-good（与 MACCT-20 合并） | S | ota |
| MSHELL-07 | P2 | 深色 cosmic 页面上状态栏是深色文字，Me tab 看不清时间和电量 | app.json:10；MoreScreen.tsx:67；AppInfoScreen.tsx:37-49；src 无 StatusBar；package.json:41 expo-status-bar 未用 | cosmic 页面渲染 `<StatusBar style="light"/>`，其他页 'dark' | S | ota |
| MSHELL-08 | P2 | tab 栏没有 role/selected/label，glyph 图标被朗读 | BottomTabBar.tsx:12-18,88-93；mainTabs.ts:4-12 | 容器 tablist，每项 tab + {selected} + label，glyph 对 a11y 隐藏（与 MCORE-14 合并） | S | ota |
| MSHELL-09 | P2 | （疑似）大字号或 iPhone SE 下 onboarding 与 Draw 的 CTA 被挤出屏幕 | AudienceSurveyScreen.tsx:52,96,128；DrawScreen.tsx:63-64；DrawResultScreen.tsx:551,557；全局 251 处 numberOfLines={1} | onboarding 和 Draw 包 ScrollView（或按 useWindowDimensions 缩放包图），chrome 加 maxFontSizeMultiplier；SE 模拟器 AX 字号 QA | M | ota |
| MSHELL-10 | P2 | 原始错误字符串（HTTP body、'Network request failed'）直接显示给用户 | apiClient.ts:59-65,62；SessionCardScreen.tsx:515；LibraryScreen.tsx:143；DrawScreen.tsx:496 | apiClient 与 deckRepository 调用方加错误分类（offline/timeout/auth/server/content），映射友好文案 + Retry，对象错误安全 stringify | M | ota |
| MSHELL-11 | P2 | 无连通性感知：离线页是 mock 壳，重连后不会重新同步 | package.json:20-57；OfflineBannerScreen.tsx:8-33；ErrorNetworkScreen.tsx:8-33；App.tsx:172-175 | 1.7.0 加 NetInfo、壳里真实非阻塞离线横幅、重连时 scheduleProgressSync，Me 页显示待同步数 | M | binary |
| MSHELL-12 | P2 | 只有一个根 error boundary，任何页面渲染错误都会白屏，重试回到 Splash | App.tsx:183；RootErrorBoundary.tsx:24-26,29-37 | 每个 Stack.Screen 包一层带 'Back to Home'（navigationRef.reset）的 boundary，并上报遥测 | S | ota |
| MSHELL-13 | P2 | 冷启动先白色原生 splash，再一个 JS Splash 路由，然后才到 Home | app.json:19-23；SplashScreen.tsx:12-41；App.tsx:192 | 1.7.0 配 expo-splash-screen plugin（羊皮纸底色），preventAutoHideAsync 到读完 onboarding 阶段，再决定 initialRouteName，去掉 Splash 路由 | S | binary |
| MSHELL-14 | P2 | 1.7.0 binary 应离开 SDK 54/RN 0.81 并补上缺失的原生模块 | package.json:28（expo ~54.0.20，lock 54.0.30）、:45、:49、:26、:54、:37（'^'）、:55（rxjs 0 引用） | 用当时最新的 Expo SDK 切 1.7.0（以 expo.dev/changelog 为准；npx expo install --fix + expo-doctor），Skia/Reanimated/worklets 跟 SDK 版本；加 Sentry、NetInfo、expo-splash-screen；删 rxjs；expo-linear-gradient 用 ~ | L | binary |
| MSHELL-15 | P2 | mobile CI 缺 lint、expo-doctor 和 bundle export；测试钉住占位页 | .github/workflows/ci.yml:8-36（frontend 有 npm audit :70、lint :80）；package.json:6-19；tests/integration/plan-library-deep-polish.screen.test.tsx:106-107；CardDetailScreen.tsx:357-366 | mobile job 加 eslint-config-expo（react-hooks）、npx expo-doctor、npx expo export -p ios、npm audit；随 MSHELL-03 删钉壳测试 | S | infra |
| MSHELL-16 | P2 | （疑似）不带 --environment 发 OTA 会把 EXPO_PUBLIC_* 内联成空 | apiClient.ts:4,31；amplify.ts:10-17；eas.json:66-70；scripts/release 只有 build/submit；docs/delivery-wave-1.6-plan-2026-09-19.md:77 | 新增 scripts/release/ota.sh：eas update --channel production --environment production，发布前检查必需的 EXPO_PUBLIC_* 名字存在（只查名字，不打印值） | S | infra |
| MSHELL-17 | P3 | 主题 token 被绕开：610 个 hex 字面量，羊皮纸 UI 外面包着旧薰衣草/靛蓝壳 | colors.ts:1-36；App.tsx:303-313,339；BottomTabBar.tsx:35；RootErrorBoundary.tsx:49,61 | 语义 token（surface、onSurface、primary、cosmic），壳/boundary/遮罩先迁；lint 禁止 src/screens 里写裸 hex | M | ota |
| MSHELL-18 | P3 | 生产 CardDetail 里有隐藏的测试用 Pressable，链到 mock TagExplorer | CardDetailScreen.tsx:357-366,545；TagExplorerScreen.tsx:21 | 删探针和 plan-library-deep-polish.screen.test.tsx 里的两条断言 | S | ota |
| MSHELL-19 | P3 | deep link 只有自定义 scheme，冷启动跳过 onboarding，提醒点击不去具体页面 | linking.ts:5-15；App.tsx:192；app.json:24-32；src 无 addNotificationResponseReceivedListener | 包一层 getStateFromPath，在目标下插入 Home 并按 onboarding 阶段门控；1.7.0 加 developercards.app 的 associatedDomains + AASA，提醒点击路由到 SessionCard | M | binary |
| MSHELL-20 | P3 | 没有根 SafeAreaProvider，Home 和 Paywall 各自嵌套 | App.tsx:182-297；HomeScreen.tsx:500,520；PaywallScreen.tsx:187；SessionCardScreen.tsx:206 | 根部包 SafeAreaProvider initialMetrics={initialWindowMetrics}，去掉页面级 provider | S | ota |
| MSHELL-21 | P3 | 每次导航都重渲 App 根和 70 屏 navigator 元素树 | App.tsx:160,189-190,192-277 | tab 栏路由跟踪移到订阅 navigationRef.addListener('state') 的小组件 TabBarHost，或用 bottom-tabs 一并解决 | S | ota |
| MSHELL-22 | P3 | 生产可达内部文案（更新遮罩提示、7 击 Debug 菜单） | App.tsx:149-151；SettingsScreen.tsx:180-184；DebugMenuScreen.tsx:170-172,289-300 | 回退到按 app id 拼的 App Store URL；7 击入口保留但隐藏场景和 dev 文案，重置需要登录的 owner 或 __DEV__ | S | ota |
| MSHELL-23 | P3 | 资源过重：1.4MB WAV 循环、1024x1536 的 1MB 包图 | assets/sfx/ambience.wav 1,411,244 B；assets/packs/csharp-back.png 1,056,633 B、csharp.png 944,178 B；DrawScreen.tsx:63-64；icon/splash-icon/adaptive-icon/favicon 同为 576KB | ambience 转 AAC/m4a；包图缩到约 720x1008 并量化或转 WebP；splash 用专门的小图 | S | binary |
| MSHELL-24 | P3 | 每次 'inactive'（控制中心、通知栏）都触发进度同步 | App.tsx:172-175 | 只在 'background' push，'active' 时按最小间隔 pull | S | ota |
| MSHELL-25 | P3 | 隐私和支持链接指向 Notion，并在两个文件里重复 | MoreScreen.tsx:15-22；SettingsScreen.tsx:51-53 | 页面放到 developercards.app，只保留一个导出常量（与 MACCT-23 合并） | S | ota |

### 4.8 手机端横切

- **"题目显示不全"有三个独立成因，都还在：** CardDetail 固定 5:7 的 hero（MCORE-01）、MCQ 选项阶段 3 行截断（MCORE-02）、切卡不复位滚动（MCORE-03）。ReviewBody v4 只修好了翻卡面。DrawResult 的 featured 卡按文档和 CardDetail 共用固定 hero 样式，很可能同样截断长题（suspected，不在该区审计范围，放进 G01 顺带确认）。
- **数据加载：** Home、Library、SessionCard、CardDetail、Challenge 各自实现一遍 deck + progress + owned 加载，没有共享缓存。在 memo 化的仓库包装层上做一个 useDeckSnapshot hook，可以消掉大部分性能问题，而不碰冻结的 deckRepository.ts（MCORE-10）。
- **测试契约探针在生产 UI 里：** Home、Library tile、CardDetail 里的 0x0 隐藏 Pressable/Text，Draw 的隐藏滑轨，SpillSampler 定时器。Draw、DrawCeremony、DrawResult 长到 800-1100 行，这些是很大一部分原因。测试应改为用 testID 找真实控件。
- **抽卡卡顿根因：** 仪式时序在 JS 线程上（setTimeout -> setState -> effect），音量渐变是 20 ms 的 JS 定时器，cue 从 effect 发出。同一窗口里的 JS 工作（draw_committed 同步、卡组重解析、历史重写）就表现为声音和动画卡顿。结构性修法是 UI 线程 withDelay 时间线（MGACHA-05）加延后同步（MGACHA-03）。音频引擎：只用 expo-audio 1.1.1（没有 expo-av），每个 sample 包一个 AVPlayer，seek 是异步的，每次 play() 都调 AVAudioSession.setActive，循环靠 seek+play（不无缝）。OTA 能缓解；1.7.0 binary 是换 react-native-audio-api 的机会。还有几项"打磨"其实静默失效：箔面 shader 没 LUT、粒子 14s 重放、LEG 成功触觉被限流、稀有度音效早于揭示。2026-09-21/22 的 OTA 修复（预热、8s 循环、memo）没覆盖到这些。
- **Auth 状态分散在三处且没有刷新循环：** Amplify 存储、zustand store（accessToken 只取一次）、progressSync 的 token 副本。这是 MACCT-04/05/16 的共同根因。统一走 getFreshAccessToken()（内部调 fetchAuthSession）。
- **Sign in with Apple：** 只有邮箱密码登录（supported_identity_providers=COGNITO），Guideline 4.8 不适用。用户可见品牌一致（DeveloperCards）；'RecallSmith' 只出现在存储 key、URL scheme 和 slug 里，'DevCards Spaced Recall' 只出现在 Notion 政策 URL 里。
- **依赖升级（MSHELL-14）：** 当前 Expo 54.0.30 / RN 0.81.5 / Reanimated 4.1.7 / Skia 2.2.12 / worklets 0.5.1。1.7.0 用当时最新的 SDK，expo-doctor 通过后再加 Sentry、NetInfo、splash-screen、secure-store、audio-api。之前记录过 mobile 的 vitest 被 vite 8 + rolldown 卡住，升级 `mobile/package.json` 时可考虑把 vite 固定在 ^7。
- **性能：** 启动本身精简（remote config 不阻塞，Skia/Reanimated 经 reanimatedGuard 懒加载，无自定义字体），剩下的成本是双 splash 和 eager import 约 75 个 screen 模块（很多是死的）。钱包写是 AsyncStorage 读改写，写顺序经过设计但没有 mutex；没找到活跃竞态，以后加单一串行钱包队列会让新的发放来源更安全。
- **遥测：** 没有崩溃上报，没有全局 JS handler。服务端只能从每次 push 的 updateId/clientFeatures（`clientCapabilities.ts`）看到 OTA 采用率，看不到错误。1.7.0 的 Sentry 是主要补缺。
- **可访问性与小屏：** 219 个 Pressable 中只有 76 处 accessibilityRole；只有 2 处 maxFontSizeMultiplier；251 处单行截断；onboarding 和 Draw 布局不滚动。
- **主题：** 610 个 hex 字面量分属三套调色板（羊皮纸、粉彩 'Pokemon'、旧薰衣草/靛蓝）。userInterfaceStyle 锁在 light，但有 cosmic 深色页且没有状态栏处理。
- **离线：** 同步层能容忍离线（队列 + last-good 缓存，remote config 非阻塞），但 UI 没有连通性感知，直接显示原始错误字符串。
- **Privacy manifest：** Expo prebuild 默认生成 PrivacyInfo.xcprivacy（在一份旧的本地 prebuild 里见过），app.json 没有覆盖。在 1.7.0 的归档里复查。唯一配置的权限字符串是 mic=false。
- **包图流程：** 需要一个标准：全彩、沿轮廓裁剪，卡组上线前做一次视觉 QA（MCORE-06）。
- **测试与 CI：** CI 跑 152 个 vitest suite + tsc（strict），但没有 ESLint、expo-doctor、Metro export，还有几个 suite 只是为了让占位壳活着。
- **冻结文件：** 所有修复都不需要改 deckRepository.ts、progressSync.ts、model.ts（MACCT-10 删除 progressSync 副本是唯一的可选例外）。
- **重复项合并：** MACCT-04 = AWS-08；MACCT-19 = MSHELL-01；MCORE-14 与 MSHELL-08（tab 栏 a11y）；MACCT-20 与 MSHELL-06；MACCT-23 与 MSHELL-25；MGACHA-23 与 MSHELL-23；MACCT-14 与 MSHELL-22；MCORE-18、MGACHA-22、MACCT-22、MSHELL-03 合成一次删除。

---

## §5 AWS 加强进度（"加强 AWS Service"还差多少）

### 5.1 Wave E 逐项状态

**进度：5/15 已 apply（E01-E05，PR #153-157），其中 E04、E05 各留一个线上回归（09-26 已修：AWS-01 已恢复，AWS-02 待 owner 点确认邮件，见 §0.1）；E06 BLOCKED；E07-E15 共 10 个未开始。按工作量约完成 30%，剩余约 12 个工作日（含 supervisor apply）。**

| E | 主题 | 状态 | 证据 | 剩余工作 | 1.7.0? | 量/天 | 月成本增量 |
|---|---|---|---|---|---|---|---|
| E01 | terraform-adopt | 已完成 | issue #138、PR #153；E01-terraform-adopt.md。state 桶 recallsmith-tfstate 已开版本和 PAB，资源打上 ManagedBy=terraform | plan 不再为空：ESM enabled drift + SNS 订阅 drift，E0 清掉 | - | - | $0 |
| E02 | safety-switches | 已完成 | #139、PR #154。RDS 删除保护、14 天备份、pre-E02 快照、多区 CloudTrail、$60 预算、S3 版本、保留期、PC/SnapStart 清理 | devcards-content-dev 仍公开（AWS-13），等 owner OK 后删 | E0 | S | $0 |
| E03 | queue-reliability | 已完成（配置） | #140、PR #155。DLQ 14 d、redrive 3、visibility 3700 s、ESM 挂 worker-lambda:prod + ReportBatchItemFailures | ESM 当前因 E05 回归而 Disabled（AWS-01） | E0 | S | $0 |
| E04 | observability | 已完成，有回归 | #141、PR #156（0/0 throttle 事故已修）。12 个 alarm（全 OK）、dashboard、API access log、RDS events | developercards-alerts 0 订阅，告警没人收（AWS-02）；ESM 停用没有告警（AWS-14） | E0 | S | $0 |
| E05 | iam-least-privilege | 已完成，有回归 | #142、PR #157。作用域角色上线，FullAccess 移除 | post-apply 的 publish-version/update-alias 没做，worker:prod v6 仍用被削权的角色，ESM 自动停用（AWS-01）；root access key 存在（AWS-09） | E0 | S | $0 |
| E06 | secrets-and-db-role | **BLOCKED** | #143，gate=brief-verify，6 轮后阻塞。代码在 wt/issue-143（HEAD 90d5179，20 个文件，167 个测试全绿）。线上：没有 SSM 参数，PGUSER=postgres | rollout（bootstrap-roles、INJECT_ENV=0 部署、put-parameter x5、再部署）+ AWS-12 | 是，第一个 | M / 0.5 | $0 |
| E07 | webhook-input-hardening | 未开始 | #144（依赖 #143）。webhook 在 DB 失败时仍返回 200，序数比较，401 响应泄露 hash8，无 body 上限和逐事件校验 | 全部（AWS-05） | 是（涉及收入） | M / 1 | $0 |
| E08 | gateway-and-cognito | 未开始 | #145。10 个路由 auth NONE，只有 console authorizer，无 reserved concurrency，console MFA OFF，1 天 token，localhost 回调；stage 限流来自事故修复 | 全部（AWS-06、07），加 AWS-08、AWS-10 | 是 | M / 1 | $0 |
| E09 | domain-wiring | 未开始 | #146。域名已注册，ICANN 联系人已验证；zone 只有 NS/SOA，0 张 ACM 证书，无 CloudFront alias、API 域名和站点桶 | 全部（AWS-17、CFE-14、config 托管） | 是，binary 切之前 | L / 2 | 约 $0.3（zone 的 $0.50 已在计费） |
| E10 | staging-env | 未开始 | #147。没有 *-staging 函数/队列/桶，没有 staging DB role；EAS staging-internal-release 仍在 production channel/env | 全部（AWS-16） | 有余力就做，否则 1.7.0 后第一个 | L / 2 | $1-2 |
| E11 | cd-pipeline | 未开始 | #148。没有 GitHub OIDC provider、gha 角色、cd.yml、terraform.yml；所有部署都用 2025-12-08 创建的 devcards-admin access key | 全部（AWS-18） | 1.7.x | L / 2 | $0.5-2（部署前手动快照） |
| E12 | scheduler-and-migrations | 未开始 | #149。本产品没有任何 schedule，没有 InternalEvents.cs；reaper、outbox publish、快照导入都是手动的 super_admin 端点 | 全部（AWS-15、CBE-04 调度部分） | 是（1.7.0 带 migration 022，见 CBE-02） | M-L / 1.5 | 约 $0.2（Scheduler 免费额度，约 11k 次调用 + 第 13 个 alarm） |
| E13 | analytics-separation | 未开始 | #150。analytics 桶 404，analytics/raw 与 marts 在内容桶 core-vpc 里，HashUserId 不加盐，没有 analytics-salt 参数 | 全部（AWS-22） | 之后 | M / 1 | 约 $0.1 |
| E14 | brand-and-dedupe | 未开始 | #151。console 标题仍是 'RecallSmith Console'；src_C/Vpc/Db/Pg.cs、DbUtil.cs、src_C/Common 的重复还在；没有 DB CommandTimeout | 全部（AWS-20、21，CBE-10、14、20，CFE-17） | 之后（console 标题可在 F32 先做） | M / 1 | $0 |
| E15 | docs-runbooks | 未开始 | #152。docs/runbooks/ 不存在（只有 E01 的 infra/RUNBOOK.md），没有部署回滚、事故、DR、OTA runbook | 全部，加 AWS-09 检查项 | 最后 | S / 0.5 | $0 |

另有约 $0.2/月的额外日志。

### 5.2 为什么 E06 卡住，怎么解

按时间顺序：
1. 字面 guard 报 'deploy.sh lacks --with-decryption'（`~/.rimv-delivery/r16-e-prod/logs/issue-143.log:44`）。
2. verify 把 no-op 输出也算作变更（log:195；已在 2fc02c0 修复）。
3. 线上 plan 带出了 worker ESM 的更新，因为 Lambda 已自动停用 ESM，也就是 AWS-01 的 drift（log:622）。
4. `RouteMetrics.cs`（bootstrap-roles 的一行）被判为超出范围（log:843），随后 BLOCKED（log:987）。

supervisor 在第 3 次尝试后于 03:34 放宽了 verify（9513d38，`E06.verify.sh:381-389`），但 wave 已经停了（STATUS 03:34:36 systemic-error，STOP/WAVE_DONE；queue.tsv 是线性依赖，done/ 只有 138-142）。wt/issue-143 落后 base 一个提交，并且改了它自己的 E06.verify.sh。

**解法：**
1. 先清 drift（AWS-01、AWS-02），否则 plan 形状 gate 还会失败。
2. 把 wt/issue-143 rebase 到 9513d38，丢掉 worker 自己对 E06.verify.sh 的改动。
3. 删除 STOP/WAVE_DONE，重跑 E06。
4. 然后按 brief 做 rollout。

风险高（切换生产 DB 用户），回滚方法是用 PGUSER=postgres 重新部署。

**系统性改进（relaunch 前做）：**
- 每个 issue 的 post-apply 步骤现在只写在文字里，没有任何检查。E05 的第 2 步被跳过，E04 的邮件也没确认。要加一个 post-apply live assertion 脚本，检查 alias Role、ESM State、SNS SubscriptionsConfirmed、plan EMPTY，作为进入下一个 issue 前的硬 gate。
- 串行队列加上真实后端的 plan gate，意味着任何线上 drift（自动停用的 ESM、过期的 SNS 订阅）都会挡住后面所有 issue。relaunch 前先跑一次"plan 必须为 EMPTY"的预检。
- 2026-09-22 的 brief 在事故之后、1.7.0 之前已经过时，relaunch 前要 rebase：
  - E08 写死了限流字面值（AWS-10）。
  - 所有 verify 脚本都钉死 app.json 1.6.1（AWS-11）。
  - E08 没覆盖 mobile refresh token 有效期（AWS-08）。
  - E06 的 SSM `ignore_changes` 可能把明文带进 state（AWS-12）。

### 5.3 AWS 发现（22 条）

**P0/P1 详情**

**AWS-01（P0，CONFIRMED）worker ESM 自 09-22 起自动停用，worker:prod v6 跑在被削权的 core-vpc 角色上**
- 证据：`aws lambda list-event-source-mappings` -> 29e34447 State=Disabled；CloudTrail LambdaESMDisabled 2026-09-22T14:50Z 和 17:19Z，ESMDisableReason 'Lambda does not have required permissions ... (sqs:ReceiveMessage, sqs:DeleteMessage and sqs:GetQueueAttributes)'；`list-versions-by-function worker-lambda` -> v6 Role core-vpc-role-joizyiwt，alias prod->6（只有 $LATEST 用 developercards-worker-lambda-role）；core-vpc-scoped SqsSend 只有 SendMessage + GetQueueAttributes；`E05-iam-least-privilege.md:311`（第 2 步 publish-version + update-alias 没做）；`infra/modules/worker/function.tf:44-48` enabled=true（drift）；`src_C/Vpc/Authoring/Publish.cs:327-350`（发布只走 SQS 异步）。
- 影响：2026-09-22 17:19Z 以来 console 的发布一个都完成不了（任务停在 PENDING），包括 1.7.0 的内容。同一个 drift 让每次线上 plan 都不为空，从而挡住 E06。
- 修复：`publish-version worker-lambda`（快照新角色）-> `update-alias prod` -> `update-event-source-mapping --enabled`，然后端到端发布一次做冒烟；post-apply 清单加一条"alias 版本的 Role == 预期角色"。S，infra。

**AWS-02（P1，CONFIRMED）SNS developercards-alerts 0 订阅：12 个 alarm 和 RDS 事件通知不到任何人**
- 证据：`sns get-topic-attributes` -> SubscriptionsConfirmed 0、SubscriptionsPending 0；`sns list-subscriptions` -> []；`cloudwatch describe-alarms` -> 12 个 alarm 的 AlarmActions 都是 developercards-alerts；`infra/modules/observability/alerts.tf:5-9` 声明了邮件订阅（state drift）。
- 影响：AWS-01 这种中断以及任何 5xx、DLQ、RDS 事件都没人收到，只有预算邮件（直接发送）还能到。terraform 还会计划创建订阅，再次破坏 E06 的精确 plan gate。
- 修复：supervisor 通过 terraform 重新 apply 订阅（不要用 CLI，保持 state 干净），owner 在 3 天内点确认邮件，用 set-alarm-state 验证；P0 alarm 再加第二个通道（Chatbot/SMS）。S，infra。

**AWS-03（P1，CONFIRMED）E06 被 gate 反复和线上 drift 卡住；wave 09-23 03:34 停止，E07-E15 从未运行**
- 证据：`~/.rimv-delivery/r16-e-prod/logs/issue-143.log:44,195,622,843,987`；STATUS 03:34:36 systemic-error；`docs/delivery/r16-issues/E06.verify.sh:381-389`（9513d38，在最后一次尝试之后）；wt/issue-143 HEAD 90d5179（20 个文件，167 个测试全绿），落后 base 一个提交并改了自己的 E06.verify.sh。
- 影响：15 个里只交付了 5 个，线性依赖把下游 9 个全部挂起，E06 做好的代码闲置。
- 修复：见 5.2。S，infra。

**AWS-04（P1，CONFIRMED）生产 API 用 RDS master 'postgres' 连接；5 个 secret 是明文 Lambda 环境变量**
- 证据：`lambda get-function-configuration` core-vpc 与 worker-lambda -> PGUSER=postgres；core-vpc env key 包含 PGPASSWORD、MIGRATE_SECRET、INTERNAL_SHARED_SECRET、RC_WEBHOOK_AUTH_PRODUCTION/DEVELOPMENT（只读了名字）；`ssm describe-parameters` -> 无；`src_C/Vpc/Db/Migrate.cs:138-142`（序数比较，非常量时间）；`infra/README.md:76-79`（Lambda env 值会进入 TF state）。
- 影响：任何注入漏洞或泄露的函数配置都等于拿到唯一数据库的超级用户；能调 lambda:GetFunctionConfiguration 或读 state 的人能看到全部 secret。
- 修复：交付 E06（developercards_app 角色、SSM SecureString、部署时注入、Secrets.FixedTimeEquals），之后轮换 RDS master 密码和全部 5 个 secret。M，server。

**AWS-05（P1，CONFIRMED）RevenueCat webhook 在 DB 宕机或 upsert 异常时返回 200，付费事件丢失**
- 证据：`src_C/Vpc/Webhooks/RevenuecatWebhook.cs:319-339`（conn 为空就跳过，插入失败只 Log.Warn），`:400-405`（user_premium_state upsert 失败被吞），`:424`（200 accepted）；`:265` 序数 token 比较；`:268-281` 401 响应返回 expectedLen 和 expectedHash8。
- 影响：一次短暂的 RDS 故障就会告诉 RevenueCat 已送达，它不再重试，服务端永远不发 premium（PremiumDeckUrl 读 user_premium_state，付费用户可能被拒）。401 响应向任何调用者泄露 secret 的长度和 hash 前缀。
- 修复：交付 E07：任何 DB 失败返回 503 + retry-after 60，FixedTimeEquals，401 响应只留 4 个 key；加 503 路径的 webhook 测试。M，server。

**AWS-07（P1，CONFIRMED）console 管理员池：MFA OFF、1 天 token、生产 SPA 客户端带 localhost 回调**
- 证据：`cognito-idp get-user-pool-mfa-config ap-southeast-2_4Vf8uCXKt` -> MfaConfiguration OFF；`describe-user-pool-client 6lkofepp...` -> access/id 1 天，回调含 http://localhost:5173；`infra/modules/identity/cognito.tf:5`（mfa OFF）、`:47`（access 1）、`:52`（localhost 回调）、`:58`（refresh 5）。
- 影响：super_admin 的密码一旦被钓鱼或撞库，就能为所有用户发布、回滚、删除卡组；偷到的 access token 能用一整天。复核：super_admin 组显示 1 个用户，不是 2 个。
- 修复：E08 的 Cognito 部分：MFA ON（TOTP），token 1 h / 1 h / 30 d，只留 CloudFront 回调，单独建 console-dev 客户端；apply 后 owner 立刻注册 TOTP。S，infra。

**AWS-08（P1，CONFIRMED，= MACCT-04）mobile refresh token 5 天且不轮换，用户每 5 天掉登录**
- 证据：`describe-user-pool-client 7agirr7f56r9k5p6v6o63al1on` -> RefreshTokenValidity 5（天），RefreshTokenRotation null；`infra/modules/identity/cognito.tf:159`；`mobile/src/auth/authStore.ts:88,127`；`E08-gateway-and-cognito.md:24`（写的是 'mobile pool untouched'）。
- 影响：登录的学习者 5 天后变成匿名，失去云同步和用户维度的进度视图，直到重新登录。没有任何 Wave E issue 在修它。
- 修复：mobile 客户端 refresh_token_validity 提到 90-365 天（纯 infra；已有 token 仍按旧的过期时间），加进 E08 的 allow-list；refresh token 轮换等 1.7.0 里和 Amplify 一起测过再开。S，infra。

**AWS-09（P1，CONFIRMED）root 用户有 access key（AccountAccessKeysPresent = 1）**
- 证据：`aws iam get-account-summary` -> AccountAccessKeysPresent 1、AccountMFAEnabled 1；`docs/backend-architecture-review-2026-09-22.md:66,91` 只列了 IAM 用户的 key。复核：这个计数只统计 root key，唯一的 IAM 用户 key 是 devcards-admin，所以 root 确实有活跃 key。
- 影响：root key 绕过 Wave E 在建的所有 IAM 边界，而且无法限定范围；一旦泄露就是整个账号被接管，包括账单和域名。
- 修复：owner 用 root 登录控制台删除 root access key，记录到 `infra/README.md` 第 6 节；它不在任何 E brief 里，加进 E15 的检查清单。S，infra。

**其余 AWS 发现（P2/P3）**

| ID | 级别 | 标题 | 证据 | 修复 | 量 | 通道 |
|---|---|---|---|---|---|---|
| AWS-06 | P2（DOWNGRADE） | 10 个 API 路由全是 auth NONE，没有 mobile authorizer，也没有 reserved concurrency | apigatewayv2 get-routes ktbq1sie2c；get-authorizers 只有 828ehi（console 池）；infra/modules/api/gateway.tf:57-62；get-function-concurrency core-vpc/worker-lambda -> {}；$default stage 200 rps / 400 burst；RDS t4g.micro max_connections 公式 | E08：加 cognito-jwt-mobile authorizer、拆路由、reserved concurrency 设 40（core-vpc）和 2（worker），保留经过校验的限流变量。复核：JWT 在进程内校验，webhook 必须公开，连接耗尽只是推测 | M | infra |
| AWS-10 | P2 | E08 verify 钉死限流字面值 200/100，与事故后校验过的变量相矛盾 | E08.verify.sh:110-113,380；E00-contracts.md:332；infra/modules/api/gateway.tf:88-92,107-111；variables.tf:56-92 | brief 与 verify rebase 到变量上（从 plan JSON 断言值而不是 grep），保留校验；路由级限流按 access log 峰值定（sync 40/20 是全局值，不是每用户） | S | infra |
| AWS-11 | P2 | 15 个 Wave E verify 脚本都写死 app.json 1.6.1，升到 1.7.0 就全挂 | E06.verify.sh:394；E08.verify.sh:422；E09.verify.sh:628；E01-E15 全部；mobile/app.json:7 | 先完成 1.7.0 需要的 AWS issue 再升 app.json，或把字面值换成"相对 merge-base 未改变"的检查 | S | infra |
| AWS-12 | P2 | （疑似）SSM ignore_changes=[value] 在 refresh 时仍会把真实 secret 拉进 TF state | wt/issue-143/infra/modules/identity/ssm.tf:1-16；infra/README.md:81-83 | 用只写的 value_wo + value_wo_version（Terraform 1.16 / aws 6.66 支持），或用 CLI 建值、terraform 只管名字；第一次轮换后用 `terraform state show` 确认 | S | infra |
| AWS-13 | P2 | devcards-content-dev 在 E02 之后 4 天仍公开可读 | s3api get-public-access-block -> 全 False；get-bucket-policy-status -> IsPublic true；PublicReadDeckContent；6 个对象、83 KB、未开版本；infra/README.md:102 | owner 回一个字 OK，supervisor 开 PAB、清空并删桶，记入 README 第 6 节 | S | infra |
| AWS-14 | P2 | ESM 停用或 worker 空闲时没有告警 | CloudTrail LambdaESMDisabled 两次都没触发任何东西；infra/modules/observability/alarms.tf:136-160；events list-rules -> 无 | EventBridge 规则匹配 CloudTrail 服务事件 LambdaESMDisabled，发到 developercards-alerts；E12 之后加每日合成发布或健康检查 | S | infra |
| AWS-15 | P2 | 没有 scheduler：孤儿发布 reaper、outbox 发布、CI 快照导入全靠手动 | scheduler list-schedules 只有 newsapp RunNewsPipelineDaily（DISABLED）；events list-rules -> 无；PublishReaper.cs:55-66；VpcFunction.cs:213 | 1.7.0 带 migration 之前交付 E12（3 个 schedule 直调 core-vpc:prod，内部事件契约，schema 门）；staging schedule 等 E10 | L | server |
| AWS-16 | P2 | 没有 staging 环境，EAS staging profile 发在 production channel 上 | lambda list-functions 无 *-staging；mobile/eas.json:52-62；mobile/src/config/appEnv.ts:4 | E10：同一 RDS 实例上的独立 DB 与角色、staging 函数和桶、EAS 'staging' channel；eas.json 的改动进 1.7.0 binary 构建 | L | infra |
| AWS-17 | P2 | 域名没用上（zone 只有 NS/SOA、无证书）；客户端写死 execute-api 和 CloudFront 域名 | route53 Z0284954BSN00C8BF94Q 只有 NS+SOA；acm us-east-1/ap-southeast-2 -> []；cloudfront 无 alias；apigatewayv2 get-domain-names -> []；mobile/src/features/gacha/home/homeRemote.ts:9；mobile/src/content/deckRepository.ts:33（冻结）；frontend/.env.production:11 | 切 1.7.0 binary 前落地 E09，EAS production env 设 EXPO_PUBLIC_API_BASE=https://api.developercards.app；deckRepository 的回退值保持不动（冻结） | L | infra |
| AWS-18 | P2 | 唯一的部署凭据是一把 9.5 个月前的 admin access key，没有 GitHub OIDC | iam list-access-keys devcards-admin -> Active，2025-12-08；list-open-id-connect-providers -> []；无 developercards-gha* 角色；docs/backend-architecture-review-2026-09-22.md:91 | E11（OIDC provider、gha 角色、带审批的 cd.yml），人改用 IAM Identity Center，然后停用该 key | L | infra |
| AWS-19 | P3 | 9 月预算会超（实际 $56.66，预测 $66.15，预算 $60）；没有成本分配标签 | budgets describe-budgets；ACTUAL 50% 与 FORECASTED 85% 通知 ALARM；ce 9/1-26：Registrar 20.00、RDS 17.26、VPC 7.67、Tax 7.39、Lambda 3.41、Route 53 0.50；ce list-cost-allocation-tags -> 无；infra/modules/observability/budget.tf:1-41 | 激活 Project 与 Env 成本分配标签，加一个 Project=DeveloperCards 过滤的预算；10 月起稳态约 $42/月 | S | infra |
| AWS-20 | P3 | 超时链不匹配：API Gateway 30 s、core-vpc 90 s、Npgsql 无 CommandTimeout | apigatewayv2 get-integrations TimeoutInMillis 30000 ×4；core-vpc Timeout 90；Pg.cs 无 CommandTimeout | E14 的超时链部分（CommandTimeout 20 s、取消、Error500 里映射 503），遵守 brief 的"Handler 不加重载"规则（与 CBE-10 合并） | M | server |
| AWS-21 | P3 | （疑似）core-vpc .NET 8 只有 128 MB，拖慢 mobile 同步冷启动 | core-vpc MemorySize 128、arm64、dotnet8；infra/modules/observability/alarms.tf:119-126（p95 3000 ms） | 从日志量 Init Duration，再在 prod alias 上 A/B 512 MB 或 SnapStart（评审估计 +$0-3/月，与 CBE-16 合并） | S | server |
| AWS-22 | P3 | analytics 仍写进内容桶，用户 id 是不加盐的 SHA-256 | core-vpc-scoped S3Content 允许 core-vpc/analytics/*；s3 ls core-vpc/analytics/ -> raw/、marts/；head-bucket developercards-analytics-622994489535 -> 404；ProgressEvents.cs:806-810；OutboxPublisher.cs:43-45 | E06/E12 之后做 E13（独立桶、SSM 里的盐、outbox 保留期）；Snowflake 等有账号再说。CloudFront 只暴露 content/*，没有公开泄露 | M | server |

### 5.4 哪些进 1.7.0

- **今天（E0，全是 S）：** AWS-01、AWS-02、AWS-09，顺带 AWS-13。
- **1.7.0 binary 切之前（约 5 天）：** E06（+AWS-12）-> E07 -> E08（+AWS-08、AWS-10、AWS-06、AWS-07）-> E09。
  - E08 只动 infra，但它决定了线上 mobile 流量能否通过（audience 配错会让所有 mobile 调用 401），风险高。
  - E09 涉及 mobile TS（新的 hosts.ts 和 4 个调用方，可以 OTA 到 1.6.1），域名要写进 1.7.0 的 EAS env。
- **1.7.0 范围内，视时间：**
  - E12：1.7.0 带 CBE-02 的 migration 022，所以按条件属于范围内。可以先只做 prod，风险中等：Handler 入口变了，启动时的 schema 门配错会让生产返回 503。
  - E10：有余力就做，否则 1.7.0 后第一个做。
- **1.7.x：** E11（L，OIDC 角色有生产权限）、E13（M，换盐会改变所有 hash）、E14（M，删除重复的 Pg/DbUtil；按 brief，Handler 加重载会导致冷启动崩溃）、E15（S，纯文档）。这几项都不碰手机 bundle。
- **AWS-11 约束：** 1.7.0 需要的 AWS issue 完成之前，不要在集成分支上把 app.json 升到 1.7.0；或者先改 verify 脚本。

### 5.5 成本

- 9 月截至今天 $56.66：其中 $20 是一次性的 .app 域名注册，RDS 17.26，VPC 7.67（单 AZ 的 SQS endpoint），Lambda 3.41，GST 7.39。稳态约 **$42/月**。
- E06-E15 全部做完每月增加约 **$2-5**：E09 约 $0.3、E10 $1-2、E11 $0.5-2、E12 约 $0.2、E13 约 $0.1、额外日志约 $0.2；E06、E07、E08、E14、E15 为 $0。
- 不加 WAF（console WAF 可选，+$6-9/月）；用部署时注入避开 SSM endpoint（否则 +$7.3/月）。
- 线上核实过没问题的：RDS 删除保护开、14 天备份、加密、不公开、force_ssl=1；CloudTrail 多区记录并校验日志；tfstate 桶版本 + PAB；PC/SnapStart/陈旧 secret 已清理；developercards.app ACTIVE，ICANN 联系人验证已完成；stage 限流 200/400（$default）与 50/100（dev），均非 0。

### 5.6 需要 owner 亲自做的事

| # | 动作 | 何时 | 关联 |
|---|---|---|---|
| 1 | supervisor 用 terraform 重建订阅后，3 天内点 SNS 确认邮件 | E0 | AWS-02 |
| 2 | 回复"删"，同意删除公开桶 devcards-content-dev | E0 | AWS-13 |
| 3 | 用 root 登录控制台，删除 root access key | E0（今天） | AWS-09 |
| 4 | E08 apply 后立刻给 console 池注册 TOTP | E08 | AWS-07 |
| 5 | 同意 E06 之后轮换 RDS master 密码和 5 个 secret（supervisor 执行，不看值） | E06 后 | AWS-04 |
| 6 | 决定 mobile refresh token 有效期（建议 90 天） | E08 前 | AWS-08 / MACCT-04 |
| 7 | 激活 Project/Env 成本分配标签（Billing 控制台） | 任意 | AWS-19 |
| 8 | asc-release 返回 exit 3 时，重跑 `eas credentials --platform ios` 刷新 Apple 会话 | 提审日 | §7 |
| 9 | E11 之后停用 devcards-admin access key | 1.7.x | AWS-18 |

---

## §6 1.7.0 执行计划

### 6.1 波次总览（接在 Wave E 之后）

| 波次 | 内容 | 通道 | 执行方式 | 估时 |
|---|---|---|---|---|
| E0 止血 | AWS-01/02/09/13/14 + post-apply 断言脚本 + brief rebase | infra | supervisor 手工（不进 worker 队列） | 0.5 d |
| E-resume | E06 -> E07 -> E08 -> E09 ->（E12、E10） | server/infra | 现有 r16-e-prod 控制目录，apply-needed 协议不变 | 约 5 d + 3.5 d |
| Wave F | console 前端 + console 后端 + console infra | console/server/infra | 新控制目录 `~/.rimv-delivery/r17-f-console`，WORKER=claude | 约 8-10 d |
| Wave G | 手机端 OTA-safe（runtime 1.6.1） | ota | `~/.rimv-delivery/r17-g-ota`，WORKER=claude | 约 10-12 d |
| Wave H | 手机端 1.7.0 binary | binary | `~/.rimv-delivery/r17-h-binary`，WORKER=claude | 约 5-7 d |
| 1.7.x | E11、E13、E14、E15；G 里拆分类的 L 项如未完成 | 混合 | - | - |

### 6.2 Wave E0 与 E-resume

| ID | 标题 | 根因 | 通道 | 依赖 | 量 | 真机 |
|---|---|---|---|---|---|---|
| E0-1 | publish-version + update-alias prod + ESM enable + 端到端发布冒烟（**09-26 已完成前三步，v7；冒烟待 owner 发布一次**） | AWS-01 | infra | - | S | - |
| E0-2 | 用 terraform 重建 SNS 邮件订阅，确认后用 set-alarm-state 验证（**09-26 已 apply，待 owner 09-29 前确认**） | AWS-02 | infra | owner 点确认 | S | - |
| E0-3 | 删除 root access key，记录到 README §6 | AWS-09 | infra | owner | S | - |
| E0-4 | devcards-content-dev 开 PAB、清空、删除 | AWS-13 | infra | owner OK | S | - |
| E0-5 | EventBridge：LambdaESMDisabled -> developercards-alerts | AWS-14 | infra | E0-2 | S | - |
| E0-6 | post-apply live 断言脚本（alias Role、ESM State、SNS SubscriptionsConfirmed、plan EMPTY）作为硬 gate；relaunch 前"plan EMPTY"预检 | AWS-03 系统性 | infra | E0-1、E0-2 | S | - |
| E0-7 | rebase brief：E08 限流改用变量断言（AWS-10）；verify 去掉 app.json 1.6.1 字面值（AWS-11）；E08 allow-list 加 mobile refresh token（AWS-08）；E06 改 value_wo（AWS-12） | AWS-10/11/08/12 | infra | - | S | - |
| E06 | rebase wt/issue-143 到 9513d38，删 STOP/WAVE_DONE，重跑 + rollout；之后轮换 secret | AWS-03/04/12 | server | E0-1..E0-7 | M | - |
| E07 | webhook 503/FixedTimeEquals/401 精简/body 上限 + 测试（逐事件 400 不能卡住冻结的 progressSync ack 循环） | AWS-05 | server | E06（Secrets.cs） | M | - |
| E08 | mobile authorizer、路由拆分、reserved concurrency、console MFA + token + 回调、mobile refresh token、4xx 率告警 | AWS-06/07/08/10 | infra | E07 | M | 是（apply 后真机登录与同步冒烟） |
| E09 | ACM + alias：api/cdn/console.developercards.app，CORS，Cognito 回调，config 与隐私页托管 | AWS-17、CFE-14、MACCT-20 | infra（+mobile hosts.ts） | E08 | L | 是 |
| E12 | 3 个 schedule（reap、outbox、import），InternalEvents，schema 版本门 | AWS-15、CBE-04 | server/infra | E06；先于 F01 的 migration 022 上线 | M-L | - |
| E10 | staging DB/角色/函数/桶，EAS staging channel | AWS-16 | infra | E06、E09 | L | - |

### 6.3 Wave F：console 前后端

服务端先行（F01-F04 是杠杆最高的一组，合计约 2-3 天）。

| ID | 标题 | 根因 | 通道 | 依赖 | 量 |
|---|---|---|---|---|---|
| F01 | `POST /authoring/cards/import` 单事务幂等 upsert + migration 022（uq_cards_deck_order DEFERRABLE），每次最多约 500 张 | CBE-02 | server | E12 schema 门（或按顺序先部署 migration） | M |
| F02 | 卡组 PUT/DELETE 后进程内重建 manifest，返回 manifestRebuilt | CBE-03 | server | E0-1（冒烟需要发布可用） | S |
| F03 | worker 系统错误写 error_message、末次接收标 FAILED；只获取 PENDING/过期 PROCESSING；REAPED 状态 | CBE-04、CBE-17 | server | - | M |
| F04 | 发布成功时同步 total_cards | CBE-06、CFE-11 | server | - | S |
| F05 | admin gate 绑定 console issuer/client | CBE-07 | server | 与 E08 同步上线 | S |
| F06 | 生产不注册 DROP/CREATE/demo 路由，强制 MIGRATE_SECRET，FixedTimeEquals | CBE-08 | server | E06（Secrets.FixedTimeEquals） | S |
| F07 | 413 body 上限 + 字段长度 + slug 正则 + SLUG_LOCKED + 按 deck_id 关联 | CBE-09、CBE-13 | server | - | S |
| F08 | 路由表 + 错误映射中间件（23514/23503/22P02、409、503、ignoredFields） | CBE-22 | server | - | S |
| F09 | 审计事件 + append-only admin_audit 表 | CBE-12 | server | F08 | S |
| F10 | editor 的 jobs/status 按权限过滤；AdminDecks 返回 liveBuildId | CBE-21、CBE-18 | server | - | S |
| F11 | CI 快照新鲜度与清理；event_time 索引 | CBE-05、CBE-25 | server | - | S |
| F12 | 删除 Dashboard.cs；boot 日志移到构造函数，publish 日志降噪 | CBE-19、CBE-24 | server | - | S |
| F13 | Directory.Packages.props 统一 Npgsql | CBE-14 | server | - | S |
| F14 | 补集成测试（Decks CRUD、权限回滚、SQS 失败、并发发布、末次接收） | CBE-15 | server | F01-F03 | M |
| F15 | `DELETE /api/v1/me` 按 user_sub 级联删除 | MACCT-01（服务端部分） | server | - | M |
| F20 | 共享 buildDeckBody/buildCardBody：发送全部字段、支持清空；翻转 deckFormFieldDrop 测试 | CFE-01、CFE-03 | console | - | S |
| F21 | 保留服务端 envelope（authoring.ts + admin.ts），加 axios 400 测试 | CFE-02 | console | - | S |
| F22 | Admin Users 改用 /api/v1/admin/cognito/users，删 501 占位 | CBE-01 | console（+server 删占位） | - | S |
| F23 | 删 reset 按钮、4 个死函数、死 JSX、残留注释 | CFE-20、CFE-21、CBE-23 | console | F21 | S |
| F24 | DeckList：editor 跳过 manifest、FAILED 显示 errorMessage、轮询可暂停 | CFE-04、CFE-09、CFE-22 | console | - | S |
| F25 | 全部页面迁到 React Query（staleTime 约 30s）、单卡 GET、编辑/预览改用 /cards/page | CFE-05、CBE-11 | console | - | M |
| F26 | CardList 搜索/过滤/排序 | CFE-06 | console | F25 | M |
| F27 | 导入可取消 + beforeunload + 退避重试 + 重新预览；接入 F01 批量端点 | CFE-07 | console | F01 | M |
| F28 | 预览用服务端 dry-run（或补 mcq/topic 并标注近似） | CFE-08 | console（+server） | - | M |
| F29 | Builds 面板：回滚、Rebuild manifest、Reap stuck jobs | CFE-10、CBE-04 | console | F10 | M |
| F30 | ContentIntelligence 竞态 | CFE-12 | console | F25 | S |
| F31 | 未保存守卫 + createBrowserRouter | CFE-16 | console | - | M |
| F32 | 品牌统一（CONSOLE_NAME、标题、默认作者）、登录页文案、a11y | CFE-17、CFE-18、CFE-19 | console | - | S |
| F33 | 表单内 MCQ 校验 + topic 字段 | CFE-24 | console | F20 | M |
| F34 | CardForm 延迟高亮；axios 替换可选 | CFE-25 | console | - | S |
| F35 | deploy.sh 不带 --delete，旧 chunk 另行清理 | CFE-23 | console | - | S |
| F36 | 卡片/导入/预览/新建卡组页接入 ConsoleShell，登出统一走 AuthContext.signOut | 前端横切 | console | - | 未估 |
| F40 | console 错误上报 sink + VITE_ERROR_REPORT_URL/VITE_BUILD_ID | CFE-13 | infra | - | M |
| F41 | console.developercards.app 证书/alias/回调/CORS，重建 | CFE-14 | infra | E09 | M |
| F42 | CSP response-headers policy；缩短 console refresh token | CFE-15 | infra | E08 | S |
| F43 | core-vpc 512 MB 对比 SnapStart 的 A/B | CBE-16、AWS-21 | infra | - | S |

CBE-10/AWS-20（超时链）和 CBE-20（删重复数据层）由 E14 承接，不在 F 里重复开 issue。

### 6.4 Wave G：手机端 OTA-safe（runtime 1.6.1）

**G0 先做（发布安全）**

| ID | 标题 | 根因 | 通道 | 依赖 | 量 | 真机 |
|---|---|---|---|---|---|---|
| G00 | `scripts/release/ota.sh`（`--channel production --environment production`，只检查 EXPO_PUBLIC_* 名字）+ 应用内更新检查 | MSHELL-16、MSHELL-05 | infra + ota | - | S | 是（发一个空 OTA 验证在第一次回前台就生效） |

**G1：P0/P1 与审核风险**

| ID | 标题 | 根因 | 通道 | 依赖 | 量 | 真机 |
|---|---|---|---|---|---|---|
| G01 | 题目完整显示：CardDetail hero 改造、MCQ 问句常显、ScrollView 切卡回顶、DrawResult 弹窗可滚动（顺带确认 featured 卡） | MCORE-01、02、03，MGACHA-15 | ota | - | M | 是 |
| G02 | Library 刷新不卸载列表；错误态保留卡组切换器；SessionCard 加 Retry | MCORE-07、MCORE-13 | ota | - | S | 是 |
| G03 | Home 先用缓存构建，刷新合并，选包不做 I/O | MCORE-05 | ota | G30 有帮助但不阻塞 | M | 是（弱网） |
| G04 | tab/回首页 navigate 带 pop:true；SessionCard 隐藏 tab 栏；More 改 useFocusEffect | MSHELL-01、MACCT-19、MCORE-04 | ota | - | M | 是 |
| G05 | getFreshAccessToken（active/401 时刷新）、会话过期横幅、离线 init 重试 | MACCT-05、MACCT-04（app 端）、MACCT-16 | ota | E08 改 refresh token 有效期 | M | 是（后台 >60 分钟） |
| G06 | 找回密码、未确认注册路由、autoSignIn、AutoFill、友好错误与密码清单 | MACCT-02、03、11、12 | ota | - | M | 是（收邮件） |
| G07 | 提醒：Settings 权限状态与开关、修 ?? bug、文案对齐 | MACCT-06、09、08 | ota | - | M | 是（通知） |
| G08 | 删号先调 DELETE /api/v1/me，再 rcLogout，加订阅提示；登出也 rcLogout | MACCT-01、MACCT-17 | ota | F15 | S | 是 |
| G09 | 仪式快修：粒子一次性、延后 draw_committed 同步、bed 淡出暂停、LEG 触觉、跳过也解锁快进、翻牌音效对时 | MGACHA-01、03、02、08、09、07 | ota | G41 先埋点更好 | M | 是（声音/触觉） |
| G10 | 付费：sandbox 权益算 premium、Paywall 重试与 pending、premium 三态 | MGACHA-04、17、25 | ota | - | S | 是（TestFlight sandbox 购买） |
| G11 | 审核风险文案：Pokedex 改名、删 EditProfile CTA、Debug 门控、更新遮罩不显示 dev 提示 | MGACHA-14、MACCT-07、MACCT-14、MSHELL-22 | ota | - | S | - |
| G12 | 过渡期错误上报：ErrorUtils.setGlobalHandler + `/api/v1/client-errors`；逐屏 error boundary | MSHELL-02（过渡）、MSHELL-12 | ota + server | - | M | - |

**G2：死代码清理（G1 合并后做，避免在 App.tsx/CardDetail 上冲突）**

| ID | 标题 | 根因 | 通道 | 依赖 | 量 | 真机 |
|---|---|---|---|---|---|---|
| G20 | 删除 §4.5 列出的 47 个页面、V6*、src/mock、mockState、contentConfig、AuthGateModal、CardDetail 探针和钉住它们的测试 | MSHELL-03、MCORE-18、MGACHA-22、MACCT-22、MACCT-24、MSHELL-18 | ota | G1 | M | - |
| G21 | mobile CI 加 eslint-config-expo、expo-doctor、`expo export -p ios`、npm audit | MSHELL-15 | infra | G20 | S | - |

**G3：性能、可访问性、体验**

| ID | 标题 | 根因 | 通道 | 依赖 | 量 | 真机 |
|---|---|---|---|---|---|---|
| G30 | deckCache 包装层 + useDeckSnapshot | MCORE-10 | ota | - | M | - |
| G31 | 评分后先推进 UI（先打 perf mark 测量） | MCORE-11 | ota | G30 | M | 是 |
| G32 | storage 读路径不写；Library getItemLayout + memo；ReviewBody/CodeBlock memo | MCORE-22、16、21 | ota | - | S | - |
| G33 | MCQ dock 收成一行，引导移入内容区 | MCORE-12 | ota | G01 | M | 是（SE） |
| G34 | a11y：RatingBar、tab 栏、tile、AppInfoScreen、AudienceSurvey、Settings 截断 | MCORE-14、MSHELL-08、MACCT-21 | ota | G20 | M | 是（VoiceOver） |
| G35 | Dynamic Type 策略 + 小屏 ScrollView | MCORE-15、MSHELL-09 | ota | G34 | M | 是（SE + AX 字号） |
| G36 | CardDetail 显示答案、掌握阈值、骨架屏、跨卡组查卡 | MCORE-08、09、19 | ota | G01 | M | - |
| G37 | 翻卡触觉 + 音效开关/尊重静音键 | MCORE-20、MGACHA-16 | ota | - | S | 是 |
| G38 | Draw 切卡组不白屏 + Promise.all；drawCommit 复用已加载卡组、压缩 ownedBefore | MGACHA-20、MGACHA-13 | ota | G30 | M | 是 |
| G39 | pulls-left 统一 selector | MGACHA-21 | ota | - | S | - |
| G40 | Settings 首次才 spinner；'Clear today's schedule' 改名与确认 | MACCT-15、MACCT-13 | ota | - | S | - |
| G41 | 仪式 perf report 增强（先做，给 G09/G43 提供测量） | MGACHA-18 | ota | - | S | 是 |
| G42 | StageCanvas 停帧/卸载、TapCard 阴影、SpillSampler、FoilLayer 传 LUT 实测或删除 | MGACHA-11、12、24、10 | ota | G41 | S | 是 |
| G43 | 仪式时间线移到 UI 线程（withDelay），cue 共用起始时间戳 | MGACHA-05 | ota | G41、G42 | L | 是 |
| G44 | 错误分类 + 友好文案 + Retry | MSHELL-10 | ota | - | M | - |
| G45 | cosmic 状态栏、根 SafeAreaProvider、TabBarHost、只在 background 时 push | MSHELL-07、20、21、24 | ota | G04 | S | 是 |
| G46 | Welcome 加登录入口；audience 词汇统一 | MACCT-18、MACCT-24 | ota | G20 | S | - |
| G47 | 包封面重出图（owner 出图 + 视觉 QA）；csharp-back 缩到 400×560 | MCORE-06、MGACHA-23 | ota | - | M | 是 |
| G48 | remote config 迁 cdn.developercards.app + 前台重取；隐私/支持链接合并并迁到 developercards.app；注册页换主题 | MACCT-20、MSHELL-06、MACCT-23、MSHELL-25 | ota + infra | E09 | S | - |
| G49 | SRP 登录（客户端部分） | MACCT-25 | ota | G06 | S | 是 |
| G50 | 语义色 token，壳/boundary/遮罩先迁，lint 禁裸 hex | MSHELL-17 | ota | G20 | M | - |

**G4：大拆分（可以滑到 1.7.x）**

| ID | 标题 | 根因 | 通道 | 依赖 | 量 |
|---|---|---|---|---|---|
| G60 | 拆 HomeScreen（useHomeData、HomePackHero、HomePackSelector） | MCORE-17 | ota | G03、G20 | M |
| G61 | 拆 Draw/DrawCeremony/DrawResult，测试契约改 testID | MGACHA-19 | ota | G43 | L |

### 6.5 Wave H：手机端 1.7.0 binary

| ID | 标题 | 根因 | 通道 | 依赖 | 量 | 真机 |
|---|---|---|---|---|---|---|
| H01 | Expo SDK 升级（`npx expo install --fix`、expo-doctor），Skia/Reanimated/worklets 跟 SDK；删 rxjs；expo-linear-gradient 用 ~ | MSHELL-14 | binary | G1、G2 已合并 | L | 是（全回归） |
| H02 | `@sentry/react-native`（Expo plugin），eas build/update 上传 source map，标 release + updateId | MSHELL-02 | binary | H01 | M | 是 |
| H03 | NetInfo：离线横幅、重连同步、Me 页显示待同步数 | MSHELL-11 | binary | H01 | M | 是（飞行模式） |
| H04 | expo-splash-screen 羊皮纸底 + preventAutoHideAsync，去掉 JS Splash 路由 | MSHELL-13 | binary | H01 | S | 是 |
| H05 | infoPlist 加 NSPhotoLibraryAddUsageDescription | MSHELL-04 | binary | - | S | 是（分享 -> Save Image） |
| H06 | associatedDomains + AASA、getStateFromPath 插 Home、提醒点击路由到 SessionCard、webcredentials | MSHELL-19、MACCT-12 | binary | E09 | M | 是 |
| H07 | expo-secure-store Keychain 存 token + 一次性迁移 | MACCT-10 | binary | H01 | M | 是（从 1.6.1 升级后仍保持登录） |
| H08 | react-native-audio-api：SFX buffer、GainNode 渐变、bed 无缝循环（见 §8 决策 3） | MGACHA-06、MGACHA-02 | binary | H01、G43 | M | 是 |
| H09 | 迁到 `@react-navigation/bottom-tabs`，每个 tab 一个 stack | MSHELL-01 | binary | G04、G20 | M | 是 |
| H10 | 资源压缩：ambience 转 AAC、包图约 720x1008、专用 splash 图 | MSHELL-23 | binary | - | S | 是 |
| H11 | EAS env：EXPO_PUBLIC_API_BASE=https://api.developercards.app；eas.json staging channel | AWS-17、AWS-16 | binary | E09、E10 | S | 是 |
| H12 | 深色模式（token + userInterfaceStyle automatic），见 §8 决策 2，默认推迟 | MCORE-23 | binary | G50 | L | 是 |
| H13 | app.json 升到 1.7.0 + buildNumber；归档里复查 PrivacyInfo.xcprivacy；确认 embedded bundle 含全部 G | 发布 | binary | E09 完成、AWS verify 已改（AWS-11） | S | 是 |

### 6.6 Gate

| 范围 | 命令 |
|---|---|
| mobile | `cd mobile && npm run test:typecheck && npx vitest run`（G21 之后再加 lint、`npx expo-doctor`、`npx expo export -p ios`） |
| frontend | `cd frontend && npm run lint && npx vitest run && npm run build` |
| server | `dotnet test src_C/Tests/RecallSmith.Lambda.IntegrationTests` |
| infra | `terraform plan -out` -> `terraform show -json \| python3 infra/scripts/check-plan.py --allow docs/delivery/r16-issues/<TAG>.plan-allow.json` -> apply -> brief 的 post-apply 列表 -> E0-6 断言脚本 -> 第二次 plan 必须 EMPTY |

### 6.7 wave 运行与省 token

- **Worker：** Codex 额度已用完，所有新 wave 在 wave.conf 里设 `WORKER=claude`。worker 和 supervisor 共用 owner 的 claude.ai 订阅，建议同一时间最多跑一个 mobile wave 和一个 console/server wave。
- **监控：** `sentinel.sh` 是 OS 层看门狗，负责让 driver 活着；Claude 这边用后台任务跑 `bash <skill>/scripts/claude-watch.sh "$CONTROL_DIR"`，只在 issue-blocked、canary-failed、systemic-error、wave-done、apply-needed 这些事件时唤醒，不做轮询。
- **防卡死：** vitest 卡在 config 加载的问题由 `run_gated` 兜底（GATE_TIMEOUT_MIN=15，重试一次）；H01 动 `mobile/package.json` 时考虑把 vite 固定在 ^7。
- **仓库纪律：** 用不在 iCloud 上的 `~/src/recallsmith` clone。wave 运行期间不要在 $REPO 里 commit/push（postmortem #13），brief 的修正走 `wt/_integration`。重新排队 = 删除 `done/<n>` 并去掉 blocked 标签。
- **省 token：**
  1. brief 直接引用本文档的 file:line 和修复句，不要让 worker 重新审计。
  2. 同一文件的 S 项合成一个 issue（如 G09、F24），减少 worktree 和 gate 次数。
  3. 每个 wave 以 canary 开头：F20、G00、H05 都小且可验证。
  4. 大 L 项（G43、G61、H01）单独成 issue，并给更长的超时。
  5. 冻结文件写进 BANNED 检查，防止 worker 顺手改。
- **E-resume：** 沿用 r16-e-prod，apply-needed -> supervisor apply -> start.sh；每个 issue 之后跑 E0-6 断言脚本。

### 6.8 依赖顺序

```
今天:  E0-1..E0-7 (AWS 止血 + brief rebase)
        |
        +--> E06 -> E07 -> E08 -> E09 ----------------------+
        |                  |        \                       |
        |                  |         +-> F41, G48, H06, H11 |
        |                  +-> F05, F42, G05                |
        |     E12 (先于 F01 上线) -> F01 -> F27             |
        |                                                   |
        +--> F02, F03, F04, F20, F21 (并行，高杠杆)          |
        +--> G00 -> G1 (G01..G12) -> OTA 发布到 1.6.1       |
                     -> G20 -> G21 -> G3 -> OTA 发布        |
                                        |                   |
                                        v                   v
                            H01 -> H02..H11 -> H13 (app.json 1.7.0，需 E09 与 AWS-11 就绪)
                                                 -> build -> TestFlight -> 提审
之后:  E10 (如未做), E11, E13, E14, E15, G60/G61, H12 (深色)
```

**需要 owner 真机验证的：** G00、G01、G02、G03、G04、G05、G06、G07、G08、G09、G10、G31、G33、G34、G35、G37、G38、G41、G42、G43、G45、G47、G49，H01-H11 与 H13，以及 E08、E09 apply 后的登录/同步冒烟。模拟器录屏只作为补充证据：Skia/Reanimated 的帧率、触觉、静音键在模拟器上不准。

---

## §7 1.7.0 发布与审核步骤

1. **前置检查：** E0 已完成，E06-E09 已 apply 且 plan EMPTY；AWS verify 脚本已去掉 1.6.1 字面值（AWS-11）；F01 之前 E12 的 schema 门已上线；G1、G2、G3 都已合并，并且已经用 `ota.sh` 发布到 runtime 1.6.1。
2. **版本：** H13 在 `mobile/app.json` 把 version 设为 1.7.0，并递增 buildNumber（`ios-build.sh` 会校验）。EAS production env 设 `EXPO_PUBLIC_API_BASE=https://api.developercards.app`（H11）。
3. **Gate：** `npm run test:typecheck && npx vitest run`、`npx expo-doctor`、`npx expo export -p ios` 全绿。
4. **构建：** `mobile/scripts/release/ios-build.sh`，内部是 `eas build --platform ios --profile production --non-interactive --json`，轮询到 FINISHED，输出 build ID。会消耗构建额度。
5. **归档检查：** 确认包里有 PrivacyInfo.xcprivacy，且 Info.plist 有 NSPhotoLibraryAddUsageDescription（MSHELL-04）。
6. **TestFlight：** `mobile/scripts/release/ios-submit.sh`，内部是 `eas submit --platform ios --profile production --latest --non-interactive`，轮询 ASC 直到 processingState=VALID。
7. **owner 真机验收（TestFlight）：**
   - 从 1.6.1 升级后仍保持登录（Keychain 迁移）。
   - sandbox 购买能解锁（MGACHA-04）。
   - 找回密码与注册确认。
   - 提醒开关。
   - 分享 -> Save Image。
   - 长 AWS 题在 CardDetail、SessionCard、MCQ 里完整显示。
   - 抽卡仪式声音与触觉。
   - 离线横幅。
   - tab 切换不堆栈。
   - Sentry 能收到测试事件。
8. **ASC 元数据：** 新建 `mobile/scripts/release/whats-new-1.7.0.txt`，description/keywords/promo/subtitle 沿用 1.6.1 或更新。先跑 plan（只读）：
   `node mobile/scripts/release/asc-release.cjs --version 1.7.0 --build <N> --wait-build --whats-new mobile/scripts/release/whats-new-1.7.0.txt --release-type <见 §8>`
   确认无误后加 `--apply`，最后 `--submit`。exit 3 表示 Apple 会话过期，owner 重跑 `eas credentials --platform ios`。
9. **审核备注：** 注明账号删除会删除服务端数据（MACCT-01/F15）、购买用 sandbox 可解锁，以及权限字符串的用途。
10. **批准后：** 以 runtime 1.7.0 发布后续 OTA，并继续单独给 1.6.1 发布，直到占比降下来（按 clientCapabilities 的 updateId 分布判断）。盯 Sentry 与 alarm（此时 SNS 已有订阅）。

**回滚方案**

| 对象 | 方式 |
|---|---|
| OTA（任一 runtime） | 用 `eas update:republish` 重新发布上一个已知良好的 update group 到 production channel；先用 remote config kill switch（mcq.enabled、paywall.hidden）止血 |
| 1.7.0 binary | 已上架的 binary 不能回滚：靠 kill switch、runtime 1.7.0 的 OTA 热修；严重时用 forceUpdateGate 引导更新到修复版本。发布方式见 §8 决策 11 |
| server（core-vpc/worker） | prod alias 指回上一个版本；E06 专用回滚：用 PGUSER=postgres 重新部署 |
| console | 用上一版构建重跑 `deploy.sh`（F35 之后旧 chunk 保留，打开的 tab 不会坏） |
| infra | revert terraform 变更并 apply；RDS 有 14 天备份和 pre-E02 快照 |
| 内容 | `POST /api/v1/admin/decks/{id}/rollback`（F29 之后在 console 的 Builds 面板里操作） |

---

## §8 风险与待决问题（owner 决策）

| # | 问题 | 选项 | 推荐默认 |
|---|---|---|---|
| 1 | 47 个死/mock 页面 | 全删 / 保留部分待接线 | **全删**；Achievements、Plan、离线页以后另立需求在真实数据上重做 |
| 2 | 深色模式进不进 1.7.0（MCORE-23，L） | 做 / 推迟 | **推迟**：1.7.0 只做语义 token（G50）和 cosmic 状态栏（G45），userInterfaceStyle 保持 light |
| 3 | 音频引擎换 react-native-audio-api（MGACHA-06，binary） | 1.7.0 换 / 只做 OTA 缓解 | **先做 G09 + G41 测量**；bed 边界和 hit 延迟仍能测到就进 H08，测不到就推迟 |
| 4 | mobile refresh token 有效期（AWS-08/MACCT-04） | 90-365 天，是否轮换 | **90 天，暂不轮换**；轮换等和 Amplify 一起测过再开 |
| 5 | 删除公开桶 devcards-content-dev（AWS-13） | 删 / 留 | **删** |
| 6 | E12 与 E10 是否进 1.7.0 | 做 / 推迟 | **E12 做**（1.7.0 带 migration 022）；**E10 有余力就做**，否则 1.7.0 后第一个 |
| 7 | 崩溃上报选型（MSHELL-02） | Sentry / 自建端点 | **Sentry**（数据建议）；过渡期先用 G12 自建端点。Sentry 费用本次没评估 |
| 8 | FoilLayer（MGACHA-10） | 传 LUT / 删 | **传 LUT 做真机实测**，掉帧就删 SkSL 和 prewarm |
| 9 | 冻结文件例外：删 progressSync.ts:141 的 token 副本（MACCT-10） | 签字例外 / 不改 | **1.7.0 不改**，Keychain 只接管 Amplify 存储 |
| 10 | Console WAF（+$6-9/月） | 加 / 不加 | **不加**；先靠 E08 authorizer、MFA 和 CSP（F42） |
| 11 | 1.7.0 发布方式（asc-release `--release-type`） | AFTER_APPROVAL / MANUAL | **MANUAL**：本版会分叉 runtime 并升级 SDK，批准后先做一轮真机确认再手动放出 |
| 12 | 9 月预算超支（AWS-19） | 调预算 / 接受 | **接受这次一次性超支**（$20 域名），加 Project=DeveloperCards 的过滤预算 |
| 13 | SRP 切换后移除 USER_PASSWORD_AUTH（MACCT-25） | 立刻 / 等普及 | **等 1.6.x/1.7.0 的 SRP 客户端普及后**再从 Cognito 客户端移除 |
| 14 | 大拆分 G60/G61 进 1.7.0 吗 | 进 / 1.7.x | **1.7.x**，1.7.0 只做修复和删除 |
| 15 | 删号是否同时撤销订阅 | 仅提示 / 服务端处理 | **仅提示**用户去 App Store 取消（App Store 订阅只能由用户自己取消） |
| 16 | worker 选择 | 等 Codex 额度 / WORKER=claude / 买额度 | **WORKER=claude**；是否买 Codex 额度由 owner 决定 |
| 17 | E08 audience 配错会让所有 mobile 调用 401 | - | apply 前在 plan JSON 里核对 audience，apply 后立刻真机登录 + 同步冒烟，准备好回滚 plan |
| 18 | E06 切换生产 DB 用户 | - | 低峰期执行，回滚方法是用 PGUSER=postgres 重新部署，apply 后先跑一次发布和同步冒烟 |

---

## 附录

### A. 被证伪的发现

无（REFUTED = []）。

### B. 复核后降级（DOWNGRADE），保留但调整了判断

| ID | 复核说明 |
|---|---|
| CFE-01 | 丢字段属实；DeckEditPage:471-480 有 'Effective tier' 与 tier 覆盖，且只有一个作者，可以补救 |
| CBE-01 | 501/路由属实；只有 admin 能进的页（App.tsx:120），单人开发，不是常用路径 |
| MCORE-02 | 截断属实；recallFirst 先完整显示题干，有 'Show full stem'，maxPerRun 2 |
| MCORE-03 | 无 ref/key/scrollTo 属实；答案折叠、MCQ 从 stem 阶段开始，大多数卡的 offset 会被夹住，只影响下一张很长的卡 |
| MCORE-04 | tab 栏常驻属实；"一键放弃"不成立（navigate 是 push，SessionCard 仍挂载，评分已保存），只剩空间成本 |
| MCORE-06 | 黑边实测属实（csharp 31-992、aws 92-923、claude 97-924），Claude 有残影；纯视觉问题 |
| MGACHA-02 | 机制属实（ambience.wav 8.0s，settle 期间 bed 持续，seek(.zero)+play 循环）；0.25 增益下是否听得出没测 |
| MGACHA-03 | 代码属实；"导致仪式卡顿"是推断，未测量 |
| MGACHA-04 | 规则属实；自 2025-12-27 就有，1.5/1.6 带着它过了审，拒审风险较低 |
| AWS-06 | 路由/authorizer/并发属实；JWT 在进程内校验，webhook 必须公开，连接耗尽只是推测 |

另外 AWS-07 复核时发现 super_admin 组是 1 个用户，不是 2 个。

### C. 审计失败的区域

无（[]）。会话记录里 playwright MCP 连接超时，github/linear/slack 等连接器需要授权，但本次审计都用不到。
