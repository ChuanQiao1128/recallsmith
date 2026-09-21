# 抽卡仪式：声音卡顿 + 动画审计与修复（2026-09-21）

分支 `fix/ceremony-audio-perf`，作为 1.6.0 二进制上的 EAS OTA 发布（无 native 变更，无 package.json / app.json 改动；新增音频资产走 expo-updates）。

问题（真机 1.6.0）："抽卡的声音一直卡顿，动画也不好"。

## 1. 声音为什么一直卡顿（根因）

| # | 证据 | 位置（origin/main） | 结论 |
|---|---|---|---|
| 1 | 垫底循环 `shimmer.wav` 只有 22 KB ≈ 0.25 s，四个 bed 名全部别名到它并 `loop = true` | `ceremonyAudio.ts:191`，`assets/sfx/shimmer.wav` | expo-audio 的 loop 在 iOS 上是 `AVPlayerItemDidPlayToEndTime` → `seek(0)` → `play()`（`node_modules/expo-audio/ios/AudioPlayer.swift:278`），每次循环都有一个小缺口；0.25 s 的文件 = 每秒 4 次缺口 = 持续的"咔咔"卡顿 |
| 2 | 每个 hit 用同一个播放器 `seekTo(0)` + `play()` | `ceremonyAudio.ts:167` | `seekTo` 在 iOS 是 async；对正在响的播放器 seek 会把尾音硬切断并重启，`card-flip` + `chime` 连点时尤其明显 |
| 3 | 播放器按需 `createAudioPlayer` | `ceremonyAudio.ts:119` | 任何没被 DrawScreen 预热到的路径（或预热失败）会在阶段计时器回调里同步建 AVPlayer（JS 线程 5–30 ms） |
| 4 | expo-audio 默认 `updateInterval = 500` | `node_modules/expo-audio/src/ExpoAudio.ts:360` | 每个正在播的播放器每 500 ms 往 JS 线程发一个 `playbackStatusUpdate` 事件；仪式期间 bed + 若干 hit 同时在响 |

### 修复

- `mobile/scripts/gen_sfx.py` 重写（仅 stdlib，确定性输出，~6 s）：
  - `ambience.wav`：**8 s 立体声无缝循环**（滤波噪声 pad + 慢速 A 大调泛音，每圈"呼吸"一次、循环点处最安静），尾段 1 s 等功率交叉淡入头段；脚本数值校验接缝（wrap step 0.007 vs 末 50 ms 常规 p99 step 0.03；首/末 50 ms RMS 比 1.07）不通过就拒绝写文件。
  - 六个 hit：`rip`（纸张撕裂，带通中心 4.2 kHz→700 Hz 下扫 + 纤维噼啪）、`whoosh`（带通噪声扫频）、`card-flip`（两段式 snap）、`card-drop`（软闷响）、`legendary`（A5-C#6-E6 上行三音钟和弦，1.9 s 尾音）、`shimmer`（短玻璃感琶音，供 chime / tail）。全部 44.1 kHz / 16-bit / 峰值 −1 dBFS / 无削波。
- `ceremonyAudio.ts`：
  - `warmUp()`（= `prewarm()`）一次建好全部播放器：bed 1 个（loop）+ 每个一次性文件 2 个 pool；DrawScreen 与 DrawCeremonyScreen mount 时都调用；时间线里不再 `createAudioPlayer`（懒建只作兜底）。
  - hit 走 pool 轮换：优先空闲播放器，重触发不再对正在响的播放器 seek。
  - 四个 bed 名共享同一个 loop 播放器：`bed('air')`→`bed('shimmer-pad')`→`bed(bedTable)` 只是音量 ramp，不重启、不 seek；淡出中重新 `bed()` 取消 pause 直接 ramp 回来。
  - `createAudioPlayer(source, { updateInterval: 60000 })`：状态事件离开 JS 线程。
  - 每个 hit 的 `Date.now` 触发延迟记入 perf 报告。

## 2. 动画审计（JS 线程逐帧工作 / 主线程提交）

