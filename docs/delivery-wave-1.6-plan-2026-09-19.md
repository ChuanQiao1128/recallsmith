# 1.6 无人值守交付方案：Dynamic Delivery Workflow（2026-09-19）

> 状态：**方案，未创建 issue、未改代码、未启动 daemon**。依据：`docs/release-1.6.0-plan-2026-09-19.md`（范围与里程碑）、`docs/mcq-card-type-plan-2026-09-18.md`（MCQ 六个阶段）、`docs/home-review-and-launch-copy-2026-09-17.md`（首页 F0–F16、推广阻塞项）、`docs/aws-saa-c03-card-backlog-2026-09-19.md`（写题清单）、`~/.claude/skills/dynamic-delivery-workflow`（v2 daemon 的机制与事故复盘）。
> 你批准后的执行顺序：我创建 GitHub issue + 每个 issue 一份 brief + `queue.tsv` → 给你看一次分解摘要（这是 skill 唯一的人工检查点）→ 你说 "go" → `preflight.sh` → `start.sh` → daemon 自己跑，我只在事件（阻塞 / 系统性错误 / 一波完成）时介入。

---

## 0. 先说能做到哪、做不到哪

**能全自动的（这份方案覆盖的）**：把 1.6 的全部代码工作拆成 **46 个 GitHub issue**，分 **4 波**，每个 issue 由 Codex 在独立 worktree 里实现，daemon 用项目真实的测试命令验证（mobile typecheck + vitest；frontend lint + vitest + build；后端 `dotnet test` 跑在 Testcontainers 的 PostgreSQL 上），验证通过就开 PR 并**立刻合并进该波的集成分支**（你要的"每完成一个 merge 一次"），失败最多重试 3 次后标 `blocked` 继续下一个；进程用 nohup + 看门狗守着，不怕这个会话挂起或电脑重启（可选 launchd）。

**做不到、必须你出面的（skill 的硬边界 + 这个项目的物理限制）**，一共 **7 类、约 12 次**，全部列在第 6 节：
1. 每波启动前的一次分解确认（skill 的唯一检查点）；
2. 集成分支 → `main` 的合并（skill 永远不碰 main；这个仓库 main 不自动部署，所以我可以在你**明确预授权**后替你点，见 6.2）；
3. 真机验证（抽卡仪式在 iPhone 上能不能到铺桌、帧率、VoiceOver、减弱动态）——daemon 只能验到 typecheck + 单元/集成测试；
4. EAS 构建 / TestFlight / App Store Connect（元数据、隐私标签、截图、提交审核）——需要 Apple 凭据和你的判断；
5. 部署（Lambda 打包上传、生产库跑迁移 018/019、控制台部署、卡组重新发布 + manifest rebuild、`eas update` 推 OTA）——brief 模板明令 worker 不许部署；
6. 素材与内容：AWS 卡包插画、音效素材（要选 CC0 文件并登记许可）、217 张新卡的写作与对照 AWS 文档核对、修正案文档的措辞签字；
7. 三个已知的产品裁决签字（学一张赚一抽修正案、总复习不给抽、冻结文件两行 mapper）。

所以"全程不管"的准确说法是：**每一波之间你出面一次（约 30–90 分钟：看摘要、真机点一遍、合并、发布），四波之间一共 4 次，加上 Wave B 结束后一次较长的发布日（构建 + TestFlight + 提交）。** 其余时间 daemon 自己跑。

---

## 1. 机制（skill v2 怎么工作，以及为什么可信）

- **一个 issue 一个 worktree**（在 iCloud 之外的 `~/.rimv-delivery/<wave>/wt/issue-N`，从集成分支最新 tip 切出）；Codex `codex exec` 在里面按 brief 实现并**增量提交**；push、开 PR、合并的权限只在 driver 手里，Codex 就算想也碰不到 main。
- **门禁（driver 自己跑，不信 worker 的汇报）**：Gate 1 diff 范围内的禁用词；Gate 1b 密钥形状的字符串、新增的 `@ts-ignore` / `eslint-disable`；Gate 2 按 diff 触发的测试；Gate 3 diffstat（给人看）。
- **串行、依赖优先**：`queue.tsv` 按依赖排序；TIER-1（别人要在它上面继续做的）通过后**立刻合并进集成分支**，依赖它的 issue 才开始；TIER-2 只开 PR。你要的"每完成一个 merge 一次" = **全部设为 TIER-1**。
- **金丝雀**：第一个 issue 跑完自动检查是否产出了干净 PR；如果失败看起来是系统性的（门禁 / brief / 认证），**暂停整波**并推事件，不会把 20 个 issue 都烧掉。
- **事件驱动、不轮询**：只在 issue-passed / issue-blocked / canary-passed / canary-failed / systemic-error / wave-done 时发 macOS 通知 + 写 `STATUS`（可选 webhook）。我不定时轮询（省你的额度），只在事件时介入；你随时可以看 `$CONTROL_DIR/STATUS`。
- **自愈**：`driver-loop.sh` 崩溃重启 + `sentinel.sh` 看门狗（90 s 启动宽限）；wave-local `STOP` 文件优雅停止；机器重启后可用 launchd 拉起（`references/launchd.md`）。
- **超时自适应**：每行自己的 `TIMEOUT_MIN`（后端/功能 75、默认 40、纯文档 20）；Codex 被要求增量提交，超时只丢未提交部分。

