# v10 仪式设计：Seam of Light（1.6.0）
2026-09-20。取代 v9-draw-final-spec-and-qa.md 与 v9-copy-delta.md §7；实现契约见 docs/delivery/r16-issues/B00-contracts.md，本文只记录已建成的状态与真机验收口径。
本文中文叙述、英文标识符/testID/文件名/数字；数字以 B00 为准（B00-contracts.md），与 storyboard 冲突时以 B00 为准并注明。

## 0. 结论与范围
- 已交付：single 抽卡仪式、最小化 multi（spill = 实际张数）、桌面态（cards-on-table）、Reduce Motion 路径、fallback 渲染器。
- OTA-able（JS/资源，可热更）：阶段时长、文案、tell 颜色、spill 排布、feature flag 默认值、PNG/WAV 资源。
- Binary（需重新构建）：原生依赖版本（Skia / Reanimated / worklets）、`expo-audio` 原生模块。
- 依赖钉版：`@shopify/react-native-skia` 恰好 `2.2.12`、`react-native-reanimated` ~4.1.1、`react-native-worklets` 0.5.1、`expo-audio`；`lottie-react-native` 与 `expo-av` 已移除。
- 单一判别式：`motionAvailable`（`mobile/src/components/ceremony/reanimatedGuard.ts`）——它同时决定渲染器、时长基准与 tapFlow。
- 不在范围内：抽卡概率/保底（gacha 引擎）、钱包与结果页布局、成就系统；本文只覆盖仪式动画与其验收口径。
- 与 v9 的关系：v9 的两套编排（10-pull orbit/charge/stabilize、1-pull warmup/focus/reveal）整体作废，single 与 multi 统一到同一条 7 阶段链。
- 评分口径见 [animation-quality-rubric.md](../qa/animation-quality-rubric.md)；真机证据表由本文 §13 与 rubric §6 共同承载。

## 1. 状态机（7 阶段）
唯一阶段链（single 与 multi 相同）：`swipe -> approach -> hold -> tear-flip -> flash-reveal -> settle -> cards-on-table`。文案取自 `CEREMONY_COPY_V9`：approach 三档统一 `Pack inbound`，flash-reveal `Pack open`，settle `Cards in place`。

| phase | storyboard | enters at | title | timeline 驱动（`useCeremonyTimeline`，B00 §2.10） | sub-beats |
|---|---|---|---|---|---|
| swipe | S0/M0 | 0 | — | 手势阈值 `SWIPE_TRIGGER_DISTANCE` 72 | 起手 |
| approach | S1/M1 | swipe 结束 | `Pack inbound` | rays + packScale + halo 同步推进 | 静默 |
| hold | S2/M2 | approach 结束 | `Pack inbound` | tell 在前 60% 到达 | tell、silence beat（末 `beatMs`）、LEG hit-pause |
| tear-flip | S3/M3 | hold 结束 | — | 单一撕封口，`flipMs` 翻面 | spill 起于 tear 的 50% |
| flash-reveal | S4/M4 | tear-flip 结束 | `Pack open` | flash（RM 下 `opacity` 恒 0） | — |
| settle | S5/M5 | flash-reveal 结束 | `Cards in place` | 收束 `settleMs`、`rimSettleMs` 定色 | CTA 出现 |
| cards-on-table | S6/M6 | settle + `tableTailMs` | — | 桌面锁定 | multi spill 落位 |

- 计时铁律（B00 §3.2）：每次阶段切换都是 `setTimeout`，无原生回调参与导航。
- 可调用 `goResult` 的控件：settle CTA、table CTA、`Leave ceremony`、以及 RM / tapFlow-off 收尾 tail。

## 2. 时长表：DEVICE / TEST_BASE 与上限
DEVICE / TEST_BASE（B00 §2.2 逐字复制）：

| table | single approach | single hold COM/RAR/LEG | single tearFlip | single flashReveal | single settleMs | multi approach | multi hold COM/RAR/LEG | multi tearFlip | multi flashReveal | multi settleMs | tableTailMs |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DEVICE | 600 | 360 / 620 / 880 | 600 | 320 | 520 | 900 | 600 / 860 / 1100 | 1800 | 400 | 600 | 200 |
| TEST_BASE | 300 | 140 / 180 / 220 | 360 | 220 | 200 | 620 | 220 / 260 / 300 | 940 | 280 | 300 | 500 |

总时长与上限（`toTableMs` / `TO_TABLE_CAP_MS`）：

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

