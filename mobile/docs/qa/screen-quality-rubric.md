# RecallSmith Screen Quality Rubric (v7)

## 1) Scope 与基线
- Source of truth: `gacha-v7.md` > `gacha-v6.1.md` > 历史版本。
- 本 rubric 覆盖 `src/screens/*.tsx` 与其直接依赖的 `src/features/gacha/components/*.tsx`。
- 本 rubric 默认用于 v7 phase 内“单 phase + 单 screen”修复循环。

## 2) 通过标准
- 总分 `>= 85/100`。
- 所有 `P0` 项必须为 0（任何 1 条触发即不通过）。
- 必跑命令全绿：
  - `npm run test:typecheck`
  - `npm run test:unit`
  - `npm run test:integration`
- 静态 gate 全绿：
  - `wc -l src/screens/*.tsx | awk '$2 != "total" && $2 != "src/screens/ReviewScreen.tsx" && $1 >= 800'` 输出为空
  - `grep -nE "#[0-9A-Fa-f]{6}" src/screens/*.tsx src/features/gacha/components/*.tsx` 无命中
  - `grep -nE "(lost|missed|forfeit|wasted|expired|gone)" src/features/gacha/session/summaryMapper.ts` 无命中

## 3) 评分维度（100 分）

### A. 信息层级与主 CTA（20）
- 20: above-the-fold 仅 1 个主 CTA，次级 CTA 明确降级。
- 10: CTA 有竞争（主次不清），但仍可判断主路径。
- 0: 无法在首屏 3 秒内判断“下一步点击哪里”。

### B. 文案与语义（10）
- 10: 文案结果导向、无损失感词、与 v7 文案约束一致。
- 5: 轻微工程腔，不影响路径理解。
- 0: 出现禁用词或“占位词/骨架词”影响决策。

### C. 响应式与窄屏稳定性（20）
- 测试宽度：`360 / 375 / 390 / 430`。
- 20: 四档无重叠、无越界、主 CTA 单行。
- 10: 仅在一档有轻微裁切。
- 0: 任一宽度发生重叠/主 CTA 换行。

### D. 触达与可访问性（15）
- 15: 交互元素 `>=44x44pt`，rating `>=64x56pt`，标题/副标题均有 `numberOfLines`。
- 8: 少量元素未达标但可操作。
- 0: 关键操作触达不足或读屏语义缺失。

### E. 状态完整性（15）
- 15: `loading / empty / error` 三态可渲染且有可行 CTA。
- 8: 某一态降级可见但动作弱。
- 0: 任一态崩溃或无恢复动作。

### F. 可测试性（10）
- 10: 关键节点具备稳定 testID，集成测试可定位。
- 5: 部分 testID 缺失但可通过文本勉强定位。
- 0: 关键路径不可自动定位。

### G. 架构与边界合规（10）
- 10: 不改禁区路径，screen 体量符合 gate，逻辑落在 selector/planner/mapper。
- 5: 轻微内聚问题但不破坏边界。
- 0: 越权改动或绕过核心规则。

## 4) P0 Fail Codes（硬失败）
- `P0-CTA-MULTI`: 首屏存在 2 个及以上主 CTA。
- `P0-CTA-WRAP`: 主 CTA 在 360pt 下换行。
- `P0-TAP-SIZE`: 任一关键点击区 `<44x44pt`；rating `<64x56pt`。
- `P0-TEXT-OVERLAP`: 任意宽度出现文字/图标重叠。
- `P0-RATING-UNREACHABLE`: 长内容滚动后 rating 行不可达。
- `P0-LOSS-WORDING`: 出现 `lost|missed|forfeit|wasted|expired|gone`。
- `P0-STATE-MISSING`: 缺失 loading/empty/error 任一态。
- `P0-TESTID-MISSING`: 主链路关键 testID 缺失。
- `P0-FORBIDDEN-PATH`: 修改 `AGENTS.md §3` 禁止路径。
- `P0-FILE-SIZE`: 非 `ReviewScreen.tsx` screen 文件 `>=800` 行。
- `P0-ANIM-COMMERCIAL`: 抽奖动画未达 `animation-quality-rubric.md` 商业级阈值。

## 5) Mobile Width Checks（统一编码）
- `W-BASE`: 360/375/390/430 无重叠与越界。
- `W-CTA`: 主 CTA 在 360 单行。
- `W-GRID`: 网格在 `<390` 为 2 列，`>=390` 为 3 列（Library）。
- `W-RATING`: rating 4 键单行且尺寸达标。
- `W-SCROLL-ACTION`: 长内容滚动时主操作仍在可视区。
- `W-MODAL`: modal/overlay 在 360 下不裁切关键按钮。

## 6) testID Contract（自动化约定）
- 每个 screen 至少提供：
  - `screen-<route-kebab>-root`
  - `screen-<route-kebab>-primary-cta`（无主 CTA 的浏览页可为 `screen-<route-kebab>-primary-surface`）
- 已存在稳定 testID 必须保留：
  - `home-primary-cta`
  - `challenge-begin-cta`
  - `library-card-grid`
  - `deck-gate-primary-cta`
  - `review-rating-dock`
  - `review-rating-bar`
  - `summary-reward-block`
  - `summary-progress-block`

## 7) 评分产物格式（给 critic）
- `status`: `pass | fail`
- `total_score`: `0..100`
- `p0_failures`: `string[]`
- `dimension_scores`: `{A,B,C,D,E,F,G}`
- `repairs`: 每条必须含 `file`, `reason`, `expected_test`