这些不是"简单版"：skill 的 `postmortem.md` 记录了上一次 22 个 issue 的真实事故（误伤的禁用词门禁、iCloud 复活的 STOP、`DONE` 与 `done/` 目录在大小写不敏感文件系统上冲突……），脚本里的每一行都是修过的，方案不动它们，只做第 2 节的适配。

---

## 2. 这个仓库需要的适配（启动前一次性做完）

| # | 问题 | 适配 |
|---|---|---|
| 1 | **Codex 二进制坏了**：`codex login status` 报 `ENOENT`（`@openai/codex-darwin-arm64` 的 vendor 二进制缺失） | `npm i -g @openai/codex` 重装并 `codex login`；或改用同目录的 `claude-delivery-wave`（Claude `-p` 作 worker，机制相同）。**这是 preflight 会拦下的第一件事** |
| 2 | **三个根，不是一个**：driver 的 Gate 2 假设单根前端（worktree 根目录 `npm run typecheck` / `npm run test`）和一个 `DOTNET_DIR` | 给 driver 加一个**按路径前缀的验证表**（小改，加法）：`mobile/*` → `cd mobile && npm run test:typecheck && npx vitest run`；`frontend/*` → `cd frontend && npm run lint && npx vitest run && npm run build`；`src_C/*` → `cd src_C && dotnet test Tests/RecallSmith.Lambda.IntegrationTests`（CI 就是这条，`DOTNET_DIR` 直接指 `src_C` 但命令要钉到这个项目，否则 `dotnet test` 不知道选 sln 还是 csproj）；`snowflake/*`、`docs/*` → 非空检查 |
| 3 | **node_modules 符号链接**：driver 只在 worktree 根链接 `$REPO/node_modules` | 同一处补 mobile 与 frontend 各自 node_modules 的两条链接 |
| 4 | **后端测试要 Docker**：`IntegrationTestBase.cs` 用 Testcontainers 拉 `postgres:16-alpine` | 启动前 Docker Desktop 必须在跑；preflight 加一条 `docker info` |
| 5 | **brief 级验收**：driver 只跑通用门禁，不跑 brief 里的 `verify:` 命令 | 加 Gate 2b（加法）：若存在 `$BRIEF_DIR/<TAG>.verify.sh` 就执行；每个 issue 的 AC 写成这个脚本，Codex 和 driver 各跑一次 |
| 6 | **iCloud**：仓库在 `~/Desktop/2026年9月/…`（iCloud） | 控制目录用默认的 `~/.rimv-delivery/r16-*/`（iCloud 之外）；`.git` 留在原处；197 个 " 2.*" 冲突副本**没有一个被 git 跟踪**（已核），worktree 里不会出现 |
| 7 | **冻结文件**：`gacha-v7.md §2.1` 冻结 `deckRepository.ts`、`progressSync.ts`、`review/model.ts` | brief 的 DO NOT 段明写"除了 brief 点名的那两行，不得改冻结文件"；需要你先签字（第 6 节第 7 条） |
| 8 | **测试契约不许"掰弯"**：driver 只能挡新增的 suppression，挡不住改断言 | 每个 brief 列出**允许改的字面量清单**（例如仪式的 TEST_BASE 时长必须逐字保持；只有 `Card revealed`→`Pack open` 这 5 处和 `… inbound` 这 5 处可以改），其余断言改动视为失败；Wave B 结束我人工 diff 一遍测试文件 |
| 9 | **原生改动的可验证性**：装 Reanimated / expo-audio 之后 Codex 跑不了 prebuild + pod install | Gate 用 `npx expo prebuild --no-install --platform ios` 生成 `ios/`，再 `grep -L NSMicrophoneUsageDescription ios/*/Info.plist` 作为机器可查的验收；真机和 EAS 构建留给你 |
| 10 | **禁用词表**：默认的 `humanizer\|bypass\|…` 与本项目无关但无害 | `BANNED_PATHS='mobile/src frontend/src src_C/Vpc src_C/Worker'`；禁用词表沿用默认，另加 `Gemini said`（防止内容事故重演进代码/文档） |

以上 2、3、5 是对 `driver.sh` 的三处加法（各 5–15 行），改之前我会先读 `postmortem.md`，并在 preflight 的空 diff 干跑里验证。

---

## 3. 四波、46 个 issue（草案；批准后我再 `gh issue create`）

约定：TAG 前缀 = 波；`scope` 是允许触碰的路径；`verify` 是 brief 的验收命令（driver 在 Gate 2b 执行）；全部 TIER-1（通过即合并进集成分支）；`deps` 是队列内依赖；时长按 skill 的自适应规则。每个 issue 的 brief 会直接引用计划文档的对应小节作为规格来源。

### Wave A — 保护现有用户：纯 JS 首页与上架修复（集成分支 `delivery/r16-a-home`；runtime 1.5.0 可 OTA）