- anticipation 带宽：single COM 600–1200，其余 1200–2000。
- 子节拍常量：`beatMs` 120 / 180 / 300、`flipMs` 380 / 480 / 640、`rimSettleMs` 800 / 1000 / 1200、`liftMs` 80、`landMs` 200、`tapQueueMs` 90、`REDUCED_MOTION_FLASH_MS` 180、`REDUCED_MOTION_SETTLE_MS` 240、`SWIPE_TRIGGER_DISTANCE` 72、`TELL_FRACTION_OF_HOLD` 0.6、`FAST_FORWARD_FROM_HOLD_FRACTION` 0.6、`FAST_FORWARD_TEAR_FACTOR` 1.6、`SPILL_STAGGER_MS` 60、`LEG_HIT_PAUSE_MS` 32、`LEG_DIM` 0.3。
- §3.1 的 multi approach 比 §2 的预期带宽（Rare+/multi 1200–2000 ms）多出 20 ms，B00 §9 #3 把它收到 900：LEG multi anticipation 恰好 2000，铺桌 5000，单元测试不用为它开特例。

## 3. 减弱动态路径（Reduce Motion）
- 节奏：mount 0 → `flash-reveal`（标题 `Pack open`）180 → settle 180 → table/`goResult` 420，总 `<= 450 ms`（`REDUCED_MOTION_FLASH_MS` 180、`REDUCED_MOTION_SETTLE_MS` 240）。
- 无 swipe 阶段；无 flash：`draw-ceremony-reveal-flash` 的 `style[1].opacity` 恒 0。
- 只有 opacity-only 的 180 ms 交叉淡入淡出，无 scale/rotate/shake。
- 静态 rim tell 作为唯一稀有度线索；恰好一次 `light` 触觉；收尾 `tail('soft-chime')`。
- 仪式进行中 `reduceMotionChanged` 会重启该效果，保证不会半程混用两条路径。

## 4. Fallback 渲染器与 feature flag
- 渲染器判定（B00 §3.5，逐字）：`renderer = 'skia'` 当且仅当 `motionAvailable && skiaAvailable && flags.ceremony.seamOfLight && !flags.ceremony.forceFallback && !dev.forceFallback`，否则 fallback。
- flag 默认（B00 §3.4）：`FeatureFlags.ceremony = { seamOfLight: true, forceFallback: false }`。`seamOfLight` 是总开关（kill switch，关掉整套仪式），`forceFallback` 是诊断开关（强制走 fallback 但保留仪式流程）。
- 渲染节点：Skia 路径挂 `StageCanvas`（`draw-ceremony-stage-canvas`）；fallback 路径挂 `FallbackStage`（`draw-ceremony-fallback-stage`）。
- 时长与 tapFlow 只跟随 `motionAvailable`，与渲染器无关：fallback 下仍走同一套阶段时序。
- 任一 PNG/SFX 缺失：fallback 用纯色块 + 无音频降级，仪式仍必达 `cards-on-table`，不崩溃。

## 5. 无障碍路径（VoiceOver）
- 卡包：`accessibilityRole="button"`，label `Reward pack`，hint `Swipe right or double-tap to open`，带 `activate` 动作。
- 阶段文案：`numberOfLines={1}`，live region 播报当前阶段。
- `Leave ceremony`：始终挂载于 opacity 0，任何阶段可达，绝不 `accessibilityElementsHidden`。
- `Speed up`：不暴露给 VoiceOver（视觉快进不作为无障碍控件）。
- table 卡片：`Card n of N, face down` / `… revealed`。
- `SpillSampler` 播报进度：`Dealing cards, N percent`。
- 焦点顺序：卡包 → 阶段文案 → CTA → `Leave ceremony`；桌面态后焦点落到第一张 table 卡片。
- VoiceOver 开启时不缩短时长（时长只跟随 `motionAvailable`），但阶段文案的 live 播报保证叙事不丢。

## 6. 玩家主动权：skip policy 与 tap-to-flip
- `skipPolicy`（B00 §2.4）：取值 `'none' | 'compress'`，永不离开仪式；`compress` 只压缩时长，不跳过阶段。
- `ceremoniesCompleted` 在 `ceremonyPrefs` 中 fail-closed 为 0（读不到就当新手，走完整仪式）。
- `compressTimings` 把 DEVICE 时长按策略压到下限。
- table CTA 文案：`Show result` / `Skip · n/N` / `Continue`。
- 交给 DrawResult 的数据：`revealedUids` + `ceremonyEcho.tableReached`；未翻的卡在结果页标 `Not flipped` chips。