| # | 发现 | 位置（origin/main） | 处理 |
|---|---|---|---|
| A1 | Skia 渲染器下 `PackTear` 的 Pan 每 10% 进度 `runOnJS(report)` → `setSwipeProgress` → **整屏重渲染 ×10**；而 `swipeProgress` 只有 fallback 渲染器读 | `DrawCeremonyScreen.tsx:644`，`PackTear.tsx:289` | **已修**：Skia 路径不再传 `onSeamProgress`（组件能力保留、fallback 的 responder 路径不变） |
| A2 | tap table（≤10 张 TapCard，每张 2 个 Reanimated.View + 4 个 useAnimatedStyle + LinearGradient + 2 张 Image ≈ 8–10 个原生视图）在 `flash-reveal` 那一帧才挂载：~80–100 个原生视图的创建 + 卡背/边框 PNG 首次解码都落在闪光帧上 | `DrawCeremonyScreen.tsx:678` | **已修**：从 `hold` 起就把 table 以 `tapTableWarm`（absoluteFill、opacity 0、pointerEvents none、VoiceOver 隐藏）提交，几何与 in-flow 版本一致；`flash-reveal` 只切样式。Reduce Motion 路径不变（没有 hold 阶段） |
| A3 | 每次翻牌 `setFlippedSet` 让全部 TapCard 重渲染（props 全是稳定引用/原始值） | `TapCard.tsx:89` | **已修**：`React.memo(TapCard)`，一次翻牌只重渲染那一张 |
| A4 | 每次阶段切换 / 翻牌都重渲染 `StageCanvas`（Skia 树重新 reconcile，`rayStops()` 重建，RSXform buffer modifier 重注册），而它的 props 在整个仪式里都不变（运动全走 shared value） | `StageCanvas.tsx:225,247,300` | **已修**：`React.memo(StageCanvas)`；`haloColors`/`leakColors` 两个相同的 derived value 合为一个（每帧少一次 interpolateColor） |
| A5 | `PackCanvas {...props}` 收到 `phase`/`disabled`/`onTear`，每个阶段都重 reconcile 三条 clip path + 两次图像绘制 | `PackTear.tsx:180,322` | **已修**：只传绘制需要的 7 个 props 并 `React.memo` |
| A6 | 卡背 / 边框 / 封面 PNG 首次绘制才解码（csharp 封面与卡背是 1024×1536，各 ~1 MB） | `TapCard.tsx`、`PackTear.tsx:190` | **已修（部分）**：mount 时 `Image.prefetch` 卡背 + 三个边框 + 封面 + glow + particles（全部 guarded）；Skia `useImage` 的封面解码仍在 JS 线程、发生在 mount（tear 之前，不在时间线里） |
| A7 | `raysAngle`（14 s）与粒子 `clock`（14 s）全程 withRepeat：Skia 舞台画布在 swipe 待机时也 60 fps 重绘；120 个 RSXform 每帧重算（burst 前全部置零） | `useCeremonyTimeline.ts:229`，`StageCanvas.tsx:280,300` | **暂缓**：都在 UI 线程 / GPU，280×360 画布代价小；改成按阶段启停会动 B00 §2.8/§2.10 的 timeline 契约 |
| A8 | `SpillSampler` 100 ms 一次 setState（只重渲染 1×1 叶子） | `SpillSampler.tsx:20` | **保留**：设计决策 #9 / B00 §2.12 契约 |
| A9 | `PackTear` 三条 clip path 每帧 `Path.Make()`（seam 动画期间） | `PackTear.tsx:196-207` | **暂缓**：仅在手势与 S3 扫描的 ~0.3–0.6 s 内发生，UI 线程 |
| A10 | `TapCard.slotStyle` 里的 `zIndex` 由动画样式驱动（可能触发一次 layout） | `TapCard.tsx:167` | **暂缓**：只在 focus 切换时发生一次 |
| A11 | 阶段切换由 `setTimeout` 驱动：JS 线程忙时会晚一帧，但不会阻塞 UI 线程动画 | B00 §3.2 | **保留**：契约；perf 报告里的 per-phase durations 可直接看到偏差 |

## 3. 可在生产里读到的性能记录器

- `mobile/src/features/gacha/draw/ceremonyPerf.ts`：仪式期间采样 JS 线程 rAF 间隔（从第一个非 swipe 阶段开始，上限 4000 帧）、统计 >32 ms 的掉帧、记录阶段时间戳、音频 hit 延迟、UI 线程帧统计（Reanimated `useFrameCallback`，4 个标量 shared value）、设备 / JS 引擎 / update id；unmount 时写入 AsyncStorage `recallsmith:ceremonyPerf:last`。
- DebugMenu 新增 "Last ceremony report" 卡片（p50/p95/max、掉帧数、各阶段时长、音频延迟、设备），可 Reload / Show JSON（可选中复制）。
- **生产可达**：Settings → "App version x.y.z" 连点 7 次（3 s 内）→ DebugMenu；`__DEV__` 段落原样保留。DebugMenu 里 wallet / seed 工具本就只在 `__DEV__` 渲染，另外加了 `confirmDevOnly`（非 dev 时先弹 "Dev only" 确认）；Reset 仍走既有 Alert 确认。

## 4. 测试

`npm run test:typecheck` 通过；`npx vitest run`：128 files / 866 tests 全绿。新增 / 重写：`ceremonyAudio.test.ts`（18）、`ceremonyPerf.test.ts`（12）、`debugTapCounter.test.ts`（3）、`debug-menu-perf.screen.test.tsx`（4）、`settings.screen.test.tsx`（+1：7 连点）、`draw-ceremony.screen.test.tsx`（+3：warm table、RM 不 warm、perf 报告阶段序列）。

## 5. 待办 / 需要真机确认

1. 真机跑一次 single LEG + 10 连 LEG，打开 DebugMenu 看 "Last ceremony report"：JS p95 应 ≤ 20 ms、掉帧 ≤ 2、audio p50 ≤ 5 ms；把 JSON 贴回来。
2. 8 s 循环仍会每 8 s 有一次 expo-audio 原生的 seek→play 缺口（已放在 pad 最安静处）；若仍可闻，下一步是双播放器交替（JS 定时器驱动，需要再评估 JS 线程代价）。
3. `ambience.wav` 1.38 MB（立体声 8 s）是本次 OTA 最大的新增资产；若要缩小可改单声道（0.7 MB）或 6 s。
4. csharp 封面 / 卡背 1024×1536（各 ~1 MB）是唯一比其他包大 4× 的位图；缩到 400×580 / 400×560 与其他包一致可再省一次 6 MB 的解码。