| TAG | 标题 | scope | verify（摘要） | deps | 分钟 |
|---|---|---|---|---|---|
| A01 | S3 feature-flag 管道：`remoteConfig.features` + `featureFlags.ts` 快照 + `useForceUpdateGate` 接入 | `mobile/src/config/*`, `mobile/tests/unit/featureFlags*` | typecheck + vitest；新单测：缺省值、合并、冷启动语义 | - | 40 |
| A02 | Home 第 1 批：F6 删假包 + 空态兜底、F1 删 kicker/缩 hero、F13 居中、F15 删呼吸循环 + 减弱动态守卫、F7 wordmark、F8 字号 | `mobile/src/screens/HomeScreen.tsx`, `TodayPressureCard.tsx` | vitest `tests/integration/home*`；断言 `home-pack-visual` 仍存在、无 "Coming soon" 字面 | - | 60 |
| A03 | Home 第 2 批：F2 四格改 Due/New/Learned/Total、F4 去重、F5 换词（含 3 处测试字面量） | `homeSelectors.ts`, `TodayPressureCard.tsx`, `tests/integration/home-*`, `tests/unit/homeSelectors.spec.ts` | vitest；新单测：subline 不含 boss | A02 | 60 |
| A04 | Home 第 3 批：F3 新用户 CTA 直达 Draw、F12 包 = 按钮、F16 渲染 goal 行 | `homeSelectors.ts`, `HomeScreen.tsx`, tests | vitest；新集成 case：canStudy=false + install + wallet 3 → `Draw`；wallet 0 → Library | A03 | 60 |
| A05 | R2 通知：`syncDailyReminders` 只 `getPermissionsAsync`；标题改 DeveloperCards；默认一条提醒；权限提示挪到第一次开包后 | `mobile/src/notifications/reminders.ts`, `AudienceSurveyScreen.tsx`, `PermissionPromptScreen.tsx`, `DrawResultScreen.tsx` | vitest；新单测：sync 不调用 `requestPermissionsAsync` | - | 40 |
| A06 | R3 付费墙：渲染 `priceString`/周期、Terms + Privacy 链接、`features.paywall.hidden` 远程隐藏 | `PaywallScreen.tsx`, `src/premium/*`, `SettingsScreen.tsx` | vitest；组件测试：无 price 时不渲染购买按钮 | A01 | 40 |
| A07 | R4 真删账号：`AccountSection` 调 Amplify `deleteUser` + 清用户分区存储 + 登出；删 mock 岛（`SettingsMainScreen`/`SettingsAccountScreen`/`DeleteAccountConfirmScreen`/`src/mock/settings.ts`）+ `App.tsx` 路由 | 上述文件 | typecheck + vitest；断言 mock 路由不再注册 | - | 60 |
| A08 | E6 钱包/抽卡状态韧性：登录时把 anon 分区的 draw state 并入用户分区（仿 `adoptPendingProgressEvents`） | `drawStateStore.ts`, `drawStateSync.ts`（不碰 `progressSync.ts`） | vitest；新单测：anon owned ∪ user owned | - | 60 |
| A09 | I2 Library 未安装时不抛错：走安装路径而不是 "Deck is not installed yet" | `LibraryScreen.tsx`, `deckActionResolver.ts` | vitest 集成：未安装 → 触发 install | - | 40 |
| A10 | R8 Me / Help / Profile 占位文案换真页面 + 真 FAQ | `MoreScreen.tsx`, `src/mock/faq.ts`→`src/content/faq.ts`, `ProfileScreen.tsx` | typecheck + vitest；断言无 "support rail"/"Developer tools" 字面 | - | 40 |

**Wave A 结束你要做的**：看 STATUS → 集成分支合 main（或授权我合）→ 可选：`eas update --channel production` 推 OTA 给 1.5.0 用户（不推也行，代码会随 1.6.0 binary 一起走）。

### Wave B — 原生基座 + 抽卡仪式 Seam of Light（集成分支 `delivery/r16-b-ceremony`，从 A 的集成分支切）