## 7. 稀有度预告：tell / beat / spill
- 单通道：色温（`TELL_COLORS`）——稀有度只靠 rim 颜色，不靠文字/图标。
- swipe/approach 全通道（含文案）保密稀有度；tell 只在 hold 的前 60% 铺开。
- beat = hold 的最后一个 `beatMs`（silence beat）。
- LEG 专属：dim 0.3（`LEG_DIM`）+ 18 Hz shiver + 32 ms hit-pause（`LEG_HIT_PAUSE_MS`）。
- `buildSpillSchedule`：spill 起于 tear 的 50%，travel 取屏高 1/6，stagger 60（`SPILL_STAGGER_MS`），featured 卡最后落到 `centreSlot`。
- multi 的第二 tell：face-down 卡的 rim 颜色。

## 8. 音频与触觉
- 三层：bed（垫底循环）/ hit（一次性打击）/ tail（收尾）。
- 17 个名字：bed `crinkle` / `air` / `shimmer-pad` / `choir-swell`；hit `whoosh` / `rip` / `card-slide` / `stack-thud` / `seam-burst` / `card-flip` / `card-drop` / `chime` / `stinger` / `shimmer` / `legendary`；tail `sparkle-tail` / `soft-chime`。
- `SFX_ALIASES`（`mobile/src/components/ceremonyAudio.ts`）把每个名字映射到已提交的七个 WAV（2026-09-21 起）：四个 bed 名 `crinkle`/`air`/`shimmer-pad`/`choir-swell` 全部→`ambience`（8 s 立体声无缝循环，一个共享的 loop 播放器，换 bed 只是音量 ramp、不重启）；`chime`/`sparkle-tail`/`soft-chime`→`shimmer`，`stinger`→`legendary`，`card-slide`/`stack-thud`→`card-drop`，`seam-burst`→`rip`，`whoosh`/`rip`/`card-flip`/`card-drop`/`shimmer`/`legendary` 映射到自身；逐格记录见 LICENSES.md。
- 播放器模型（2026-09-21 卡顿修复）：`warmUp()` 在 DrawScreen 与 DrawCeremonyScreen mount 时把全部播放器建好（bed 1 个 + 每个一次性文件 2 个 pool），时间线里不再 `createAudioPlayer`；hit 走 pool 轮换，重触发用空闲播放器而不是对正在响的播放器 `seekTo(0)`；每个 hit 的 JS 触发延迟记入 `ceremonyPerf` 报告（Settings 版本号连点 7 次 → Debug menu）。
- `CEREMONY_GAIN`：bed .30 / .35 / .40（COM/RAR/LEG）、table .25、duck .15。
- prewarm：在 DrawScreen mount 时预热音频，避免首帧解码卡顿。
- 触觉限流：`<= 3 / 1000 ms`；`success()` 每次仪式最多一次且仅 LEG；Reduce Motion 下只有一次 `light`。

## 9. 素材表与许可
| path | size | generator | export（`packArt.ts`） | consumers |
|---|---|---|---|---|
| `mobile/assets/ui/frame-com.png` | ~ | `mobile/scripts/gen_card_frames.py` | FRAME_COM | FeaturedCard / FoilLayer |
| `mobile/assets/ui/frame-rar.png` | ~ | `mobile/scripts/gen_card_frames.py` | FRAME_RAR | FeaturedCard |
| `mobile/assets/ui/frame-leg.png` | ~ | `mobile/scripts/gen_card_frames.py` | FRAME_LEG | FeaturedCard |
| `mobile/assets/ui/foil-lut.png` | ~ | `mobile/scripts/gen_card_frames.py` | FOIL_LUT | FoilLayer |
| `mobile/assets/ui/particles.png` | ~ | `mobile/scripts/gen_particles.py` | PARTICLES | StageCanvas |
| `mobile/assets/ui/glow-9slice.png` | ~ | `mobile/scripts/gen_particles.py` | GLOW | StageCanvas |
| `mobile/assets/packs/aws-back.png` | ~ | `mobile/scripts/gen_card_back.py` | BACK_AWS | TapCard |

- 已提交的七个 WAV：`ambience.wav`（8 s 立体声 bed 循环）、`whoosh.wav`、`rip.wav`、`card-drop.wav`、`card-flip.wav`、`shimmer.wav`、`legendary.wav`（全部由 `mobile/scripts/gen_sfx.py` 程序合成，CC0；2026-09-21 起不再是 0.25 s 占位）。
- 许可指针：根目录 LICENSE-ASSETS（art + audio 排除在 MIT 之外），逐文件音频许可 `mobile/assets/sfx/LICENSES.md`。

