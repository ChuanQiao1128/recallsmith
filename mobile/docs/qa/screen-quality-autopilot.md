# Screen Quality Autopilot 设计

## 1) 目标
- 自动执行：`检测 -> 评分 -> 修复 -> 复检`，直到达标或达到最大轮次。
- 默认约束：遵守 `AGENTS.md`，单次只处理 `一个 phase + 一个 screen`。
- 不自动提交，不改禁止路径。

## 2) 输入
- `phase`: `A | B | C | D`
- `screen`: 例如 `HomeScreen`、`SessionSummaryScreen`
- `max_rounds`: 默认 `5`
- 可选 `extra_paths`: 附加允许修复文件

## 3) Agent 角色分工（由 codex exec 执行）
- `GateRunner`: 跑 typecheck/unit/integration + 静态 gate。
- `ScreenCritic`: 按 `screen-quality-rubric.md` 打分并产出结构化失败列表。
- `AnimationCritic`: 当 `screen=DrawCeremonyScreen` 时，按 `animation-quality-rubric.md` 额外评分。
- `RepairExecutor`: 仅在允许范围内改代码并补测试。
- `Verifier`: 修复后再次执行 GateRunner + Critic，判断是否收敛。

## 4) 轮次循环
1. 运行 GateRunner。
2. 运行 ScreenCritic（必要时加 AnimationCritic）。
3. 若 GateRunner 与 Critic 均通过，结束并输出 `PASS`。
4. 若失败且 `round < max_rounds`，调用 RepairExecutor。
5. 回到步骤 1。
6. 达到 `max_rounds` 仍失败，输出 `FAIL` 与未解决项。

## 5) Critic 输出协议（JSON）
```json
{
  "status": "pass|fail",
  "total_score": 0,
  "p0_failures": ["P0-..."],
  "dimension_scores": {"A":0,"B":0,"C":0,"D":0,"E":0,"F":0,"G":0},
  "findings": [
    {
      "severity": "P0|P1|P2",
      "file": "src/screens/Example.tsx",
      "issue": "...",
      "fix": "...",
      "expected_test": "..."
    }
  ]
}
```

## 6) Repair Scope Guard
- 允许修改：
  - `src/screens/<TargetScreen>.tsx`
  - 与该 screen 直接相关的 `src/features/gacha/**`
  - 对应 `tests/unit/**`, `tests/integration/**`
- 禁止修改（硬阻断）：
  - `src/review/model.ts`
  - `src/review/storage.ts`
  - `src/content/**`
  - `src/auth/**`
  - `src/premium/**`
  - `src/sync/**`
  - `src/theme/**`
  - `src/components/CodeBlock.tsx`

## 7) 失败分流策略
- Gate 失败优先修 Gate，再看视觉评分。
- P0 失败优先级高于总分。
- 抽奖动画若触发 `A-P0-*`，必须先修动画，再修其余 UI。

## 8) 终态定义
- `PASS`: 所有 Gate 通过，Critic `status=pass`，且无 P0。
- `FAIL`: 达到最大轮次仍有 Gate 失败或 P0。

## 9) 人机协作边界
- 脚本只驱动检查与修复循环，不做 `git commit`/`git push`。
- 人工只在两种情况介入：
  - 禁止路径确实需要变更。
  - 第 5 轮仍失败，需要重定义修复范围。