| TAG | 标题 | scope | verify（摘要） | deps | 分钟 |
|---|---|---|---|---|---|
| B01 | M2 原生提交（一个 commit）：版本 1.6.0/build 16、装 reanimated ~4.1.1 + worklets + expo-audio、删 lottie + expo-av、`app.json plugins: [["expo-audio", {"microphonePermission": false}]]`、Skia 钉 2.2.12、`GestureHandlerRootView`、Sentry + 根 ErrorBoundary、expo-store-review + scheme、view-shot + sharing、`supportsTablet: false` | `mobile/package.json`, `app.json`, `App.tsx`, `src/observability/*` | `npm ci`；typecheck + vitest；`npx expo prebuild --no-install --platform ios` 成功且生成的 Info.plist **不含** `NSMicrophoneUsageDescription`；`__DEV__` 下 `_WORKLET` 断言存在 | - | 75 |
| B02 | `reanimatedGuard.ts`（`motionAvailable` 单判别量 + no-op 兜底）+ `ceremonyTimings.ts`（TEST_BASE 逐字 = 今天基础表；DEVICE 表 + `settleMs`/`rimSettleMs` 词汇）+ `tests/setup/ceremony.ts` mock + 单测 | `mobile/src/components/ceremony/reanimatedGuard.ts`, `src/features/gacha/draw/ceremonyTimings.ts`, `tests/setup/*`, `tests/unit/ceremonyTimings.test.ts`, `vitest.config.ts` | vitest；单测断言 COM<RAR<LEG、hold 档差 ≥ 240、anticipation 带宽、toTable ≤ 3300/5500 | B01 | 60 |
| B03 | 纯模块：`spillSchedule.ts`（60 ms 交错、featured 最后）、`skipPolicy.ts`（never goResult）、`ceremonyPrefs.ts`（fail-closed）+ fast-check 单测 | `src/features/gacha/draw/*`, `tests/unit/*` | vitest | B01 | 40 |
| B04 | `ceremonyAudio.ts` 改 expo-audio 三层混音 + 按名增益表 + 预热；`ceremonyHaptics.ts` 限速器（≤3/s、LEG 一次 Success、RM 一次 Light）+ 单测（mock expo-audio/haptics） | `src/components/ceremonyAudio.ts`, `ceremonyHaptics.ts`, tests | vitest | B01 | 60 |
| B05 | `StageCanvas.tsx`：单个 Skia Canvas（暗角、SweepGradient 射线、光晕 `interpolateColor(tell)`、封口漏光、闪光矩形、稀有度描边、Atlas 粒子）+ 渲染 smoke 测试（mock Skia） | `src/components/ceremony/StageCanvas.tsx`, tests | typecheck + vitest；禁 BackdropBlur / 每帧 maskFilter（grep 断言） | B02 | 90 |
| B06 | `PackTear.tsx`：卡包一张图两次裁剪绘制、锯齿封口 path、条带 Matrix4 rotateX、GH Pan 撕封口 + 测试用 raw responder、`accessibilityActions activate` | `src/components/ceremony/PackTear.tsx`, `src/theme/packArt.ts`（SEAM_BAND_RATIO）, tests | typecheck + vitest（a11y action 启动序列） | B02 | 90 |
| B07 | `useCeremonyTimeline.ts`：全部 shared value 与阶段映射（EMPHASIZED_OUT 等命名缓动、LEG hit-pause、silence beat） | `src/components/ceremony/useCeremonyTimeline.ts`, tests | vitest（mock reanimated：阶段→目标值表） | B02, B03 | 75 |
| B08 | `TapCard.tsx`（从 CS:147-395 抽出：抬起/翻转/落地、90 ms 队列、RAR/LEG 聚焦飞入、GH Pan 倾斜）+ `FoilLayer.tsx` 替换 `HolographicLayer`（修 `useClock`/`useDerivedValue` 崩溃） | `src/components/ceremony/TapCard.tsx`, `FoilLayer.tsx`, `src/components/HolographicLayer.tsx`（删或改） | typecheck + vitest；断言 `disabled` 在非 table 阶段 | B02, B04 | 90 |
| B09 | `DrawCeremonyScreen.tsx` 接线：阶段机只靠定时器、删 Lottie/orbit setInterval/滑块、接 B02–B08、RM 平行路径、fallback 渲染器、`tapFlow` 参数、FF 门；按 test_changes 改集成测试（TEST_BASE 逐字不变；只允许改 `Card revealed`→`Pack open` ×5、`… inbound`→`Pack inbound` ×5、删 3 个 Lottie 用例，新增 tapFlow/RM/a11y/fallback 用例） | `src/screens/DrawCeremonyScreen.tsx`, `tests/integration/draw-ceremony.screen.test.tsx` | vitest 全套；`ceremonyTimings` 单测；grep：源码不再 import lottie | B05, B06, B07, B08 | 90 |
| B10 | `ceremonyCopy.ts`（Pack inbound / Pack open）、`DrawResultScreen` 的 `revealedUids` + CardFace 模板、`DrawScreen` 预热（音频 + 着色器）、`navigation/types.ts` 参数 | 上述文件, `tests/integration/draw-result.screen.test.tsx` | vitest | B09 | 60 |
| B11 | 清理：`CeremonyLottie.tsx` → `ceremonyStyles.ts` + `FeaturedCard.tsx`；删 SparkleField/ParticleBurst/MultiPackFlyIn、`assets/lottie/*`、`scripts/gen_lottie.py`、15 处 shadowRadius | 上述文件 | typecheck + vitest；grep：无 `shadowRadius: [1-9][6-9]\|[2-9][0-9]` | B09 | 40 |
| B12 | 素材生成脚本：`gen_card_frames.py`（3 稀有度框 + 箔 LUT）、`gen_card_back.py`（每卡组卡背 ≤ 200 KB）、粒子精灵表、9-slice 光晕；`packArt.ts` 注册 + `normalizeSlugForPack aws-saa-c03 → aws` | `mobile/scripts/*.py`, `mobile/assets/packs/*`, `assets/ui/*`, `src/theme/packArt.ts` | `python3 scripts/gen_*.py` 退出 0 且 PNG 尺寸符合（`sips -g pixelWidth`）；vitest packArt 单测 | B01 | 60 |
| B13 | Dev 工具：`CeremonyTuning` 屏（DEVICE 时长滑块 + 帧间隔探针）+ DebugMenu 种子（钱包 30/5、只剩 Legendary、强制 fallback、强制 repeat） | `src/screens/dev/CeremonyTuning.tsx`, `DebugMenuScreen.tsx` | typecheck + vitest；断言 `__DEV__` 门 | B09 | 40 |
| B14 | 文档：重写 `mobile/docs/qa/animation-quality-rubric.md`（7 阶段、DEVICE 表 + 上限）、新 `docs/design/v10-ceremony-seam-of-light.md`、v9 标记 superseded；`LICENSE-ASSETS` + `assets/sfx/LICENSES.md` 模板 | `mobile/docs/**`, `LICENSE-ASSETS` | 非空 + 链接存在 | B09 | 20 |
| B15 | C4 分享抽卡图（view-shot + expo-sharing，DrawResult 按钮）+ R7 评分弹窗触发（首次 LEG / 7 天连续，一次）+ deep-link `linking` 配置 | `DrawResultScreen.tsx`, `src/features/gacha/share/*`, `App.tsx`, `src/features/gacha/milestones/*` | typecheck + vitest（mock sharing/store-review） | B10 | 60 |

