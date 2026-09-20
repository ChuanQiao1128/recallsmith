# Draw Animation Quality Rubric (Commercial Grade) — v10 Seam of Light
2026-09-20 · supersedes the v9 rubric (orbit/charge/stabilize) · contract: docs/delivery/r16-issues/B00-contracts.md

## 1) Scope
- 目标 screen: `mobile/src/screens/DrawCeremonyScreen.tsx` + `mobile/src/components/ceremony/`。
- 目标体验: 奖励抽卡仪式达到“可公开商用”的稳定度与叙事完整度；single 与 multi 共用同一条阶段链，不再有两套 orbit/charge 与 warmup/focus 编排。
- 唯一阶段链（single 与 multi 相同）：`swipe -> approach -> hold -> tear-flip -> flash-reveal -> settle -> cards-on-table`。
- 故事板映射（B00 §3.1）：`swipe`=S0/M0，`approach`=S1/M1，`hold`=S2/M2，`tear-flip`=S3/M3，`flash-reveal`=S4/M4，`settle`=S5/M5，`cards-on-table`=S6/M6。
- 编排铁律（B00 §3.2）：每次阶段切换都是 `setTimeout`，没有任何原生回调参与导航；single/multi 差异只在时长与 spill，不在阶段集合。

## 2) Pass Gate
- 动画总分 `>= 90/100`。
- 所有 `A-P0` 项必须为 0。
- `tests/integration/draw-ceremony.screen.test.tsx`、`tests/integration/draw-result.screen.test.tsx`、`tests/unit/ceremonyTimings.test.ts` 全绿。
- 六个（isMulti × 稀有度）组合的 `toTableMs` `<=` `TO_TABLE_CAP_MS`（single 3300 / multi 5500）。
- 探针 p95 `< 22 ms` 且 tear/spill 期间无单帧 `> 50 ms`。
- 首次 LEG 翻牌卡顿 `< 50 ms`。

## 3) 评分维度（100 分）
每一维引用它所打分的揭示语法规则（`docs/release-1.6.0-plan-2026-09-19.md:62-77`）。

### A. Anticipation（15）
- approach+hold 内 `>= 2` 个视觉参数同时变化（rays + packScale + halo）。
- 稀有度在 swipe/approach 全通道保密，含文案 `Pack inbound`（三档统一）。
- tell 在 hold 的前 60%（`TELL_FRACTION_OF_HOLD` 0.6）内到达，silence beat 可见。
- 15：全部满足；8：仅单参数变化或 tell 迟到；0：无前摇或稀有度提前泄露。

### B. Reveal（20）
- 一次撕封口动画对所有稀有度相同（tear-flip 不因稀有度分叉）。
- multi 的 spill 张数 = 实际抽到张数（`buildSpillSchedule`，不再补到 6 张），featured 卡最后落到中心槽（`centreSlot`）。
- `cards-on-table` 靠计时器必达；每次点击只翻一张；非 table 阶段 `TapCard` `disabled`。
- 20：全部满足；10：有揭示但顺序或计时不清；0：featured 非最后落中心，或揭示与卡面不一致。

### C. Result Settle（15）
- settle 时长 `>= settleMs`（DEVICE 520 / 600）。
- CTA `Show result` 只在 settle 阶段出现。
- 稀有度词只在有牌面朝上之后才进 footer。
- 15：全部满足；8：收束过短或锁定态不明显；0：揭示后立即跳转无法阅读。

### D. Timing（20）
- 依据 §D 的 DEVICE / TEST_BASE 表与总时长表。
- 全部六组在 `TO_TABLE_CAP_MS` 上限内：给 20。
- 任一组超上限：扣到 10；两组及以上超上限：0。
- anticipation 带宽（single COM 600–1200，其余 1200–2000）另计。

DEVICE / TEST_BASE 时长表（B00 §2.2 逐字复制）：

| table | single approach | single hold COM/RAR/LEG | single tearFlip | single flashReveal | single settleMs | multi approach | multi hold COM/RAR/LEG | multi tearFlip | multi flashReveal | multi settleMs | tableTailMs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DEVICE | 600 | 360 / 620 / 880 | 600 | 320 | 520 | 900 | 600 / 860 / 1100 | 1800 | 400 | 600 | 200 |
| TEST_BASE | 300 | 140 / 180 / 220 | 360 | 220 | 200 | 620 | 220 / 260 / 300 | 940 | 280 | 300 | 500 |

总时长表（`toTableMs` 与上限）：

| pull | anticipation (approach+hold) | settle 开始 | cards-on-table (toTableMs) | TO_TABLE_CAP_MS |
|---|---|---|---|---|
| DEVICE single COM | 960 | 1880 | 2600 | 3300 |
| DEVICE single RAR | 1220 | 2140 | 2860 | 3300 |
| DEVICE single LEG | 1480 | 2400 | 3120 | 3300 |
| DEVICE multi COM | 1500 | 3700 | 4500 | 5500 |
| DEVICE multi RAR | 1760 | 3960 | 4760 | 5500 |
| DEVICE multi LEG | 2000 | 4200 | 5000 | 5500 |
| TEST_BASE single RAR | 480 | 1060 | 1760 | — |
| TEST_BASE multi LEG | 620 + 300 | 2140 | 2940 | — |

