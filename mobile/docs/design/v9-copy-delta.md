# v9 Copy Delta (vs v8)

> **Superseded — 2026-09-20.** §7 的仪式阶段文案已被 1.6.0 改写：approach 三档统一为 `Pack inbound`，flash-reveal 为 `Pack open`（`Legendary inbound` / `Rare inbound` / `Card revealed` 不再存在）。现行规范见 [v10-ceremony-seam-of-light.md](./v10-ceremony-seam-of-light.md)。其余章节沿用。

继承 `v8-copy-guide.md` 的全部规则（语气、长度预算、大小写、标点、a11y label、i18n 准备）。本文档**仅列改动**：v9 五屏中与 v8 字符串不同的项。

未列出的字符串 = 沿用 v8。

---

## 1. CTA 主按钮

| 屏幕 | 状态 | v8 标签 | v9 标签 | 说明 |
| --- | --- | --- | --- | --- |
| Home | new session ready | `Start session` | `Open {deckTitle}` | 主入口语义从"学习"换成"开包" |
| Home | mid-session resume | `Resume session` | `Open {deckTitle}` | v9 不再把"未完成 session"作为首页主语义 |
| Home | nothing to study | `Browse decks` | `Open {deckTitle}` (disabled) | empty 时按钮 disabled |
| Home | reward pending | `Claim reward` | (不出现) | reward 自动落入钱包，不需领取 |
| Draw | 10-pull ready | `Pull 10` | `Open 10` | 用户语言：开包，不是抽取 |
| Draw | 1-pull ready | `Pull 1` | `Open 1` | 同上 |
| Draw | no pulls | `Earn pulls in study` | (按钮 disabled，下方小字 `Earn pulls by studying`) | 文字提示与按钮分离 |
| DrawCeremony | post-lock | `Show result` | `Show result` | 不变，但只在 settle 阶段渲染 |
| DrawResult | ready (still has pulls) | `Study these cards` | `Continue draw` | v9 不在 result 把用户推回学习；钱包决定 |
| DrawResult | ready (wallet empty) | `Study these cards` | `Go to Library` | 路由 Library + 自动滚到新卡 |
| DrawResult | empty | `Back to draw` | `Back to draw` | 不变 |

---

## 2. 链接 / 次级动作

| 屏幕 | 元素 | v8 标签 | v9 标签 |
| --- | --- | --- | --- |
| Home | study link (新增) | — | `Study {n} due cards` |
| DrawResult | done link (新增) | — | `Done` |
| Library | filter sheet — owned | `Owned` | `Owned` |
| Library | filter sheet — unowned | `Not yet owned` | `Missing` |
| Library | filter sheet — all | `All cards` | `All` |
| Library | empty state（全 owned） | (无对应) | title `Collection complete`，CTA `Back to all` |

---

## 3. 卡片 / 状态徽章

| 元素 | v8 文字 | v9 文字 |
| --- | --- | --- |
| 已拥有徽章 | `Owned` | (不显示文字徽章 — 视觉表达即可) |
| 未拥有徽章 | `Unowned` | (不显示文字徽章) |
| 新获得徽章 | (v8 仅 pulse 环) | `NEW`（金底深字角标 + pulse 环） |
| Mastered | `Mastered` | `Mastered`（仅在 quick-peek sheet 内显示） |
| Learning | `Learning` | `Learning`（仅在 quick-peek sheet 内显示） |

---

## 4. Hero / 元信息