**Wave B 结束你要做的（这是最长的一次出面，约 1 天）**：EAS dev-client 构建（iOS + Android）→ 真机：单抽 COM / 单抽 LEG / 十连 LEG 都能到铺桌且不崩，帧间隔探针 p95 < 22 ms，减弱动态、VoiceOver 各过一遍，对照 Pocket/Hearthstone 参考签字 → 放入 AWS 封面插画和音效文件（B12/B14 留了位置）→ 内容清理（27 条修补 + 2 张退役 + `total_cards`）和商标声明 → 生产构建 → TestFlight → App Store Connect 元数据、隐私标签、8 张截图 → 提交审核。

### Wave C — 服务端 + 经济 + topic + 总复习（集成分支 `delivery/r16-c-economy`，从 B 切；审核期间跑）

| TAG | 标题 | scope | verify（摘要） | deps | 分钟 |
|---|---|---|---|---|---|
| C01 | E1 学一张赚一抽：`rewardResolver`（每张新卡首次 Hard+ 评分 +1、清空到期每天 +1 一次、饥饿保底不变）+ 账本 `newCardPullPaidUids`（按卡组 × 用户分区）+ `FREE_PULL_CAP` 60 + SessionSummary 接线 + `tests/unit/rewards.test.ts` 重写 | `src/features/gacha/rewards/*`, `constants.ts`, `SessionSummaryScreen.tsx`, `sessionStore.ts`, tests | vitest；性质测试：每 uid 只付一次、Again 首见不付、重发 Hard+ 才付 | - | 75 |
| C02 | E2+E3：`sessionBuilder` 删 1–2 张新卡额度、修 limit 公式；新卡 ≥ 20 张后每 10 张一条"明日复习约 N 张"预估（`computeTomorrowLoad`，不拦截） | `planner/sessionBuilder.ts`, `planner/loadForecast.ts`, `SessionCardScreen.tsx`（一行提示）, tests | vitest；单测：1 张新卡 limit=1；预估公式 | C01 | 60 |
| C03 | H3 Home 第 3 批：F9 subline 按 draw.state、F10 locked 文案/`Caught up`、F11 `masteredCount` | `homeSelectors.ts`, `deckActionResolver.ts`, `contracts.ts`, `HomeScreen.tsx`, tests | vitest | C02 | 40 |
| C04 | E4 考前总复习模式：planner `sweep` 模式（已拥有卡按最久未见排序、N 天分完）、Library/Home 入口、每卡不给抽 | `planner/sessionPlanner.ts`, `sessionBuilder.ts`, `LibraryScreen.tsx`, tests | vitest；单测：sweep 评分正常重排期、`rewardPulls` 为 0 | C01 | 75 |
| C05 | L2a topic 服务端：`018_cards_topic.sql`、`Cards.cs`/`CardsPage.cs`/`Publish.cs` select、Worker `CardExportData.Topic`（最后一个属性 + `WhenWritingNull`）、`DeckDiff`、`ContentSerializationContractTests` 黄金用例 | `src_C/Vpc/Db/Migrations/018_*`, `src_C/Vpc/Authoring/*`, `src_C/Worker/**`, `src_C/Tests/**` | `dotnet test`（Docker）；断言无 topic 时字节一致 | - | 75 |
| C06 | L2b topic 控制台：`TOPIC:` 标记、`COMPARABLE_FIELDS`、序列化往返、runner 传参 + 测试 | `frontend/src/lib/deckImport.ts`, `deckImportRunner.ts`, `src/types/card.ts`, `src/api/authoring.ts`, `frontend/tests/*` | lint + vitest + build | C05 | 60 |
| C07 | L1 topic 手机端：`CardExport.Topic`、两处 mapper 各一行（冻结文件，按签字）、Library 按 topic 分组 + 筛选芯片 | `mobile/src/types/deckExport.ts`, `src/content/deckRepository.ts`（仅两行）, `src/features/gacha/library/*`, `LibraryScreen.tsx`, tests | vitest；grep：`deckRepository.ts` diff ≤ 2 行 | C05 | 60 |
| C08 | MCQ P1a 服务端：`019_cards_mcq.sql`、`McqValidation.Canonicalize`、`Cards.cs` GET/POST/PUT（`::jsonb` cast、`JsonbCell`、explanation 门禁）、`Helpers.UpdateField.Cast` + API 测试 | `src_C/Vpc/Db/Migrations/019_*`, `src_C/Vpc/Authoring/Cards.cs`, `Helpers.cs`, `McqValidation.cs`, tests | `dotnet test`；断言 GET 返回 `mcq` 为 Object | C05 | 75 |
| C09 | MCQ P1b：`CardsPage`/`Publish` select + 入队前门禁；Worker `CardExportData.Mcq`（`JsonElement?` + `WhenWritingNull`）、`PublishJobProcessor` 42703 容错、`DeckDiff.McqEquals`（`JsonNode.DeepEquals`）、`PreviousCardDocument` + 黄金字节测试 | `src_C/Vpc/Authoring/CardsPage.cs`, `Publish.cs`, `src_C/Worker/**`, tests | `dotnet test`；黄金用例：PG 键序 `v, options, shuffle, qualifier` | C08 | 75 |
| C10 | MCQ P1c ingest：`ProgressEvents.cs` outbox payload 加 `card_format`（join cards，42703 容错，单语句保持）+ 集成测试 | `src_C/Vpc/Runtime/ProgressEvents.cs`, tests | `dotnet test`（`ProgressEventsSingleStatementTests` 仍绿） | C08 | 60 |
| C11 | MCQ P1d 导入器：`OPT:`/`WHY:`/`QUALIFIER:` 宽松标记 + 载荷校验、段键、全部 issue code、往返、fast-check `cardArb` 分支、runner 就绪守卫 | `frontend/src/lib/deckImport.ts`, `mcqRules.ts`, `deckImportRunner.ts`, `frontend/tests/deckImport.mcq.test.ts` | lint + vitest + build；断言手误 `OPT:` 行报错不吞 | C06 | 75 |
| C12 | MCQ P1e 控制台类型 + client（`mcq?: McqBlob \| null`，显式 null 清空）+ CardList 徽章 + CardForm 只读面板 | `frontend/src/types/card.ts`, `src/api/authoring.ts`, `CardForm.tsx`, `CardListPage.tsx`, tests | lint + vitest + build；`authoringRequestBody.test.ts` 列出 `mcq` | C11 | 60 |
| C13 | 分析分区：Snowflake `001…sql` 加 `card_format`/`answer_mode` 投影、基线按 `answer_mode` 分组、四条 Q/A 规则限定；`ContentIntelligence.cs` live 回退限制 + `mcqCardCount`；控制台横幅 | `snowflake/*.sql`, `src_C/Vpc/Authoring/ContentIntelligence.cs`, `frontend/src/pages/ContentIntelligencePage.tsx`, tests | `dotnet test` + frontend vitest；SQL 非空 + 关键字 grep（SQL 无法本地执行，标注） | C10 | 60 |
| C14 | 事件信封加客户端能力标记：`clientFeatures` + expo-updates `updateId`（`progressSync.ts` 冻结文件，按签字）+ `ProgressEvents.cs` 接收 + Snowflake `answer_mode` 改按它分区 | `mobile/src/sync/progressSync.ts`（限定行）, `src_C/Vpc/Runtime/ProgressEvents.cs`, `snowflake/*.sql`, tests | vitest：无标记时事件字节一致；`dotnet test` | C13 | 60 |
| C15 | 文档：`content-delivery-v3.md`、`console-import-plan.md` 增补；MCQ 方案迁移号改 019/020；经济修正案落地检查 | `docs/*.md` | 非空 | C01, C09 | 20 |