子节拍常量（B00 §2.2）：`beatMs` 120 / 180 / 300、`flipMs` 380 / 480 / 640、`rimSettleMs` 800 / 1000 / 1200、`liftMs` 80、`landMs` 200、`tapQueueMs` 90、`REDUCED_MOTION_FLASH_MS` 180、`REDUCED_MOTION_SETTLE_MS` 240、`SWIPE_TRIGGER_DISTANCE` 72、`TELL_FRACTION_OF_HOLD` 0.6、`FAST_FORWARD_FROM_HOLD_FRACTION` 0.6、`FAST_FORWARD_TEAR_FACTOR` 1.6、`SPILL_STAGGER_MS` 60、`LEG_HIT_PAUSE_MS` 32、`LEG_DIM` 0.3。

### E. Reduced Motion（15）
- 节奏：mount 0 → `flash-reveal`（标题 `Pack open`）→ 180 settle（`Show result`）→ 420 table/`goResult`，总 `<= 450 ms`。
- contract flash `opacity` 恒 0，无 scale/rotate/shake。
- 恰好一次 `light` 触觉。
- rim 颜色作为静态 tell 保持 `>= 400 ms`。
- 15：全部满足；8：有降级但仍高运动量；0：忽略系统降动效设置。

### F. Frame Continuity（15）
- p95 `< 22 ms`，max `<= 50 ms`，首次 LEG 翻牌 `< 50 ms`。
- 采集手段：`CeremonyTuning` 探针 + Instruments/gfxinfo。
- 覆盖 360/390/430 三宽度。
- 15：全部满足；8：偶发掉帧不影响识别；0：明显卡顿导致阶段识别失败。

## 4) A-P0 Hard Fail
- `A-P0-NO-ANTICIPATION`: approach+hold 无 `>= 2` 参数同时变化，或无可感前摇阶段。
- `A-P0-ORDER-BROKEN`: multi 的 featured 卡不是最后落到中心槽，或 single 无 settle 锁定态。
- `A-P0-TIMING-OUT`: 任一组 `toTableMs` `>` 上限，或 TEST_BASE 逐字改动。
- `A-P0-REDUCED-MOTION-MISSING`: 未支持 Reduce Motion 降级。
- `A-P0-FRAME-JANK`: p95 超阈或 tear/spill 出现单帧 `> 50 ms`。
- `A-P0-COPY-MISMATCH`: 阶段文案与实际阶段不一致。
- `A-P0-EARLY-TELL`: hold 之前任何通道——halo/rays/文案/footer/音频——泄露稀有度（`docs/release-1.6.0-plan-2026-09-19.md:297`）。
- `A-P0-NATIVE-CALLBACK`: 任何阶段切换或导航依赖原生回调（B00 §3.2）。
- `A-P0-RM-FLASH`: Reduce Motion 下 flash 矩形挂载或 contract View `style[1].opacity` `!=` 0，或出现 scale/rotateY/shake。
- `A-P0-SKIP-ESCAPES`: `skipPolicy` 之外的任何快进路径；`compress` 之外的决策；首次仪式在 settle 前出现可见跳过控件；`goResult` 在 settle 前被非 `Leave ceremony` 控件调用。
- `A-P0-CANVAS-BUDGET`: 舞台 Skia `Canvas` `>` 1 或聚焦卡 canvas `>` 1；`BackdropBlur`/`Blur`/`DisplacementMap`/每帧 `maskFilter`；仪式树内 `shadowRadius >= 16`（B00 §7）。
- `A-P0-A11Y-PACK`: 卡包不是 `accessibilityRole="button"`、无 `activate` 动作、`Leave ceremony` 在任一阶段不可达、table 卡片无标签。

## 5) 数据采集要求
- 自动化（必需）：三份测试（`draw-ceremony.screen.test.tsx` / `draw-result.screen.test.tsx` / `ceremonyTimings.test.ts`）；`tests/setup/ceremony.ts` 把 `motionAvailable=false`，说明测试永远走 TEST_BASE + fallback 路径。
- 半自动（建议）：`CeremonyTuning`（`More → Settings → DebugMenu → Ceremony tuning`，`__DEV__`）的探针读数；DebugMenu 的 `Force fallback renderer` / `Force repeat ceremony` / `Seed wallet 30/5` / `Only Legendary left`。
- 真机（发布前）：6 段录屏（single COM / single LEG / 10-pull LEG × iPhone + Android）× 3 宽度；Instruments (Core Animation) + `adb shell dumpsys gfxinfo`。

## 6) 证据表（真机 QA 填写）
发布收尾时按下表逐格填入真机读数（`docs/delivery-wave-1.6-plan-2026-09-19.md:99`）；当前所有测量格为 `TBD`。

| Device | Width | Pull | toTableMs | Cap | p95 ms | max ms | LEG flip stall ms | RM | VoiceOver | Fallback | Recording |
|---|---|---|---|---|---|---|---|---|---|---|---|
| iPhone | 360 | single COM | TBD | 3300 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| iPhone | 390 | single LEG | TBD | 3300 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| iPhone | 430 | 10-pull LEG | TBD | 5500 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Android | 360 | single COM | TBD | 3300 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Android | 390 | single LEG | TBD | 3300 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Android | 430 | 10-pull LEG | TBD | 5500 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## 7) 商业级定义
- 用户在 3.3 s（single）/ 5.5 s（multi）内到达桌面（`cards-on-table`）。
- 用户在任何时点都能回答三件事：现在处于哪个阶段 / 正在揭示什么 / 下一步去哪。
- Reduce Motion 下信息完整，不靠眩光或频闪传达核心信息。
- 稀有度靠质感（rim / 箔 / 光）而不是文字提前透露。
