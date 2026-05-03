# RecallSmith Mobile · Agent Instructions

> 这份文档是 Claude Code / Codex / 任何 agent 在 `recallsmith/mobile/` 改代码时的执行守则。
> 不是产品文档，不是设计文档；只回答一件事："agent 应该怎么干，不该怎么干"。
>
> 当 agent 与本文冲突时，本文胜出。

---

## 1. Source of Truth 优先级

每次开工前，agent 必须先确认本轮以哪份文档为准：

1. `recallsmith/mobile/gacha-v7.md` — **当前在用**
2. `recallsmith/mobile/gacha-v6.1.md` — v7 未覆盖的部分继续生效
3. `recallsmith/mobile/gacha-v6.md` — 仅作历史参考，**不参与任何决策**
4. `recallsmith/mobile/gacha-v5.md` 及更早版本 — 不读，不引用

冲突解决：v7 > v6.1 > 历史。任何"看起来 v6 这么写过"的论点不成立。

---

## 2. Work Style

### 2.1 改动是手术，不是重写

- 在现有 RN 代码上做手术式重构，不要另起一整套 app shell
- 优先抽离逻辑（selector / planner / mapper）+ 瘦身 screen，不优先新建文件
- 旧 screen 在新结构稳定前不删（参考 v7 §5.4 的 deprecation 策略）
- 不允许"复制旧文件 → 改名 → 删旧"这种伪重构

### 2.2 不重新发明现有能力

- 主题 token 全部走 `src/theme/*`，不允许 inline hex
- 复习内核走 `src/review/{model,storage}.ts`，不允许在屏幕里重写 stage / due 计算
- 进度同步走 `src/sync/progressSync.ts`，不允许直接读写存储绕过它
- 已有组件能复用就复用：`CodeBlock`、`HomeHero`、`TodayPressureCard`、`RoutePreview`、`SessionProgressHeader`、`RatingBar`

### 2.3 单 phase 单任务

- 一次只做 v7 的一个 phase
- 一个 phase 内一次只改一个 screen 的范围（Home / Summary / Library+Deck / Settings）
- 不允许跨 phase "顺手"修改其他 screen
- 不允许在做 Phase A 的时候改 Summary 文案

---

## 3. 严禁修改

下列文件 / 路径在 v7 期间任何 agent 不允许修改：

```
src/review/model.ts
src/review/storage.ts
src/content/**
src/auth/**
src/premium/**
src/sync/**
src/theme/**
src/components/CodeBlock.tsx
```

`src/navigation/types.ts` 仅允许新增 route 字段，**不允许删 / 改现有 route 字段**。

如果 agent 觉得"必须改这些文件才能完成任务"，停下来，把判断报给作者，不要默认改。

---

## 4. Mobile Design Rules

所有 UI 改动必须在以下宽度上验证：`360 / 375 / 390 / 430`（pt）。

强制约束：

- 每个主屏 above-the-fold 只有 1 个主 CTA；副 CTA 必须视觉次级
- 任何主按钮文案在 360pt 宽下能单行显示，不允许 wrap 到 2 行
- 任何标题 / 副标题 / 列表项必须有 `numberOfLines` 上限（标题 ≤ 2，副标题 ≤ 1）
- 任何可点击元素 ≥ 44×44pt；rating 按钮 ≥ 64×56pt
- 不允许文字与文字、文字与图标在窄屏下重叠
- 长文 explanation / code / usage 滚动时，rating 行必须始终在视口可达
- 任何文案中不允许出现：`lost / missed / forfeit / wasted / expired / gone`

---

## 5. 必跑检查

每次改动后，从 `recallsmith/mobile` 跑：

```bash
npm run test:typecheck
npm run test:unit
npm run test:integration
```

涉及视觉时，跑 iOS 模拟器并截图归档：

```bash
npm run ios
# 在 360 / 375 / 390 / 430 pt 下都跑一遍
# 截图存到 docs/screens/v7/<scenario>/<width>/
```

静态守门（v7 §6.5）：

```bash
# 文件体量
wc -l src/screens/*.tsx | awk '$2 != "total" && $2 != "src/screens/ReviewScreen.tsx" && $1 >= 800'   # 必须为空

# inline hex（v7 修过的文件）
grep -nE "#[0-9A-Fa-f]{6}" src/screens/*.tsx src/features/gacha/components/*.tsx

# 文案禁用词
grep -nE "(lost|missed|forfeit|wasted|expired|gone)" src/features/gacha/session/summaryMapper.ts
```

任意一项失败 = 不能合入。

---

## 6. 单任务 Prompt 模板

每次给 agent 派活，必须填这个模板。不允许"按 v7 改一下 Home"这种空 prompt。

```text
请按 recallsmith/mobile/gacha-v7.md [Phase X] 的 [具体范围] 做改动。

【先读】
1. recallsmith/mobile/gacha-v7.md §[相关章节]
2. recallsmith/mobile/gacha-v6.1.md §[相关章节]（v7 未覆盖部分）
3. 当前实现：[列出要改的文件]

【允许改】
- [明确文件列表]

【禁止改】
- src/review/**, src/content/**, src/auth/**, src/premium/**, src/sync/**, src/theme/**
- src/navigation/types.ts 现有字段
- 不在本范围内的其他 screen

【任务步骤】
1. 输出 ≤ 10 行实施计划
2. 等我确认后再改代码
3. 改完跑：
   - npm run test:typecheck
   - npm run test:unit
   - npm run test:integration
4. 跑静态守门（见 AGENTS.md §5）
5. 总结：改了什么 / 没改什么 / 还有什么风险

【验收】
- 必须满足 v7 §[相关 acceptance 章节]
- 必须在 360pt 宽下不溢出、不重叠
```

---

## 7. 不允许的 Agent 行为

agent 出现以下行为之一，本轮工作作废：

- 跨 phase 修改（Phase A 时改 Summary）
- 创建 v7 §5.2 之外的新文件
- 修改 §3 列出的禁止文件
- 自作主张改 navigation route 字段
- 把一个 screen 拆成多个 screen（只允许拆成组件 + helper）
- 在文档里留 TODO（必须落到 task list）
- 跳过测试直接报"完成"
- 用 inline hex 颜色
- 在文案里塞 lost/missed/forfeit 等损失感词

---

## 8. 验收顺序

每个 phase 完成后，按下面顺序检查，任一不过都算未完成：

1. `npm run test:typecheck`
2. `npm run test:unit`
3. `npm run test:integration`
4. `wc -l src/screens/*.tsx | awk '$2 != "total" && $2 != "src/screens/ReviewScreen.tsx" && $1 >= 800'` 输出为空
5. `grep` 文案禁用词无命中
6. 模拟器跑 v6.1 audit 6 场景 × 360/390/430 三档宽度
7. 截图归档到 `docs/screens/v7/<scenario>/<width>/`
8. 在对应 `docs/plans/` 文件里写 phase 收尾摘要

---

## 9. 给 agent 的一句话

- 不是把功能堆满
- 不是把屏幕画得更漂亮
- 是把 v6.1 已经能跑通的主链路，在 360pt 宽的真手机上变得顺手

完不成 v7 的 4 个 phase，就别想 Week Streak / Mastery Hall / Multi-pool。