**Wave C 结束你要做的**：后端打包部署 + 生产库跑 018/019 → 两个卡组重新发布并**字节 diff**（除 buildId/sha 应一致）→ 控制台部署 → 审核通过后 `eas update` 推经济 / topic / 总复习 OTA（在通过**之前**不要推，审核中的 build 必须等于上架的 build）。

### Wave D — MCQ 手机端 1.6.1 OTA（集成分支 `delivery/r16-d-mcq`，从 C 切）

| TAG | 标题 | scope | verify（摘要） | deps | 分钟 |
|---|---|---|---|---|---|
| D01 | `McqExport` 类型、`normalizeMcq`（永不抛）、`isMcqCard(card, flags)`、mapper 两行（冻结文件）+ 安装路径测试（整包/分块/delta 往返；坏 blob → Q/A） | `mobile/src/types/deckExport.ts`, `src/features/gacha/mcq/*`, `src/content/deckRepository.ts`（两行）, tests | vitest；grep diff 行数 | - | 60 |
| D02 | `mcqVerdict.ts`（7 行映射表）+ `mcqShuffle.ts`（带种子 Fisher–Yates）+ `mcqConstants.ts` + fast-check 不变量 | `src/features/gacha/mcq/*`, `tests/unit/mcqVerdict.spec.ts` | vitest：wrong⇒again、partial⇒hard、unsure⇒never good/easy、first_review⇒never easy | D01 | 60 |
| D03 | `sessionPlanner.kindHint` + `features.mcq.maxPerRun` 轮换（新卡桶）+ 测试 | `planner/sessionPlanner.ts`, `session/sessionReviewHelpers.ts`, tests | vitest：桶序不变、`owns` 守卫不变 | D02 | 60 |
| D04 | `McqReviewBody` / `McqActionDock` / `McqCoachLine` 组件（三屏、字母按位置、Sure/Not sure/I don't know、判定态 + WHY 展开、a11y 角色）+ 组件测试 | `src/features/gacha/components/Mcq*.tsx`, tests | vitest | D02 | 90 |
| D05 | `SessionCardScreen` 分支（状态、三个 handler、`renderAsMcq` 在 setCurrent 批次里算、Next → `handleRating(mapped)`、重置）+ SessionSummary `picks?` + 集成测试 `session-card-mcq.screen.test.tsx`（含 recall-first flag 关、kill switch、Dynamic Type 文案不截断的断言） | `src/screens/SessionCardScreen.tsx`, `SessionSummaryScreen.tsx`, `navigation/types.ts`, tests | vitest 全套（现有 session-card 测试不动仍绿） | D03, D04 | 90 |
| D06 | Phase 4 打磨：`DrawnCardVm.tag` + DrawResult 面、CardDetail 芯片、Library 字样；控制台导入器非阻断 warnings 层 | `drawCommit.ts`, `DrawResultScreen.tsx`, `CardDetailScreen.tsx`, `LibraryCardTile.tsx`, `frontend/src/lib/deckImport.ts`, tests | vitest（mobile + frontend） | D05 | 60 |