## 10. 原生依赖钉版（Skia / Reanimated / worklets）
- Skia 保持恰好 `2.2.12`：更新的 Skia 需要 `react-native-worklets` `>= 0.7`，而 Expo 54 只带 0.5.1，`react-native-reanimated` ~4.1.1 与之配套；升 Skia 会拉起 worklets 版本冲突。
- 无 `babel.config.js`：worklets 插件走 Expo 默认预设，不引入自定义 babel。
- `mobile/App.tsx` 挂了一个 `_WORKLET` dev 探针，启动时确认 worklets 运行时就绪。
- Skia API 用 `RoundedRect`（不是 `RoundRect`）。
- 老 HolographicLayer（bare name）因 `useClock`/`useDerivedValue` 组合在此 worklets 版本上崩溃而被删；grep guard 现禁止 `mobile/src/components` 下出现 `useClock`。
- 动画时钟改用 `useCeremonyTimeline` 里的 `setTimeout` 阶段推进 + Reanimated 值插值，不再依赖 Skia 的每帧时钟 worklet。
- 升级 checklist：改 Skia/Reanimated/worklets 任一版本前，先在真机跑一遍 single LEG 与 10-pull LEG，确认 `_WORKLET` 探针为真、无白屏。

## 11. 文件地图与 testID 契约
- 新建/重写（ceremony 树）：`mobile/src/screens/DrawCeremonyScreen.tsx`、`mobile/src/components/ceremony/StageCanvas.tsx`、`FallbackStage.tsx`、`FeaturedCard.tsx`、`FoilLayer.tsx`、`PackTear.tsx`、`SpillSampler.tsx`、`TapCard.tsx`、`useCeremonyTimeline.ts`、`reanimatedGuard.ts`、`ceremonyStyles.ts`；时序/策略：`mobile/src/features/gacha/draw/ceremonyTimings.ts`、`spillSchedule.ts`、`skipPolicy.ts`、`ceremonyPrefs.ts`。
- 已删除（bare name，勿作全限定路径引用）：CeremonyLottie.tsx、HolographicLayer.tsx、gen_lottie.py、assets/lottie 目录。
- testID 契约（B00 §4.3）：`draw-ceremony-stage-canvas`、`draw-ceremony-fallback-stage`、`draw-ceremony-reveal-flash`、`draw-ceremony-pack`、`draw-ceremony-phase-label`、`draw-ceremony-cta`、`draw-ceremony-table-card`、`draw-ceremony-leave`。

## 12. 开发工具（CeremonyTuning / DebugMenu）
- B13 的开发屏 `mobile/src/screens/dev/CeremonyTuning.tsx`（若尚未合入你的工作树，则以 bare name `CeremonyTuning.tsx` 引用），入口 `More → Settings → DebugMenu → Ceremony tuning`，仅 `__DEV__`。
- stepper 行写入 `setCeremonyTimingOverride`，实时改单项时长。
- cap readout：显示每组 `toTableMs` 与 `TO_TABLE_CAP_MS` 的余量。
- rAF 探针：只测 JS 线程帧间隔；UI 线程真实节奏需 Instruments/gfxinfo。
- DebugMenu seeds：`Force fallback renderer`、`Force repeat ceremony`、`Seed wallet 30/5`、`Only Legendary left`。

## 13. 证据表（真机 QA 填写）
发布收尾时逐格填入；当前全部测量格为 `TBD`。

| Device | Width | Pull | toTableMs | Cap | p95 ms | max ms | LEG flip stall ms | RM | VoiceOver | Fallback | Recording |
|---|---|---|---|---|---|---|---|---|---|---|---|
| iPhone | 360 | single COM | TBD | 3300 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| iPhone | 390 | single LEG | TBD | 3300 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| iPhone | 430 | 10-pull LEG | TBD | 5500 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Android | 360 | single COM | TBD | 3300 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Android | 390 | single LEG | TBD | 3300 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| Android | 430 | 10-pull LEG | TBD | 5500 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

Sign-off：owner 把 single COM / single LEG / 10-pull LEG 与 Pocket / Hearthstone 参考并排观看，确认叙事与手感达标后签发（`docs/release-1.6.0-plan-2026-09-19.md:191`）。
