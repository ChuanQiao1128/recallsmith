# Draw Animation Quality Rubric (Commercial Grade)

## 1) Scope
- 目标 screen: `src/screens/DrawCeremonyScreen.tsx`。
- 目标体验: 奖励抽卡动画达到“可公开商用”的稳定度与叙事完整度。
- 评估对象分两条路径：
  - 10-pull: `orbit -> charge -> stabilize`
  - 1-pull: `warmup -> focus -> reveal`

## 2) Pass Gate
- 动画总分 `>= 90/100`。
- 所有 `A-P0` 项必须为 0。
- 必须通过 `tests/integration/draw-ceremony.screen.test.tsx` 与 `tests/integration/draw-result.screen.test.tsx`。

## 3) 评分维度（100 分）

### A. Anticipation（15）
- 15: reveal 前存在明确蓄力阶段，至少两类视觉参数连续变化（例如 scale + glow）。
- 8: 仅单参数变化，阶段感弱。
- 0: 直接跳到 reveal，无前摇叙事。

### B. Reveal（20）
- 20: 关键卡揭示顺序明确；10-pull 必须“中心卡最后揭示”；1-pull 必须“单卡前后面翻转语义明确”。
- 10: 有揭示但层级不清。
- 0: 揭示与结果文案不一致或卡面错误。

### C. Result Settle（15）
- 15: reveal 后有稳定收束段，用户可感知“结果已锁定”。
- 8: 收束时间过短或无明显锁定提示。
- 0: 揭示后立即跳转，无法阅读结果。

### D. Timing（20）
- 10-pull 总时长: `2100ms ~ 2600ms`。
- 1-pull 总时长: `1100ms ~ 1400ms`。
- 10-pull 阶段切换: `charge@600~850ms`, `stabilize@1300~1600ms`。
- 1-pull 阶段切换: `focus` 约总时长 `25%~45%`，`reveal` 约总时长 `60%~80%`。
- 满足全部给 20；超出任一窗口扣到 10；超出两项及以上为 0。

### E. Reduced Motion（15）
- 15: 系统 `Reduce Motion = ON` 时，动画退化为低动效版（无大角度旋转、无强频闪），总时长 `<= 450ms`。
- 8: 有降级但仍高运动量。
- 0: 完全忽略系统降动效设置。

### F. Frame Continuity（15）
- 15: 关键机型（360/390/430 对应设备）中，p95 帧间隔 `<22ms`，无连续 3 帧以上卡顿。
- 8: 偶发掉帧但不影响识别。
- 0: 明显卡顿导致阶段识别失败。

## 4) A-P0 Hard Fail
- `A-P0-NO-ANTICIPATION`: 没有蓄力阶段。
- `A-P0-ORDER-BROKEN`: 10-pull 不是中心卡最后揭示，或 1-pull 无 reveal 锁定态。
- `A-P0-TIMING-OUT`: 总时长不在允许窗口。
- `A-P0-REDUCED-MOTION-MISSING`: 未支持 reduced motion 降级。
- `A-P0-FRAME-JANK`: 连续 3 帧以上卡顿或视觉冻结。
- `A-P0-COPY-MISMATCH`: 动画阶段文案与实际阶段不一致。

## 5) 数据采集要求
- 自动化（必需）:
  - `draw-ceremony.screen.test.tsx` 验证阶段顺序与时序。
  - `draw-result.screen.test.tsx` 验证 handoff 文案与结果一致。
- 半自动（建议）:
  - iOS 模拟器录屏 + 帧时间统计（至少 360/390/430 各 1 次）。

## 6) 商业级定义
- 用户在 2.6 秒内完整经历“预热 -> 聚焦 -> 揭示 -> 收束”。
- 用户在任何时点都能回答三件事：
  - 现在处于哪个阶段。
  - 正在揭示什么结果。
  - 下一步将跳转到哪里。
- 动画在 reduced motion 下仍保持信息完整，不靠眩光或频闪传达核心信息。