**Wave D 结束你要做的**：staging 卡组（`retired` 行 + staging 前缀）上装黄金 5 张 MCQ，内部构建走一遍三屏 + Dynamic Type XL + VoiceOver；1.6.0 上架 ≥ 14 天或 7 日活跃 ≥ 80% 是 1.6.0 后，`eas update` 推 1.6.1 OTA；MCQ 内容按写题清单批次导入。

**没有进队列的（owner-only，第 6 节）**：EAS 构建/提交、真机验证、App Store Connect、后端/控制台部署与迁移、卡组发布与 manifest rebuild、OTA 发布、AWS 封面插画、音效素材与许可登记、217 张新卡写作与核对、经济修正案与冻结文件签字、集成分支 → main、Phase 5 行为数据（要先改隐私标签）。

---

## 4. 验证设计（每个 PR 都过的门）

| 门 | 谁跑 | 内容 |
|---|---|---|
| Gate 1 禁用词（diff 范围） | driver | 只查 Codex 新增的行 + 新文件，`BANNED_PATHS` 内；预飞行在空 diff 上干跑一次 |
| Gate 1b 密钥/抑制 | driver | 密钥形状字符串；新增 `@ts-ignore` / `eslint-disable` / 放松的 tsconfig |
| Gate 2 按根测试 | driver（适配后） | `mobile/*` → `npm run test:typecheck && npx vitest run`；`frontend/*` → `npm run lint && npx vitest run && npm run build`；`src_C/*` → `dotnet test Tests/RecallSmith.Lambda.IntegrationTests`（Docker）；docs → 非空 |
| Gate 2b brief 验收 | driver（新增） | `$BRIEF_DIR/<TAG>.verify.sh`：该 issue 的 AC 命令（新增单测名、grep 断言、`expo prebuild --no-install` + Info.plist grep、PNG 尺寸） |
| Gate 3 diffstat | 人（我在事件时看） | 超出 `scope` 的改动、测试文件被改的行数 |
| 契约字面量守卫 | Gate 2b 里的 grep | 仪式 TEST_BASE 时长逐字存在；`draw-ceremony.screen.test.tsx` 中只允许 brief 白名单的字面量变化（用 `git diff -U0 origin/$BASE -- tests/… \| grep '^[-+]' \| grep -vE '<白名单>'` 为空判定） |
| 重试与阻塞 | driver | ≤ 3 次，失败时把门禁输出回灌给同一个 Codex 线程；第 3 次失败标 `blocked` 继续下一个 |
| 金丝雀 | driver | 每波第一个 issue（A01 / B01 / C01 / D01 都是纯模块或配置，故意选最容易判定"系统性失败"的） |

真机、视觉、音效、性能、App Review 不在门里——它们在第 6 节的人工检查点。

---

## 5. 运行参数

```bash
# ~/.rimv-delivery/r16-a-home/wave.conf（每波一份，BASE/BRANCH_PREFIX/CONTROL_DIR 各自不同）
WAVE=r16-a-home
REPO=/Users/qc/Desktop/2026年9月/DeveloperCards/recallsmith
GHREPO=ChuanQiao1128/recallsmith
BASE=delivery/r16-a-home              # 永远不是 main；B 波从 A 的 BASE 切，以此类推
BRANCH_PREFIX=delivery/r16a
CONTROL_DIR="$HOME/.rimv-delivery/r16-a-home"
QUEUE="$CONTROL_DIR/queue.tsv"
BRIEF_DIR=/Users/qc/Desktop/2026年9月/DeveloperCards/recallsmith/docs/delivery/r16-issues
ATTEMPTS=3
DEFAULT_TIMEOUT_MIN=40
BANNED_TERMS='humanizer|bypass|undetect|detector|evade|Gemini said'
BANNED_PATHS='mobile/src frontend/src src_C/Vpc src_C/Worker'
DOTNET_DIR=src_C                       # 命令钉到 Tests/RecallSmith.Lambda.IntegrationTests（适配 #2）
FRONTEND_PATHS='mobile frontend'       # 适配 #2/#3 按根分派
```