| 屏幕 | 元素 | v8 文字 | v9 文字 |
| --- | --- | --- | --- |
| Home | hero eyebrow | `Today, {date}` | (不渲染) |
| Home | hero title | `{n} cards waiting` | (不渲染 — 卡包就是主视觉) |
| Home | hero subtitle | `Streak alive: {n} days` | (不渲染 — 数据进 Settings) |
| Home | pack focus meta | — | `{n} pulls · {m} due` |
| Draw | wallet meta | `{n} available · {m} reserve` | (移除独立 meta；数字进 hero 角标 `× {n}`) |
| Draw | audience label | `For {audience}` | (不渲染) |
| Draw | pity label | `Bonus reveal coming` | (不渲染；保留底层逻辑) |
| DrawResult | featured eyebrow | `Featured reward` | (不渲染；header 改为 deckTitle) |
| DrawResult | header title (新增) | — | `{deckTitle}` |
| DrawResult | collection bar | — | `{owned}/{total}` |
| Library | header subtitle | (按 v8 设计) | (不渲染；位置让给 collection bar) |
| Library | collection bar | — | `{owned}/{total}` |

---

## 5. 空态 / 错误

| 屏幕 | 场景 | v8 文字 | v9 文字 |
| --- | --- | --- | --- |
| Home | 无 deck | title `No decks yet` / body `Pick a deck to start studying.` | title `No packs yet` / body `Install your first pack to start.` / CTA `Browse packs` |
| Library | 无匹配（filter） | title `Nothing matches` / body `Try clearing the filter or pick another deck.` | 沿用 v8（合适） |
| Library | 全 owned，filter=missing | (v8 未规定) | title `Collection complete` / body `You've got every card in this pack.` / CTA `Back to all` |
| DrawResult | empty draw | title `Nothing pulled` / body `The draw didn't return any cards. Try again.` | 沿用 v8 |

---

## 6. 确认弹窗

v9 删除：
- v8 的 "Spend 10 pulls?" multi-confirm sheet — v9 Draw 不再有 10 抽确认。

v9 保留：
- v8 SessionCard 的 "End this session?" pause sheet（不是 v9 五屏，但跨越未变）。

---

## 7. Ceremony 阶段 copy

`CEREMONY_COPY` 在 v8 已定义。v9 把 4 阶段（warmup/focus/lock/reveal 与 orbit/charge/surge/stabilize）替换为 5 阶段（approach/hold/tear-flip/flash-reveal/settle）。下表是 v9 的 phase copy（单/十连共用）：

| Phase | Title | Body |
| --- | --- | --- |
| approach | `Pack inbound` | `Your pack is moving into focus.` |
| hold | `Hold steady` | `The reveal is loading.` |
| tear-flip | `Opening` | (无 body — 视觉为主) |
| flash-reveal | `Card revealed` | (无 body) |
| settle | `Cards in place` | `Tap to see your draw.` |

LEG / RAR 时，approach 的 title 改为：
- LEG approach: `Legendary inbound`
- RAR approach: `Rare inbound`
- COM approach: `Pack inbound`

`CEREMONY_COPY` 文件中保留 v8 旧 key（不删，避免 v8 五屏未涉及但其它代码引用），同时 export v9 的新结构 `CEREMONY_COPY_V9`。codex 在 ceremony 屏内 import `CEREMONY_COPY_V9`。

---

## 8. a11y 标签（覆盖）

| Visible | v8 a11y label | v9 a11y label |
| --- | --- | --- |
| `Open 10` | (v8 中 `Pull ten cards`) | `Open ten cards from {deckTitle}` |
| `Open 1` | (v8 中 `Pull one card`) | `Open one card from {deckTitle}` |
| `Continue draw` | — | `Continue drawing from {deckTitle}` |
| `Go to Library` | — | `Go to library, scroll to new cards` |
| `Done` | — | `Done. Back to home.` |

---

## 9. 禁止短语（v9 新增）

继承 v8 §10 的所有禁止项，并新增：
- "Pull" 作为开包动词 → 改用 "Open"。仅在底层数据字段（`availablePulls`、`pull count`）可保留 "pull" 词。
- "Reward" 作为名词 → 减少使用；改用具体物（"card", "pull", "pack"）。
- "Wallet" 作为用户面向词 → 内部数据字段保留 `walletPulls`，UI 中改为 `× {n}` 角标，无 "wallet" 字面。