预计 daemon 时间（串行，含重试）：A ≈ 8–10 h，B ≈ 16–20 h，C ≈ 18–22 h，D ≈ 8–10 h。Codex 用量按每 issue 1–3 次调用估。

---

## 6. 你必须出面的时刻（按时间顺序）

| 时刻 | 你做什么 | 约多久 |
|---|---|---|
| 启动前 | (1) 重装 Codex 或选 `claude-delivery-wave`；(2) Docker Desktop 开着；(3) 签三个裁决：学一张赚一抽修正案措辞（我先起草，你改）、总复习不给抽、`deckRepository.ts` / `progressSync.ts` 各两行的例外；(4) 看 Wave A 的分解摘要，说 "go" | 30 min |
| Wave A 完成 | 看 STATUS 和 blocked 列表；集成 → main（见 6.2）；可选推 1.5.0 OTA；看 Wave B 摘要，说 "go" | 30 min |
| Wave B 完成 | EAS dev-client 构建 → 真机验证清单（到铺桌不崩 / 帧探针 / RM / VoiceOver / 参考对比签字）→ 放入 AWS 封面与音效 → 内容清理 + 商标声明 → 生产构建 → TestFlight → ASC 元数据/隐私标签/截图 → 提交审核；看 Wave C 摘要，说 "go" | 1 天 |
| Wave C 完成 | 部署后端 + 迁移 018/019；卡组重发布 + 字节 diff；部署控制台；**审核通过后**推经济/topic/总复习 OTA；看 Wave D 摘要，说 "go" | 2–3 h |
| Wave D 完成 | staging 卡组内部验证；1.6.0 采用率达标后推 1.6.1 OTA；MCQ 内容按批次导入 | 2–3 h + 写题 |
| 随时 | `blocked` 事件：我先读日志给你一句话结论，你只在"改需求还是放弃这条"时表态 | 5 min/次 |

### 6.1 内容轨道（不在 daemon 里）

217 张新卡 + 172 张补角度 ≈ 160 小时是人的工作。我可以按写题清单**逐批起草 Markdown**（导入格式），你对照 AWS 文档核对后导入——但那样 FAQ 必须写 "drafted with AI assistance, checked by me"。这个选择要在 Wave B 结束前定，因为上架文案和截图取决于它。

### 6.2 集成分支 → main 的两种做法

- **默认**：每波结束我开一个 `delivery/r16-x → main` 的 PR，CI 四个 job 绿，你点合并（1 分钟）。
- **预授权**：这个仓库 `main` 不自动部署（README 明说 "CI does not deploy"），你可以在批准时写明"每波 CI 绿后由我合并到 main"，我就替你点；daemon 本身仍然永远不碰 main。

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| Codex 对 Skia + Reanimated 4 不熟，B05–B09 产出能过 typecheck/测试但视觉不对 | 这些 issue 的 brief 直接内嵌分镜与性能预算；B13 的调参屏让你真机上改常数不用重跑；把 B05–B09 的 TIMEOUT 设 90；接受 Wave B 后你一次真机迭代（我在会话里改） |
| 测试被"掰弯"（改断言凑绿） | 白名单字面量 grep 门 + 我在 Wave B 结束人工 diff 测试文件 |
| 后端门禁慢（Testcontainers 拉镜像、一套集成测试几分钟） | 首次跑前预拉 `postgres:16-alpine`；只在 `src_C/*` 变更时触发 |
| 冻结文件被 Codex 顺手重构 | brief DO NOT + Gate 2b `git diff --numstat` 行数断言（≤ 2 行） |
| iCloud 同步干扰 | 控制目录、worktree、日志全部在 `~/.rimv-delivery`；主 checkout 在 daemon 期间我不跑 git |
| 一波中途你改了主意 | `touch $CONTROL_DIR/STOP` 30 s 内停；改 issue/brief 后删 `done/<n>` 重启 |
| Wave C 的 OTA 在审核期间被误推 | 6 节明确"通过之后才推"；`eas update` 不在 daemon 权限内 |
| 内容轨道拖后 | 黄金 5 张和 27 条修补永不裁；其余按批次滚动，不阻塞任何一波 |

---

## 8. 批准后我会按这个顺序做（仍不改产品代码）

1. 修 Codex 安装 / 确认 Docker；给 `driver.sh` 打第 2 节的三处加法并在空 diff 上干跑。
2. 起草经济修正案（`docs/economy-v2-learn-to-earn-2026-09-19.md`）给你签。
3. 创建 Wave A 的 10 个 issue + 10 份 brief + `queue.tsv`，输出分解摘要 → **停，等你 "go"**。
4. `preflight.sh` → `start.sh`；之后我只在事件时出现。
5. 每波结束：汇总 STATUS、开 → main 的 PR、准备下一波的 issue 和摘要。

<!-- paths-not-on-disk
计划中、尚未创建的文件（frontend/tests/docsPaths.test.ts 的守卫要求在此登记）：
     - docs/design/v10-ceremony-seam-of-light.md
     - frontend/tests/deckImport.mcq.test.ts
-->
