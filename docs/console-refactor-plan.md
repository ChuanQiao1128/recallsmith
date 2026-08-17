# Console 分步重构方案(第 1-7 步)

> 这份文档存在的理由:前五步的方案只活在对话里,做完之后「当初打算做什么」只能听实现者转述,
> 而这个仓库反复犯的病恰恰是「说做了、其实没接上」。方案落盘之后,每一条 in_scope 旁边都有一条
> **任何人可以原样复制粘贴重跑**的验收命令;没有验收命令的条目算未交付。
>
> 仓库根:`/Users/qc/Desktop/DeveloperCards/recallsmith`,改动范围限 `frontend/` 与 `docs/`。
> 第 5.5 步开工时 HEAD = `bf036c9`。
>
> **本文档中所有命令的工作目录都是 `frontend/`。**

---

## 零、这条线在治什么病

八轮评审都没看出来的一件事:`src/hooks/index.ts` 导出 22 个 hook,
`main.tsx` 挂着 `QueryClientProvider`,而**没有任何页面向它要过东西**——
每个页面都用自己的 `useState + useEffect` 取数。
单看任何一个文件都正常,所以它活了八轮。

这条线的每一步都在回答同一个问题的不同侧面:**「东西存在」和「东西被用上」之间的差距,谁来盯。**

---

## 一、第 1-5 步做了什么(简述)

| 步 | commit | 做了什么 | 留下的不变量 | 谁在守 |
|---|---|---|---|---|
| 1-3 | `c3ca6e0` / `190995a` / `1604a6f` | Markdown 批量导入内核 + 导入向导页 + CI job;frontend 第一次有 vitest | 导入的 diff/写入语义 | `tests/deckImport.test.ts`、`tests/deckImportRunner.test.ts` |
| 4 | `8ee36b5` / `7d45e22` | 发布轮询软失败不再永久停摆;7 处 `alert()` 换成不冻结页面的错误面 | 轮询失败后仍按 idle 节奏重排;错误分 business/network 两种措辞 | `tests/publishJobsPolling.test.ts`、`tests/errorFeed.test.ts` |
| 4.5 | `c8ee404` | 引入 jsdom 组件测试,钉死两处页面接线层不变量 | 纯函数绿 ≠ 页面在用它:轮询只存在于挂载后的组件里 | `tests/deckListPagePolling.test.tsx`(6 条,**对照组,不许改**) |
| 5 | `bf036c9` | `CardListPage` 真正接到 `useDeck`/`useCards`/`useDeleteCard`;19 个孤儿 hook 上棘轮 | 双向棘轮:没人调的 hook 不在名单上→红;名单上的 hook 被接线了→也红 | `tests/hookWiring.test.ts` |

第 5 步验收时另外发现并修了一个未申报的离线回归:两个 query 缺 `networkMode`,
react-query 默认 `'online'` 会让页面永远转圈。已加测试并变异验证。

---

## 二、第 5.5 步(本步)的 in_scope 与验收命令

本步的四件事来自第 5 步终验与完备性批判,均已逐条复核为真。

### A. 棘轮扫描器有两个洞,其中一个是本仓库那类病的复发

`tests/support/hookWiringScan.ts` 判定「被调用」的方式是**在文件正文里正则搜标识符**。
于是下面这些全部被算成「已接线」:注释、字符串、类型位置、属性名、只引用不调用。

这为什么比一般的漏报严重:`hookWiring.test.ts` 的第二条断言要求
**ALLOWLIST 与 orphans 完全重合**。一个 hook 因为一句注释离开了 orphans,
唯一能让测试变绿的操作就是把它从棘轮上摘掉——而那句注释是永久的。
**守卫里防陈旧的那一半,变成了不可逆缩小守卫自己的杠杆。** 这正是它要防的病。

第二个洞:不进 `src/hooks/index.ts` 的 hook 文件对棘轮**完全隐形**,
所以「债务不能增长」这句话只在 barrel 内成立。

| 交付 | 验收命令 |
|---|---|
| 先写会失败的对照,再改实现 | `npx vitest run tests/hookWiringScan.test.ts` |
| 扫描器改用 TypeScript 编译器 API | 见上;并 `npx vitest run tests/hookWiring.test.ts` |
| 新增 `hooksNotInBarrel` 字段并断言为空 | `npx vitest run tests/hookWiring.test.ts` |
| **真实仓库判决必须零变化** | 见下节「反直觉事实」 |

### B. 棘轮名单上的理由标签是没人验证过的散文,且至少一条不准

`useDecks` 标着 `not-applicable-to-current-endpoint`,注释说页面走的是别的端点。
但 `fetchDecks()` 真实调用点有两处。这条标签的字面意思是「瞄准了没人用的端点」,
真相恰恰相反:**页面正在手写直调同一个 API 函数、绕过了 hook**——
这就是本仓库那个病本身,却被贴了一张「这不是问题」的免责声明。

散文型理由最坏的失效方式不是不准,是**把病情记成免责**。

| 交付 | 验收命令 |
|---|---|
| 每条 ALLOWLIST 加 `apiFn` 字段 | `npx vitest run tests/hookWiring.test.ts` |
| 新增 `page-calls-wrapped-api-directly` 理由 | 同上 |
| 两条互为反向的断言(标 wrongEndpoint 必须零调用点;标 pageCallsApiDirectly 必须 ≥1) | 同上 |
| 8 条标签的 grep 依据 | 见下方「B 的 grep 原始输出」 |

**只改标签与约束,不接任何线。**

### C. DeckListPage 的纯函数抽出去并补测试

`DeckListPage.tsx` = 1355 行,组件体内 39 处 hook 调用。
唯一的组件级测试是 `deckListPagePolling.test.tsx` 的 6 条,只讲发布任务轮询,
且**全部走 super_admin / paginated 路径,从不触发 manifest 解析**。

**本步搬的 12 个纯函数(范围在动手之前定死):**

`safeDateTime`、`isRecord`、`isNonEmptyString`、`toOptionalString`、`toOptionalNumber`、
`toOptionalNullableNumber`、`pick`、`getManifestTarget`、`extractDecksArray`、
`toManifestDeckLite`、`parseManifestMeta`、`getDeckStatusFromManifest`,
外加 `ManifestDeckLite` / `ManifestMeta` 两个类型。目标模块 `src/pages/deckListManifest.ts`。

**明示收窄:`statusBadge` / `typeBadge` 不搬。** 这是对原 in_scope(156-334 行全部搬走)的一次收窄。
理由:它们返回 JSX,搬走会把新模块升级成 `.tsx`;而它们零逻辑、纯 Tailwind 字符串,
唯一可能的测试是 class 快照,收益接近零。**留给第 6 步裁决。**

**三拍顺序不可交换:**

- **C0** 先写页面级 legacy 表征测试,**对着完全未修改的 `DeckListPage.tsx`** 跑绿。
  这条测试先写、并在搬移前后都绿,就同时是三样东西:铁律要求的表征测试、
  搬移没改行为的证据、以及「页面真的在用新模块」的焊点。放到最后写就只剩最后一样。
- **C1** 只给 12 个纯函数加 `export`,写单测,跑绿。加 export 是 TS 层面的纯加法,
  不可能改变运行时语义,所以由此得到的断言描述的是**搬家前**的代码。
  这严格优于「复制一份到 scratchpad 再写测试」:副本会跟原件漂移,而这里测的就是原件本身。
- **C2** 逐字搬移,**测试体一个字符不改**,只改 import 路径。
  同一批断言在搬前搬后都绿,才是「搬家没改行为」的直接证据。

**C0 的三条页面级测试断言什么(动手前写死):**

- **L1** editor 会话(非 super_admin)→ 挂载即 legacy;`fetchAdminDecksPage` **一次都没被调用**;
  `fetchDecks` + `fetchAdminManifest` 被调用;一个带 `buildId` 的 manifest 条目
  在表格里渲染出 `Published`。这条同时穿过 `parseManifestMeta` / `extractDecksArray` /
  `toManifestDeckLite` / `getDeckStatusFromManifest` 四个待搬函数。

  > **【执行后更正,原文保留】** 上面这句「四个」是错的,实测是**三个**。
  > `parseManifestMeta` 的返回值只写进 `manifestState.meta`,**没有任何 JSX 读它**,
  > 所以任何页面级测试都焊不上它。详见第四节的焊点矩阵与第五节「已知缺陷」第 6 条。
  > 这条错误是预写计划时凭源码结构推断出来的,变异验证把它证伪了——保留原文,
  > 是因为「计划写错了什么」本身就是这份文档该留下的证据。
- **L2** super_admin 且 `fetchAdminDecksPage` 返回 `ADMIN_DECKS_ENDPOINT_MISSING`
  → 回退后 `fetchDecks` 与 `fetchAdminManifest` **确实被调用**且行渲染出来。
  钉的是本仓库那个病最典型的形状:`setListMode('legacy')` 和 `void loadAll(false)`
  是两条独立语句,只断言「模式变了」的测试会给一个根本没发请求的回退出具背书。
- **L3** super_admin 且返回一个不在 `PAGINATED_FALLBACK_CODES` 里的码 → 留在 paginated,
  `fetchDecks` **从未被调用**,页面显示错误态。L3 的存在是为了证明 L2 不是靠
  「反正什么都回退」蒙对的。

| 交付 | 验收命令 |
|---|---|
| C0 页面级 legacy 表征测试 | `npx vitest run tests/deckListPageLegacyPath.test.tsx` |
| C1/C2 纯函数单测 | `npx vitest run tests/deckListManifest.test.ts` |
| 对照组 6 条未被改动 | `git diff --stat frontend/tests/deckListPagePolling.test.tsx`(必须为空) |
| 搬移逐字节无差异 | 见下方「C2 逐字节 diff」 |
| 焊点 | 见下方「C 收口变异」 |

### D. 方案文档(本文件)

`docs/` 下原本只有针对 mobile 与 src_C 的计划,没有任何 frontend console 分步方案,
所以「in_scope 每条是否落地」事后无人可核。

| 交付 | 验收命令 |
|---|---|
| 本文件存在且每条 in_scope 有验收命令 | 人读 |
| 文档提到的测试文件真实存在 | `npx vitest run tests/consolePlanDoc.test.ts` |

---

## 三、明确不做(越界即失败)

- **不拆 DeckListPage 的组件结构**:不动 JSX、不抽子组件、不改 hook 调用顺序、不加 `useCallback`。
  本步对 `DeckListPage.tsx` 的合法改动只有两类:(a) 给 12 个纯函数加 `export`(C1,临时);
  (b) 删除被移走的定义并加一条 import(C2)。除此之外一个字符不改。
- **不给 DeckListPage 接 react-query**,不新写 `useInfiniteQuery`,不碰它手写的 localStorage 缓存。
- 不搬 `statusBadge` / `typeBadge`(理由见上)。
- 不写缓存路径 / 过滤器 / 行操作三个测试文件(它们是第 6 步的前置条件,见第六节)。
- **不修任何既有 bug**,只列出来(见第五节)。
- 不修 `tests/` 不进 tsc 这个配置缺口;本步用一次性 standalone tsc 绕过,不改 tsconfig。
- 不修 `src` 全量 35 个既有 eslint error;不做代码分割(第 7 步);不删任何孤儿 hook;
  不接任何线;不改 `src/api/queryClient.ts`、`src/api/dedupe.ts`。
- 不执行 `npm install` / 不改 `package.json`(里面有一条指向本机绝对路径的
  `file:` 依赖 `releaseguard-0.7.6.tgz`,触发安装可能失败)。
- 绝不 `git commit / push / checkout / reset / stash`。

---

## 四、实际结果

### 4.0 基线与终态

| | 基线(HEAD `bf036c9`) | 本步终态 |
|---|---|---|
| `npx vitest run` | 12 files / **138** tests | 15 files / **180** tests,全绿 |
| `npx tsc --noEmit` | exit 0 | exit 0 |
| `npx eslint src tests vitest.config.ts` | **35** errors / 1 warning | **35** errors / 1 warning(未增) |
| `npx eslint src/pages/DeckListPage.tsx` | 0 errors / 1 warning | 0 errors / 1 warning |
| `npm run build` | 190 modules,`index-*.js` **520.94 kB** / gzip **154.80 kB** | 191 modules,**520,942 B = 520.94 kB** / gzip **154.79 kB** |

包体积:原始字节 **持平**(vite 两次都报 520.94 kB),gzip 报数少了 0.01 kB(约 10 字节)。
纯搬家不加依赖,这是预期结果。远低于 2 kB 的停机阈值。

### 4.1 A —— 最该先说的一条反直觉事实

**修好扫描器之后,它对今天真实 `src/` 的判决逐字节不变。**

```
exportedHooks.length = 22
calledHooks   = ["useCards","useDeck","useDeleteCard"]
orphans.length = 19
namespaceImports = []
scannedFileCount = 75
hooksNotInBarrel = []          ← 新字段,真实仓库上为空
```

修前修后跑同一段探针脚本,`diff` 输出为空。
**这两个洞今天是潜伏的,不是正在发作的。** 不许把这件事叙述成「修复带来了可见改善」。
它同时意味着:除了下面那些对照测试的红色输出,**再没有任何别的证据能证明这些洞存在过**。

**对照测试(先红后绿),`npx vitest run tests/hookWiringScan.test.ts`:**

修实现之前跑,20 条里 **10 条红**:

| 对照 | 未修实现时的实际输出 |
|---|---|
| 只在行注释里提到 | `expected [ 'useDecks' ] to not include 'useDecks'` |
| 只在块注释里提到 | `expected [ 'useDecks' ] to not include 'useDecks'` |
| 只在字符串字面量里 | `expected [ 'useCards' ] to not include 'useCards'` |
| clause 级 `import type` | `expected [ 'useCards' ] to not include 'useCards'` |
| 引用但不调用 `{ useCards }` | `expected [ 'useCards' ] to not include 'useCards'` |
| 同名属性 `other.useDecks()` | `expected [ 'useDecks' ] to not include 'useDecks'` |
| 外部模块 `../vendor/hooks-compat` 冒充 | `expected [ 'useCards' ] to not include 'useCards'` |
| 不进 barrel 的 hook 文件 | `the given combination of arguments (undefined and string) is invalid`(字段还不存在) |
| 动态 `import('../hooks')` | `expected [] to have a length of 1 but got +0` |
| **别名后调用判 orphan** | `expected [ 'useDeck', 'useDecks', …(1) ] to include 'useCards'` |

> **【与计划不符,如实记录】** 计划预期 9 红 + 2 条「一开始就绿的偏差钉子」。
> 实测是 **10 红 + 10 绿**:别名钉子 `const h = useCards; h(1)` **今天也是红的**。
> 原因是它和「引用但不调用」同源——旧扫描器只要在正文见到 `useCards` 就算调用,
> 而 `const h = useCards` 正是一次引用。所以它不是「有意保留的偏差」,是第 10 个洞。
> 修完之后它变绿,并且从此确实是一条保守偏差(新实现要求 callee 位置)。
> 另一条钉子 `if (false) { useCards(1) }` 修前修后都绿,是真正的偏差钉子。

**变异验证(每条:注入 → 跑 → 贴输出 → 还原 → `shasum -a 256 -c` 核对):**

| 变异 | 结果 |
|---|---|
| 调用位置判定放宽成「AST 里出现该 Identifier 即可」 | **7 条红**(含 import 语句自身的 Identifier 也被算进去) |
| specifier 由「路径末段等于 hooks」放宽回 `includes('/hooks')` | 1 条红(冒充模块) |
| `hooksNotInBarrel` 恒返回 `[]` | 1 条红 |
| 删掉动态 import 的上报 | 1 条红 |
| **删掉 clause 级 `isTypeOnly` 守卫** | **全绿 —— 没有牙齿** |

> **【如实说出来】** 最后一条变异**没有让任何测试变红**。
> 原因是合法 TypeScript 里 type-only 绑定**不可能出现在 callee 位置**,
> 所以「调用位置」这条规则已经覆盖了它能覆盖的全部情况,两个 `isTypeOnly` 守卫是冗余的。
> 处置:**保留但明写**。保留是因为这个扫描器读的是没过类型检查的文本,
> 那种非法组合在文本里是可表达的;明写是因为「代码里有个守卫」不等于「有测试在守它」。
> 已写进 `tests/support/hookWiringScan.ts` 的注释,原话:
> 「Do not read their presence as evidence that a test is holding them down; none is.」

**端到端证明(A-2 那个洞真的堵上了):**

```
$ cat > src/hooks/useProbeXxx.ts <<< 'export function useProbeXxx() { return 1; }'   # 不加进 index.ts
$ npx vitest run tests/hookWiring.test.ts
  × is judging every hook in the folder, not only the ones the barrel lists
  AssertionError: expected [ 'useProbeXxx' ] to deeply equal []
  Tests  1 failed | 5 passed (6)
$ rm src/hooks/useProbeXxx.ts && npx vitest run tests/hookWiring.test.ts
  Tests  6 passed (6)
```

探针文件已删除,`git status` 已确认。

**一处对计划的技术偏离(先声明再做):** 计划写的 specifier 正则是 `/(^|\/)hooks(\/index)?$/`。
直接照用会把 `'../hooks/useCards'` 判成非 hooks 模块——而这正是 `CardListPage` 真实的导入写法,
`calledHooks` 会从 3 个变成 0 个,直接撞上停机条件。改用**路径末段匹配** `/(^|\/)hooks(\/|$)/`:
`'../hooks'`、`'../hooks/useCards'` 都匹配,`'../vendor/hooks-compat'` 不匹配。

### 4.2 B —— 标签从声明变成可证伪的断言

**先用当前(错误的)标签跑新断言,必须报出恰好 7 条违规。实测正是 7 条:**

| hook | apiFn | 真实直调点 |
|---|---|---|
| `useDecks` | `fetchDecks` | `ContentIntelligencePage.tsx`、`DeckListPage.tsx` |
| `useCreateDeck` | `createDeck` | `NewDeckPage.tsx` |
| `useUpdateDeck` | `updateDeck` | `DeckEditPage.tsx` |
| `useDeleteDeck` | `deleteDeck` | `DeckListPage.tsx` |
| `useCreateCard` | `createCard` | `NewCardPage.tsx` |
| `useUpdateCard` | `updateCard` | `EditCardPage.tsx` |
| `useManifest` | `fetchAdminManifest` | `DeckListPage.tsx` |
| ~~`useRebuildManifest`~~ | `rebuildManifest` | **零调用点** ← 唯一一条原标签是对的 |

可复现的 grep(依据是命令而不是转述):

```
$ for fn in fetchDecks createDeck updateDeck deleteDeck createCard updateCard fetchAdminManifest rebuildManifest; do
    echo "=== $fn ==="
    grep -rn "\b$fn(" src --include='*.ts' --include='*.tsx' | grep -v '^src/api/' | grep -v '^src/hooks/'
  done
```

改完标签后 `npx vitest run tests/hookWiring.test.ts` → 8 passed。

**双向变异:**

| 变异 | 结果 |
|---|---|
| `useRebuildManifest`(零调用点)改标成 `pageCallsApiDirectly` | 红:`says "the page calls the api directly" only where a call site exists` |
| `useManifest`(有调用点)改回 `wrongEndpoint` | 红:`says "no page uses this endpoint" only where nothing calls it` |

两个方向都红,说明约束不是单向摆设。

> **一个顺带的发现(不改,只记):** `DeckImportPage.tsx` 也 `import { createCard, updateCard }`,
> 但它把这两个函数**作为对象传给** `deckImportRunner`,由 runner 用 `writer.createCard(...)` 调用。
> AST 原语正确地没把它算成直调点(callee 是属性访问)。所以「直调点」这个口径是
> 「页面自己调」而不是「运行时是否到达」,读这张表时要知道这个区别。

### 4.3 C —— 顺序确实是按 C0 → C1 → C2 执行的

**C0 先写、并且是对着完全未修改的 `DeckListPage.tsx` 跑绿的。** 证据:
写完 `tests/deckListPageLegacyPath.test.tsx` 后 3 passed 的同一时刻,
`git diff --stat frontend/src/` 输出为空。

C0 的 5 条变异:

| 变异 | 结果 |
|---|---|
| 回退分支里删掉 `void loadAll(false)`(只留 `setListMode`) | **L2 红**,L1/L3 绿 |
| 从 `PAGINATED_FALLBACK_CODES` 删掉 `ADMIN_DECKS_ENDPOINT_MISSING` | L2 红 |
| 回退条件改成 `if (res.error)` 全量回退 | **L3 红** |
| `listMode` 初值改成恒 `'paginated'` | **L1 红** |
| 夹具:`signInAsEditor` 的 groups 改成 `['super_admin']` | L1 红 |

第一条是本步最想钉的那个形状:`setListMode('legacy')` 和 `void loadAll(false)` 是两条独立语句,
删掉后一条,「模式切换了」依然成立,而页面再也不发请求。L2 红,证明它测的是请求不是标志位。

**C1 只加 export。** `git diff` 恰好 14 处 `function`/`type` → `export function`/`export type`,
没有任何其它加号行。加 export 后 `npx eslint src/pages/DeckListPage.tsx` 从
「0 errors / 1 warning」变成 **「12 errors / 1 warning」**,全部是
`react-refresh/only-export-components`——这正是计划里预判需要 per-file 基线的原因。
C2 搬走之后这 12 条**全部消失**,回到 0 errors / 1 warning。

C1 的 4 条变异(测试还在测 `DeckListPage.tsx` 里的定义时做的):

| 变异 | 结果 |
|---|---|
| `m.buildId \|\| m.path` → `&&` | 1 条红 |
| 删掉 `toManifestDeckLite` 的 `if (!slug) return null` | 1 条红 |
| 删掉 `getManifestTarget` 里剥 `{manifest:{}}` 的那一行 | 3 条红 |
| `cardCount ?? deck.totalCards` → `\|\|` | 1 条红(0 压过 5 那条) |

**C2 逐字节 diff:** 把搬进新模块的文本再抽出来,与从 `DeckListPage.tsx` 剪下的文本对比:

```
=== diff: types block, as-cut vs as-landed ===      IDENTICAL
=== diff: functions block, as-cut vs as-landed ===  IDENTICAL
719ce52c…  block_types.txt   /  719ce52c…  moved_types.txt
9d4285ea…  block_fns.txt     /  9d4285ea…  moved_fns.txt
```

`git diff frontend/src/pages/DeckListPage.tsx` 的**全部加号行**只有那一条 import
(5 个函数 + 2 个类型);净变化 `8 insertions(+), 186 deletions(-)`。
`git diff frontend/tests/deckListPagePolling.test.tsx` **为空**——对照组 6 条一个字符没改。

**C 收口(焊点矩阵)。** 把新模块里的函数逐个打瘫,看页面级 legacy 测试红不红:

| 打瘫 `src/pages/deckListManifest.ts` 里的 | `deckListPageLegacyPath` | `deckListPagePolling`(对照组) |
|---|---|---|
| `toManifestDeckLite` 恒返回 `null` | **L1 + L2 红** | 6 绿 |
| `extractDecksArray` 恒返回 `[]` | **L1 + L2 红** | 6 绿 |
| `getDeckStatusFromManifest` 恒返回 `'unpublished'` | **L1 + L2 红** | 6 绿 |
| `parseManifestMeta` 恒返回 `{}` | **3 绿 —— 焊不上** | 6 绿 |

前三行就是「页面真的在用新模块」的证明:抽出去了、页面也确实在用。
对照组全程 6 绿,同时说明这条新测试覆盖的是 polling 测试看不见的区域。

> **【第四行必须说清楚】** `parseManifestMeta` 焊不上,不是测试写松了,
> 是**页面根本不显示它的结果**:`manifestState.meta` 只被写入,没有任何 JSX 读它
> (`grep -n "deckCount\|generatedAt\|schemaVersion\|prefix" src/pages/DeckListPage.tsx` 零命中)。
> 所以没有任何页面级断言能焊上它。它今天由 `tests/deckListManifest.test.ts` 的
> 4 条单测守着(变异 `parseManifestMeta → {}` 时那 3 条红)。
> 这条不修,记入第五节第 6 条,留给第 6 步裁决。

### 4.4 D —— 文档自身也有一条可证伪的断言

`tests/consolePlanDoc.test.ts` 从本文件正则抽出所有被提到的 `tests/*.test.ts(x)` 路径,
断言每个都真实存在于磁盘,并要求至少抽到 5 条(防止「引用为空 → 空循环通过」)。

变异:把 `tests/deckListPageLegacyPath.test.tsx` 改名而不改文档 →

```
× only cites test files that exist
AssertionError: expected [ Array(1) ] to deeply equal []
+   "tests/deckListPageLegacyPath.test.tsx",
```

改回后 2 passed。

---

## 五、已知缺陷(本步不修)

1. **`loadAll` 在有缓存时请求失败完全静默。** `DeckListPage.tsx:267`、`:277`、`:323`
   三处 `if (!cachedDecks)` / `if (!cachedManifest)` 分支:有缓存时,请求失败**不设置任何错误状态**,
   用户对着最多 5 分钟前的快照做决策,且页面上没有任何迹象说明数据是旧的。
2. **页面 `catch` 里的 network 分支不可达。** `src/api/authoring.ts` 有 **21 个 catch、0 个 throw**,
   全部 `return fail(toApiErrorMessage(err))`,而 `fail` 的签名是
   `fail<T>(message: string, code = 'NETWORK_ERROR')`。所以真实网络故障走的是
   `if (!res.success)` 这条 business 分支,被渲染成 business 措辞;
   `DeckListPage` 的 `catch` 块只可能被非 api 来源的异常触发。
3. **`tests/` 不被 `tsc` 检查。** `tsconfig` 的子 project 只 include `"src"` 与 `"vite.config.ts"`。
   本步用一次性 standalone tsconfig 绕过(已跑,tests + src 零错误),**没有改 tsconfig**。
   下一步谁写新测试,谁还得记得手动跑一次,否则类型错误静默通过。
4. **`src/pages/deckListPagination.ts` 至今零测试。** 它是上一波「抽出去了但没测」的先例,
   本步刻意没有重蹈(新模块 23 条单测 + 3 条页面级焊点),但那个文件本身仍然裸着。
5. **`src` 全量 35 个既有 eslint error。** 与 HEAD 一致,本步未增未减。
6. **`manifestState.meta` 是只写状态。**(第 5.5 步新发现)`parseManifestMeta` 的返回值
   写进 state、写进 localStorage 缓存,**没有任何 JSX 读它**。
   它不是完全死的(缓存里存了、读回来又塞进 state),但它对用户不可见。
   第 6 步要么把它接到界面上,要么删掉它和它那 4 条单测——**不做这个裁决。**
7. **入门卡组判定三方不自洽 —— 已钉住,刻意未修。**(第 5.6 步新发现)
   同一个「这是不是入门卡组」的问题有 **3 个调用点、2 个谓词**:

   | 位置 | 谓词 |
   | --- | --- |
   | `DeckListPage.tsx:641` paginated 类型过滤 | `isStarterLike(row.deckType, row.tier)` |
   | `DeckListPage.tsx:669-670` legacy 类型过滤 | `d.deckType !== 1` / `d.deckType === 1` |
   | `DeckListPage.tsx:1064` 类型徽章(JSX) | `isStarterLike(row.deckType, row.tier)` |

   (`:641` 与 `:1064` 逐字节相同,只有 `:669-670` 分叉 —— 说「三个答案」是不准的。
   这一点有操作意义:改 `isStarterLike` 一次动两处,改 legacy 过滤只动一处,变异矩阵按此设计。)

   `isStarterLike`(`deckListPagination.ts:79-85`)在 `deckType` 不是 number 时
   回落到 `tier !== 'premium'`。所以对 **deckType 为 null、tier 为 `'free'`** 的卡组:

   - legacy + Starter 筛选 → **排除**;legacy + Paid 筛选 → **保留**
   - paginated + Starter 筛选 → **保留**;paginated + Paid 筛选 → **排除**
   - 两种模式下徽章都显示 **Starter**

   即:legacy 路径下,一张徽章写着 Starter 的卡组,只在选 **Paid** 时才出现在列表里。

   **这个状态在生产可达,不是虚构的 fixture:** `normalizeDeck`(`api/authoring.ts:63`)
   算的是 `deckType: toInt(o.deckType, d.deckType)`,其中 `o` 就是 `d` 本身转成 record ——
   候选值与兜底值是**同一个值**;`toInt`(`:36-43`)只接受有限 number 或非空数字字符串,
   否则返回兜底,于是 `null` 原样穿过。而 `types/deck.ts:13` 声明的是 `deckType: number`。
   **类型在撒谎。**

   守卫:`tests/deckListViewRows.test.tsx` 的 **V1 / V2 / V3**(legacy 三态)
   与 **V4 / V5**(paginated 反向)。其中 V3 最关键——「一张徽章写着 Starter 的行
   只在 Paid 筛选下出现」这半边活在 JSX 里,只能通过 DOM 观察,纯函数测试**物理上看不见**。
   **不要删这几条。** 把两个谓词统一掉是改产品语义,不是重构;
   变异矩阵 M1 与焊点矩阵 (c) 都要求这个编辑**必须把 V2/V3 打红**,那就是本步的交付物。
   谁来裁决哪个谓词赢:第 7 步或人工。

---

## 五点五、第 5.6 步(补网 → 抽 `viewRows` → 焊点校验)实际结果

本步只动 `frontend/` 与 `docs/`,不 commit。核心交付是**一张网**,不是一次抽取:
`viewRows` 那 75 行今天零覆盖,而它里面藏着一条产品语义级的不自洽。
本步把不自洽**钉成测试而不修它**,再在有网的前提下把纯逻辑搬出去。

### 5.6.0 验收命令(逐条可复制)

```bash
cd frontend
npx vitest run                                   # 18 files / 205 tests 全绿
npx tsc -b --force                               # exit 0 ← 真正的类型闸门,见 5.6.6
npx tsc --noEmit                                 # exit 0(但这条**什么都没检查**,见 5.6.6)
npx eslint src tests vitest.config.ts            # 36 problems (35 errors, 1 warning) = HEAD 基线
npm run build                                    # js 521.05 kB / gzip 154.86 kB;css 与基线逐字节相同
```

测试专用 standalone tsc(`tests/` 不在任何 tsconfig 的 include 里,见第五节缺陷 3):

```bash
# 配置文件只放在 scratchpad,不进仓库
npx tsc --noEmit -p <scratchpad>/tsconfig.tests.json   # exit 0
# tsconfig.tests.json = extends frontend/tsconfig.app.json
#   + include: [src, tests, vitest.config.ts, node_modules/vite/client.d.ts]
#   + typeRoots: [frontend/node_modules/@types], types: ["node"]
```

这条不是形式主义:往 `tests/deckListViewRows.test.tsx` 注入一行
`const _x: number = "s";`,standalone tsc 报 `TS2322`,而 `npx tsc --noEmit` **exit 0 毫无反应**。

### 5.6.1 落地清单

| 文件 | 状态 | 是什么 |
| --- | --- | --- |
| `tests/deckListViewRows.test.tsx` | 新增 | V0-V9b 共 12 条,页面级钉住 `viewRows` 的全部过滤/排序语义 |
| `tests/deckListPageFallback.test.tsx` | 新增 | F1-F3 共 3 条,补 `FORBIDDEN` / `NOT_FOUND` 两个回退码 + `listModeRef` 那一行 |
| `tests/deckListRowsWiring.test.ts` | 新增 | W1-W4,AST 断言 memo 输入对象与 deps 数组逐项同源 |
| `src/pages/deckListRows.ts` | 新增 | `buildViewRows` + `ConsoleDeckRow` + `ListMode` + `BuildViewRowsInput` |
| `src/pages/DeckListPage.tsx` | 改 | 净新增 11 行:2 行 import + 折叠后的 useMemo |
| `tests/support/hookWiringScan.ts` | 改 | 文件头那份「三条偏差全部偏安全方向」是**假的**,改成按方向分栏;`hooksNotInBarrel` 补作用域说明;新增 `findHookShapedExportsOutsideHooksDir` |
| `tests/hookWiring.test.ts` | 改 | 新增桶外 hook 白名单断言(`['useAuth']`) |
| `tests/hookWiringScan.test.ts` | 改 | describe 改名点明两个方向;新增遮蔽/反向两条对照 |

`tests/deckListPagePolling.test.tsx` 是对照组,**一个字符未动**,sha256 在 P0 与收尾两次核对相同。

### 5.6.2 搬迁是逐字节的(可复现)

搬走的 75 行 = `DeckListPage.tsx` HEAD 版本的 621-695 行。改写规则**只有三条 sed**:

```bash
sed -n '621,695p' src/pages/DeckListPage.tsx | \
  sed -e 's/^  //' -e 's/paged\.items/pagedItems/g' -e 's/manifestState\.bySlug/manifestBySlug/g'
```

- `s/^  //` —— 少一层缩进(从组件方法体变成模块顶层函数体),不改任何 token
- `paged.items` → `pagedItems` —— 参数化,该 token 全文**恰好出现 1 次**
- `manifestState.bySlug` → `manifestBySlug` —— 同上,**恰好 1 次**

两个 sha256 在动手前就算好了,事后无法倒填:

```
搬迁前(HEAD 621-695 行)  fd8734a4a96f7354317b94f30bdc870004046d8dec47ab474ff3ae1d3f32b11a
落地后(函数体)          abde1fc2fceec2d162241e39dcfc85e7c6eb8cd90ff0297f6b6a8fbdb6190dac
```

deps 数组逐字符未变:
`}, [listMode, paged.items, decks, manifestState.bySlug, q, statusFilter, typeFilter]);`

### 5.6.3 顺序证据:网确实先于抽取(一条命令链,一个时间戳)

```
Sun Aug 16 14:13:42 UTC 2026

 Test Files  17 passed (17)
      Tests  195 passed (195)
   Start at  02:13:43
   Duration  1.13s (transform 1.06s, setup 0ms, import 2.81s, tests 1.15s, environment 3.85s)

[src diff end]
b4370ea6f13e6083a8845a375cc9df433c2312115945e7918cd4d61f5957524d  frontend/src/pages/DeckListPage.tsx
696c1e83de6ae636d9185e3c323126950808464d25ffe1cfebb54c645ab5059f  frontend/tests/deckListPagePolling.test.tsx
```

`git diff --stat -- frontend/src` 在 `[src diff end]` 之前**没有输出任何一行**,
且两个 sha256 与 P0 基线逐字节相同 —— 空 diff 单独不能排除「改了又改回来」,
sha256 与之并排才能。15 条新测试是对着**未修改的** `DeckListPage.tsx` 写红→绿的。

### 5.6.4 变异矩阵(抽取之前,对着未修改的 `DeckListPage.tsx`)

每次:注入 → 跑全量 → 记录 → `cp` 还原 → `git diff --exit-code` 核对(不用 checkout,已禁)。

| 变异 | 改了什么 | 变红的用例 | polling |
| --- | --- | --- | --- |
| M1 | legacy `d.deckType !== 1` → `isStarterLike` (**「顺手修 bug」**) | V2, V3 | 6 绿 |
| M2 | 徽章 `:1064` → `row.deckType === 1` | V1, V3, V4 | 6 绿 |
| M3 | paginated `isStarterLike` → `row.deckType === 1` | V4, V5 | 6 绿 |
| M4 | 给 paginated 分支加客户端 q 过滤 | V7 | 6 绿 |
| M5 | 删 legacy 的 `if (query) {...}` | V6 | 6 绿 |
| M6a | 删 legacy 的 `statusFilter !== 'all'` 守卫 | V8a | 6 绿 |
| M6b | 删 paginated 的 `statusFilter !== 'all'` 守卫 | V8b | 6 绿 |
| M7 | `999999` → `0` | V9a | 6 绿 |
| M8 | 删 `.sort(...)` | V8a, V9a | 6 绿 |
| M9 | 集合里删掉 `'FORBIDDEN'` | **仅** F1 | 6 绿 |
| M10 | 集合里删掉 `'NOT_FOUND'` | **仅** F2 | 6 绿 |
| M11 | 删 `void loadAll(false)` | F1, F2, F3, L2 | 6 绿 |
| M12 | 删 `listModeRef.current = 'legacy';`(`:348`) | **仅** F3 | 6 绿 |

两条值得单独说:

- **M1 是本步最关键的一行。** 它正是「凌晨抽函数时顺手把两个谓词统一掉」那个编辑。
  V2/V3 变红是唯一阻止这条产品语义被静默抹平的机制。
- **M12 在 195 条测试里只打红 F3 一条**,证明 `:348` 在本步之前**完全无人守卫**;
  失败信息是 `expected "vi.fn()" to be called 1 times, but got 2 times`,
  机制与预测一致(ref 留在 `'paginated'` → `[debouncedQ]` effect 不再提前 return
  → 又打了一次已经 403 的端点)。没有 `pagedRequestSeq` 或批处理吞掉第二次请求。

M9 只杀 F1、M10 只杀 F2 —— 两条**不互相顶替**。

### 5.6.5 焊点矩阵(抽取之后,证明页面真的在跑这个模块)

| 变异(改 `deckListRows.ts`) | 变红的用例 | polling |
| --- | --- | --- |
| (a) `buildViewRows` 直接 `return []` | V1-V9b 全部 13 条 + F1/F2/F3 + L1/L2 | 6 绿 |
| (b) 两个 `.filter(...)` 都改成恒真 | V2, V5, V6, V8a, V8b | 6 绿 |
| (c) legacy 谓词换成 `isStarterLike`(**跨模块重跑 M1**) | **V2, V3** | 6 绿 |
| (d) 删 `.sort(...)` | V8a, V9a | 6 绿 |

(a) 是存在性检查:本仓库「功能写了但没人调用」已出现 8 次,抽出一个干净模块然后页面悄悄不用它正是这个形状。
(c) 更重要:它证明那条不自洽**跨过模块边界之后仍然被钉着**,不是只在搬家前钉着。

W1-W4 也被证伪过(四条变异各跑一次、各自还原):把对象字面量提到 factory 外 → W1-W4 全红;
加一个 `superAdmin,` 字段 → W3/W4 红 **且** `tsc -b` 报 `TS2353`(两把独立的锁);
`paged.items` → `paged.items ?? []` → **仅** W4 红;deps 里删掉 `q` → W3/W4 红。
另外单独确认 Lock C 真实存在:把一个解构绑定改名让函数体读不到它 → `tsc -b` 报
`TS6133: 'unusedQ' is declared but its value is never read`。

### 5.6.6 本步发现的两件事(都不是本步引入的)

**(1) `npx tsc --noEmit` 是空操作,一个文件都没检查。**
`frontend/tsconfig.json` 是 solution 壳:`"files": []` + 两个 `references`,
而不带 `-b` 的 `tsc` **不会跟随 project references**。
`npx tsc --noEmit --listFiles | wc -l` = **0**。
它在 HEAD 上就一直是 exit 0,因为它无事可做。
真正的类型闸门是 `npm run build` 里的 `tsc -b`:把一个多余字段塞进 `buildViewRows` 的入参,
`tsc --noEmit` 静默通过,`tsc -b` 报 `TS2353`。
**第 6 步的验收命令必须写 `tsc -b`,或者 standalone tsconfig,不能写 `tsc --noEmit`。**

**(2) Tailwind 的候选扫描会读 `src/` 下 `.ts` 文件里的散文注释。**
新模块的 JSDoc 里写了一个恰好与某个 Tailwind 布局工具类同名的普通英文名词,
构建产物里就真的多出了一条工具类规则,css 从 32.55 kB 涨到 32.84 kB。
改掉措辞后 css 与基线**逐字节相同**。
(第一版解释这件事的注释因为写出了那个类名,又把它带了回来 —— 已一并改掉。)

体积结论:js `520.94 kB → 521.05 kB`(**+0.11 kB**,约 110 字节;gzip `154.79 → 154.86 kB`),
css 逐字节不变(vite 报的是两位小数,所以这里不宣称更高精度)。
这 0.11 kB 是模块边界本身:导出函数壳 + 解构语句 + 跨模块 import。本步不新增任何依赖。

### 5.6.7 守卫的自述被修正了

`tests/support/hookWiringScan.ts` 文件头原本写「三条已知偏差,**全部**偏安全方向」。
这句话被它自己的第 3 条推翻了:「不可达分支里的调用仍然算调用」不是把活 hook 误报成孤儿,
而是**替一个没人调用的 hook 背书**——正是不安全的那个方向。
再加上遮蔽同名局部函数(第 4 条,方向同样不安全),原文既不完整、结论也为假。
现改为按**方向分两栏**:SAFE(别名调用、动态 import)/ UNSAFE(不可达分支、同名遮蔽),
并从文件头交叉引用 `calledIdentifiers` 上那段一直写对了、但埋在 150 行之下的注释。
`tests/hookWiringScan.test.ts` 的 describe 改名点明两个方向,并新增一条遮蔽用例
**外加它的反向用例**(去掉遮蔽后落进 `orphans`)—— 没有反向用例,那条断言可能只是
「输入里碰巧存在某个 `useCards()` 调用」的同义反复。

`hooksNotInBarrel` 的作用域也说准了:它**只**看路径含 `src/hooks/` 的文件,
`src/utils`、`src/auth` 里的 hook 对它完全不可见。
今天这个盲区里恰好只有 `src/auth/AuthContext.tsx` 的 `useAuth`,而且它有 4 个真实调用点
(`RequireAuth.tsx:7`、`RequireGroup.tsx:12`、`LoginPage.tsx:13`、`AuthCallbackPage.tsx:9`),
**是盲区不是欠债**——只写「useAuth 在守卫之外」而不写这 4 个调用点,是拿一个不准换另一个不准。
不能直接扩大 `hooksNotInBarrel` 的作用域:`hookWiring.test.ts` 断言它等于 `[]`,
`useAuth` 会掉进去,把一个接好了的 hook 判红。
所以另起一条断言:桶外 hook 形状导出 === `['useAuth']`。
已证伪:临时在 `src/lib/` 放一个零调用 hook → 该断言变红
(`expected [ Array(2) ] to deeply equal [ 'useAuth' ]`),删掉 → 恢复绿。

`scan.orphans` 未变:`hookWiring.test.ts` 的两条方向断言(孤儿 ⊆ 白名单、白名单 ⊆ 孤儿)
合起来等价于「orphans 恰好等于白名单键集」,两条在基线与现在都是绿的。

### 5.6.8 本步刻意砍掉的东西

1. **不给 `buildViewRows` 单独写纯函数测试文件。** 它已被 12 条页面级用例 + 4 行焊点矩阵覆盖;
   `manifestOrder` 在 DOM 里通过 `#-` 徽标可见,真正 DOM 不可见的只有 `key` / `id`。
   记为已知缺口。
2. **不做 useMemo 重算账本**(`vi.mock('react')` 数 hook 调用次数)。
   deps 数组逐字节未变 ⇒ `Object.is` 看到的输入序列按构造不变;
   W1/W4 又排除了唯一两种能改变缓存行为的写法。为一个已被钉住的性质引入 react mock,风险大于收益。
3. **不做「解析相对 specifier,给桶外 hook 做真实调用点分析」。** 那需要现场发明一套模块解析。
   文档写准作用域 + 一条可证伪的单条白名单,已经交付了诚实性要求。
4. `tests/deckListPageFallback.test.tsx` 与 `tests/deckListPageLegacyPath.test.tsx`
   **重复了约 40 行 fixture**,是刻意的:后者文件头对 L1-L3 的来源做了具体承诺,
   稀释它的代价大于这 40 行。


---

## 六、第 6 步开工前必须先补的网

本步**没有覆盖**下面这些,它们是第 6 步(拆组件结构)的前置条件。
在补齐之前动组件结构,等于在没有安全网的地方拆承重墙。

1. **localStorage 缓存路径。** `getCache` / `setCache` / `CACHE_TTL` /
   `CACHE_KEY_DECKS` / `CACHE_KEY_MANIFEST` 全部零覆盖:缓存命中时的免 loading 渲染、
   TTL 过期后的清除、`forceRefresh` 绕过缓存、以及第五节第 1 条那个静默失败。
2. ~~**`statusFilter` / `typeFilter` / 搜索过滤,以及手写的 300ms debounce。**~~
   **【第 5.6 步:部分补齐】** 已覆盖的:`statusFilter` 四个取值 × 两条路径
   (V8a/V8b,断言的是**完整可见 slug 列表**而非包含关系)、`typeFilter` 三个取值 × 两条路径
   (V1-V5)、`manifestOrder` 排序与 999999 兜底(V9a/V9b),
   以及**双路径不对称本身**(V6:legacy 下 `q` 即刻客户端过滤且不发请求;
   V7:paginated 下 `q` 不本地过滤,300ms 后带 `q` 回服务端)。
   **关于 300ms 这个常数本身:** 本文档原先写着「把 `300` 改成 `30000` 依然全绿」。
   这句话是假的,实测把 `300` 改成 `30000` 会让 V7 变红(1 failed | 204 passed)。
   它是一条没有跑过就写下的断言,排在 25 条真实变异结果旁边,语气完全相同——
   而这一步的 Batch 3 恰恰是在修「守卫的自述与事实不符」。
   留着这段记录而不是悄悄删掉,是因为它比它描述的那个覆盖缺口更值得记住:
   **一份声称「没有验收命令的条目算未交付」的文档,自己写了一条没验收的断言。**
   V7 用假计时器推进到 debounce 之后才断言请求发出,所以时长确实被间接钉住了;
   真正没被钉住的是「300 是不是合适的时长」,那不是测试能回答的问题。
3. ~~**删除 / 发布 / `ERR_RESOLVE_ID` 三条链路。**~~
   **【第 10 步:部分补齐,`window.confirm` 那句已过期】** 删除与发布两条的
   *确认闸门* 现在由 `tests/deckListPageConfirm.test.tsx` 覆盖(取消不调 API、
   确认调 `deleteDeck` / `publishDeck`、两个对话框的 role 一个 `alertdialog`
   一个 `dialog`、取消后焦点回到那一行自己的触发按钮)。
   「补网时要先想清楚 jsdom 下怎么 stub `window.confirm`」这句话本身已经过期:
   第 10 步把这两处换成了 `ConfirmDialog`,页面不再调 `window.confirm`,
   测试里说「是」变成点一个渲染出来的按钮,不再需要 stub。
   **仍然没补的**:`ERR_DELETE_DECK` / `ERR_PUBLISH_DECK` 两个 key 的**错误面**
   (服务端拒绝时横幅长什么样),以及 `ERR_RESOLVE_ID` 整条。那三条留给第 11 步。
4. **翻页与滚动位置。**
5. **闭包语义盲区(最容易被忽略的一条)。** `DeckListPage` 里**零 `useCallback`**。
   `loadPublishJobs` 被一个 `[]` 依赖的 effect 抓住、靠 `setTimeout` 自递归,
   因此**永远跑在首渲染的闭包里**。今天这是对的(它读的东西都在 ref 里),
   但第 6 步一旦把它提进 hook、或给它加依赖数组,闭包捕获的对象就变了。
   **本步这张网覆盖不到这类回归**——现有测试全部在首渲染后不久断言,
   看不见「第二次渲染之后闭包读到的是旧值」。

---

## 七、第 6 / 7 步计划

### 第 6 步:拆 DeckListPage 的组件结构

> **【第 5.6 步修正:范围已收窄,原文保留在下面】**
> 第 5.6 步**只**抽了 `viewRows` 这一个纯函数(→ `src/pages/deckListRows.ts`),
> **没有拆任何 JSX、没有抽任何子组件、没有提任何 hook**。
> 原因写在当时的越界清单里:先拆 `<tr>` 那 70 行看着更爽,
> 但会立刻踩进 `navigateWithDeckId` / `handlePublish` / `publishingSlug` / `superAdmin`
> 四个闭包,而第六节第 5 条(闭包语义盲区)这张网**至今没补**。
> 所以下面第 1、2、3 条**一条都还没做**,别把「已经拆好了」当成前提。
> 另外:第 6 步的验收命令**必须**用 `tsc -b`(或 standalone tsconfig),
> 不能用 `tsc --noEmit` —— 后者在本仓库是空操作,理由见 5.6.6。

前提:第六节列的网**全部补齐**之后才能动。做的事:

1. 把 manifest 数据路径与 paginated 数据路径各自提进一个 hook
   (`useLegacyDeckList` / `usePagedDeckList`),模式切换留在页面里。
   ⚠️ 提 hook 时最自然的动作是「把 `listMode` 与 `listModeRef` 合并成一个 state」——
   那会重新引入「回退之后每次搜索都再打一次已经 403 的端点」。
   现在有 `tests/deckListPageFallback.test.tsx` 的 F3 守着这一行了。

   > ⚠️ **过期标注(第 11 步,2026-08-17)**:这一条**做了一半**。paginated 通道
   > 已提成 `src/pages/useDeckPagination.ts`,但名字是 `useDeckPagination` 而不是
   > `usePagedDeckList`,legacy 通道(`loadAll` + manifest)**一行未动**,仍在页面里。
   > 上面那条警告是对的,而且**兑现了**:`listMode` 与 `listModeRef` 双双保留,
   > 两者都从 hook 返回,`listModeRef` 以 **ref 对象**返回而不是 `.current` 快照。
   > 详见第 11 步小节。原文保留,因为它是这个决定的理由。
2. 表格行、筛选栏、发布任务面板抽成子组件。
3. `statusBadge` / `typeBadge` 跟着行组件走,届时一并裁决要不要独立模块。
   ⚠️ `typeBadge` 的调用点(`:1064`)是第五节缺陷 7 那条不自洽的一条腿,
   动它之前先读那一条,并确认 V1/V3/V4 仍然绿。
4. 手写的 localStorage 缓存与 `CACHE_TTL` 是否让位给 react-query —— 独立裁决,不夹带。

### 第 7 步:代码分割

`dist/assets/index-*.js` 目前 520.94 kB(gzip 154.80 kB),超过 vite 500 kB 警告线。
按路由做 `React.lazy` 分割,控制台与学习端分包。**本步不做。**

---

## 八、第 7 步(卡片规则收敛 + 路由代码分割)实际结果

两件事:**A** 把两扇门共用的校验规则抽成 `src/lib/cardRules.ts` 并把分歧钉成测试;
**B** 做路由级 `React.lazy` 分割。A 是零行为改变,B 改变了每条路由的运行时行为。

开工快照(9 个文件 sha256 全部与预期逐字节一致,`git diff -- src` 为空):
`npx vitest run` 19 files / 213 tests 全绿;`npx tsc -b --force` exit 0;
`npx eslint src tests vitest.config.ts` 恰好 36 problems(35E+1W);
`npm run build` 单 chunk js **521,053 B** + css **32,553 B**。

> ⚠️ 方案预估的 js 是 521,048 B,实测 521,053 B,差 5 B。同一份源码在本机连跑两次
> 产物内容哈希完全相同(`index-DcPDWIRM.js`),且 9 个 sha256 与 `git status` 都证明
> 工作区未被污染,所以这 5 B 是环境差异(依赖 patch 版本)而非改动。**下文所有前后
> 对比一律以本机实测的 521,053 / 32,553 为锚**,不使用方案里的预估值。

### 8.1 A:分歧表 D1-D7 与共识 C1-C2

同一个 fixture 穿过两个适配器(`docFor` → markdown / `valuesFor` → 表单初值),
两侧断言并排写在同一个 `it()` 里,全部在 `tests/cardRuleDivergence.test.tsx`。

| # | 输入 | 导入门(`parseDeckMarkdown`) | 表单门(`CardForm`) |
|---|---|---|---|
| D1 | `explanation = ''` | `MISSING_ANSWER`,**整张卡被丢弃** | 接受,提交 `''` ⚠️ |
| D2 | `stableUid = 'A_B'` | `BAD_UID_FORMAT` | 接受,原样提交 `'A_B'` ⚠️ |
| D3 | `stableUid` = 129 个字符 | `BAD_UID_FORMAT`(超 `MAX_UID_LENGTH`) | 接受,全长提交 ⚠️ |
| D4 | `difficulty = 9` | `BAD_DIFFICULTY`,**卡在 header 阶段就没生成** | 接受,提交 `9` ⚠️ |
| D5 | 同一 uid 两张卡 | `DUPLICATE_UID` | **没有这条代码路径**,两次都成功 |
| D6 ↔ | `orderInDeck = 0` | 这正是导入**自己给每篇文档第一张卡分配的值** | **拒绝**:`orderInDeck must be a positive number` |
| D7 ↔ | `difficulty = 0` 或 `4` | 合法 | `<select>` 只有 1/2/3,**人在界面上选不到** |
| C1 | 空 / 纯空白 question | 拒绝 | 拒绝(`Question is required.`) |
| C2 | 空 stableUid | `BAD_CARD_HEADER` | 拒绝(`StableUid is required.`) |

> ⚠️ **2026-08-17 起,表单列多了一件事,少了零件事。** 8.2 的裁决(选项 3)落地后,
> D1-D4 这四行的表单门**除了「接受」还会就地给一条不阻断的提示**;
> 「接受什么」一个字没变 —— 表格里表单列的每一句话仍然逐字为真。
> D5 无提示(唯一性要整个集合,表单只握一张卡),D6/C1/C2 也无提示
> (它们已经被硬校验挡住,同一件事不说两遍)。
> 提示本身归 `tests/cardFormHints.test.tsx` 管;
> `tests/cardRuleDivergence.test.tsx` 里每条 `it()` 追加了一句 `hints` 断言,
> 它守的是**提示没有偷偷变成阻断**,而 D1-D4 的 `expect(outcome.accepted).toBe(true)`
> 一个都没动 —— 那四句才是「没有滑向选项 1」的真正看守。

**D6/D7 是反向的**:表单比导入更严。所以「把表单收紧到跟导入一样」根本不是一个
完整答案 —— 那两条它一条也解决不了。

C1/C2 不是分歧,是共识。它们在文件里的唯一理由:**D1-D7 没有任何一条会向表单提交
空 question 或空 uid**,所以如果没有 C1/C2,把 `hasContent` 改成 `return true`
时表单那半边会全绿,抽取在「每天真正被用的那扇门」上等于没被验证过。

### 8.2 A:如果要统一,有哪几种选择,各自会拒绝掉什么今天能存进去的东西

> ✅ **已裁决(2026-08-17):采用选项 3。** 下面四个选项与代价原样保留,因为它们是
> 这个决定的理由,不是待办清单。落地范围:`src/components/CardForm.tsx` 引入
> `isValidStableUid` / `isValidDifficulty`(以及三个常量,只为让提示文案里的
> 「128」「0..4」不被私抄一份),渲染三条 `data-card-hint` 内联提示;
> **导入侧一行未动,`handleSubmit` 里那四条硬校验一行未动。**
>
> 证据(不是「测试绿了」,是「钉子扛住了改动」):
> - `tests/cardRuleDivergence.test.tsx` 在实现穿过它的时候**一个字符都没改**
>   (sha256 `edd15fc9…`)就 10/10 全绿,之后才追加 `hints` 断言。
>   现有断言在改动前后逐字相同,所以「表单接受面没变」不是解释,是载荷。
> - 变异 M7(让提示阻断提交,也就是把选项 3 改成选项 1)使 D1-D4 的
>   `accepted` 断言全部变红 —— 这是「实现的是选项 3」的机器可验证形式。
> - 变异 M3(把 `MAX_UID_LENGTH` 改成 4)让表单侧断言跟着红,
>   证明表单读的是 `cardRules.ts` 而不是私抄了一份规则。
>
> 提示行为本身:`tests/cardFormHints.test.tsx`(时机、抗闪烁、可及性)。
> **诚实交代可达性**:三条提示热度天差地别。只有 explanation 一条日常真能踩到;
> uid 提示在新建时按构造不可达(每次按键 slugify、blur 削尾),
> 它的真实受众是编辑既有卡时那个 **readOnly** 的历史 uid,
> 所以文案只陈述后果、不含祈使句;difficulty 提示只有库里已有的越界值才点得亮。

**下面四个选项是当时的备选与代价,保留原文。**

**选项 1:表单向导入看齐(最直觉,代价最尖锐)**
会开始拒绝:空 Explanation 的卡;非 `[a-z0-9]`+`-_` 形状的 uid;超过 128 字的 uid;
0..4 之外的 difficulty。
**最尖锐的代价不在新建,在编辑**:库里已经存在的、由这个表单自己创建的空 Explanation
卡,从此**改不动了** —— 只想修一个错别字,却被一条自己从没碰过的历史条件挡在门外,
而且没有任何绕过去的路。**解决不了 D6/D7。**

**选项 2:导入向表单看齐**
要删掉 `MISSING_ANSWER` 与 uid 的格式/长度检查。
`BAD_UID_FORMAT` 是作者手滑与 gacha 重复发卡之间**唯一的墙**——
`deckImport.ts` 里那段事故注释记着那次:一个重复的 StableUid 让一次抽卡发了两张同样的卡,
玩家付了钱却少一张。**不推荐,列出只为完整。**

**选项 3:一个内核,两种严重度**
导入侧全部阻断(不变);表单侧一律降级为不挡提交的内联提示。
**按构造拒绝不了任何今天被接受的输入** —— 这是唯一一个零破坏的选项。
代价:`CardForm` 要长出一整套目前不存在的「提示但不阻断」UI。

**选项 4:归一化而不是拒绝(四个里可能最坏)**
静默改写用户的数据。而 `planImport` 是**按 uid 对账**的:一个被静默改写过的 uid,
下次导入不会被认成 update,而是**多出一张重复卡**。安静地制造 D5。

**统一也解决不了的**:D6/D7 是导入更松的方向;另外第三扇门
`validateDeckExportLikeMobile`(`DeckPreviewPage.tsx:74`)对 `orderInDeck` 唯一性有
独家意见,而它**从不回流给作者**。

### 8.3 A:抽取本身的证据

`src/lib/cardRules.ts`:零 import,7 个导出(4 常量 + 3 纯谓词)。
不含消息文本、不含唯一性检查、不含 `validateCards`、不含 `slugifyForStableUid`、
不含 orderInDeck/revision 规则 —— 理由写在文件头。

- **逐字节**:`UID_PATTERN` 与 `MAX_UID_LENGTH` 两行搬走前后 sha256 相同
  (`53ad568c…` / `6821a2b9…`),唯一参数化改写是加了 `export ` 前缀。
- **德摩根改写的 4 处**无法用 sha256 验收,改为把**改写前的原表达式逐字复制**进
  `tests/cardRulesEquivalence.test.ts` 当 `legacyUidExpr` / `legacyDifficultyExpr` /
  `legacyContentExpr`,用 fast-check(固定 seed)+ 手列边界语料断言逐点一致。
- ⚠️ **偏离方案的一点**:`UID_PATTERN` / `MAX_UID_LENGTH` **没有**被 import 回
  `deckImport.ts`。它们在那里的唯一使用点就是被改写掉的那一行,再 import 回去就是
  未使用导入,`tsconfig.app.json` 的 `noUnusedLocals` 会直接让 `tsc -b` 失败。
  它们现在只在 `cardRules.ts` 内部被谓词使用,并导出给等价性测试持有原表达式副本。

**焊点声明**在 `tests/cardRulesWiring.test.ts`。

> ⚠️ **这一段在 2026-08-17 之后已经过期,保留是为了让改动可读。**
> 它原本写着「`isValidStableUid` / `isValidDifficulty` 的消费者集合里没有 `CardForm`,
> 这是分歧本身,不是待办」,并预言「哪天表单开始调用它,那张表必须有人动手改,
> 而那需要人工点头」。**点头发生了(8.2 选项 3),表也动了**:三个谓词现在的消费者
> 都是 `[CardForm.tsx, deckImport.ts]`,三个常量的消费者是 `[CardForm.tsx]`。
> 该文件的文件头散文已连同表格一起重写 —— 它当时的前提(「表单一旦调用谓词就会开始
> 拒绝今天能存的卡」)恰恰是这次要证伪的东西,而证伪它的是 D1-D4 的 `accepted` 断言。
> `cardRules.ts` **没有新增任何导出**(sha256 仍是 `5d2e95d3…`),
> 所以那条枚举导出面的断言一字未动。

### 8.4 B:体积报告

**首屏下载量:553,606 B → 305,670 B(−44.8%,省下 247,936 B)。**
(553,606 = 开工基线 521,053 + 32,553;A 落地后基线为 553,688,B 从该值降至 305,670。)

分割后 22 个 chunk 的精确字节数:

| chunk | bytes | gzip |
|---|---|---|
| `index-*.js`(**首屏**) | 273,719 | 87.19 kB |
| `index-*.css`(**首屏**) | 31,951 | 5.97 kB |
| `CardForm-*.js`(含 highlight.js) | 57,714 | 18.24 kB |
| `http-*.js`(含 axios) | 37,687 | 15.09 kB |
| `DeckListPage-*.js` | 26,470 | 7.67 kB |
| `DeckImportPage-*.js` | 22,390 | 6.59 kB |
| `AdminUsersPage-*.js` | 20,312 | 5.38 kB |
| `CardListPage-*.js` | 19,156 | 6.05 kB |
| `ContentIntelligencePage-*.js` | 13,765 | 3.84 kB |
| `DeckEditPage-*.js` | 13,294 | 3.39 kB |
| `NewDeckPage-*.js` | 9,179 | 2.58 kB |
| `DeckPreviewPage-*.js` | 8,501 | 2.83 kB |
| `authoring-*.js` | 8,253 | 2.41 kB |
| `EditCardPage-*.js` | 4,411 | 1.43 kB |
| `NewCardPage-*.js` | 3,775 | 1.23 kB |
| `ErrorBanner-*.js` | 3,029 | 1.42 kB |
| `RarityDistribution-*.js` | 2,370 | 0.95 kB |
| `ConsoleShell-*.js` | 1,691 | 0.60 kB |
| `CardForm-*.css`(hljs 主题) | 857 | 0.40 kB |
| `sessionUser-*.js` | 809 | 0.47 kB |
| `cardRules-*.js` | 204 | 0.17 kB |

**highlight.js 现在在懒加载边界之后**:它由 `CardForm.tsx` 顶层 import 进来,
随 `CardForm-*.js`(57,714 B)一起走,首屏不再下载。axios 同理进了 `http-*.js`。
两者都用内容标记做了断言(`"Illegal lexeme"` / `"ERR_BAD_REQUEST"`),
且**先断言该标记在整个 dist 里至少出现一次**,否则依赖升级换了字面量之后
「不在首屏」会静默地恒真。

**每条路由首次进入的额外成本**(该路由闭包减去首屏闭包):

| 路由 | 首次进入额外下载 |
|---|---|
| `/decks/cards/edit`(EditCardPage) | **108,269 B** |
| `/decks/cards/new`(NewCardPage) | **107,633 B** |
| `/`(DeckListPage) | 77,939 B(**已预取,见下**) |
| `/decks/cards`(CardListPage) | 71,304 B |
| `/decks/cards/import`(DeckImportPage) | 70,904 B |
| `/content-intelligence` | 62,205 B |
| `/decks/edit`(DeckEditPage) | 61,734 B |
| `/admin/users`(AdminUsersPage) | 60,499 B |
| `/decks/new`(NewDeckPage) | 55,119 B |
| `/decks/preview`(DeckPreviewPage) | 54,441 B |

> ⚠️ **这个 tradeoff 必须由所有者本人认**:最贵的两条路由恰好是**录题页**,
> 而他的日常工作流就是手动录题。首屏省下的 hljs,会在他第一次点进录题页时补回来。
> 好消息是每个 chunk 只下一次(之后走 HTTP 缓存),坏消息是每次发新版本都要重下。

**预取**:只给 `DeckListPage` 加了模块作用域预取(`void loadDeckList()`)。
它是登录后的门面,不预取的话每次冷启动都要盯着 fallback。已验证它仍是独立 chunk
(没有被 Rollup 当静态边合回入口)。**其余 9 条路由都没有预取** —— 每加一条,
就吃掉一部分刚省下来的首屏。

**地板**:把仅剩的两个同步页(LoginPage / AuthCallbackPage)也改成 lazy,首屏只从
273,719 B 降到 270,133 B —— 只省 3,586 B。也就是说**剩下的 ~270 kB 基本全是
react-dom + react + react-router + react-query**,再怎么切页面都动不了它。
下一步真正的杠杆在 vendor 层(react-query 是否延到登录后 / react-dom 是否换
preact-compat),那是需要人点头的另一刀,本步不做。

**没有配 `manualChunks`,`vite.config.ts` 一字未改(sha256 仍是 `271d4ccf…`)。**
天真的 `manualChunks: id => id.includes('node_modules') ? 'vendor' : undefined`
实测让真实首屏**变差到 404,376 B**,同时让 vite 的 reporter 打印一个骗人的小 entry。
本步的最优解就是不配。

### 8.5 B:新增的失败路径与新增的 UX 后果

**新失败路径(已处理)**:分割之前导航不可能失败,分割之后 chunk 404 / 断网会让
`React.lazy` 的 thenable reject。开工前 `grep -rn "componentDidCatch|ErrorBoundary|
getDerivedStateFromError" src/ tests/` **零命中**,所以异常会一路冒到根、整棵树卸载成
纯白页。`src/components/ChunkErrorBoundary.tsx` 接住它。

按钮是 **`window.location.reload()` 而不是 setState 重试**:React 把 lazy 的 rejection
永久缓存在 payload 上(`_status = 2`),只做 setState 的「重试」会永远抛同一个错 ——
一个**存在但不生效**的按钮。`tests/chunkErrorBoundary.test.tsx` 第三条测试专门把这个
语义钉住:不点按钮、强制 rerender,仍然显示错误 UI。

**新 UX 后果(未处理,如实记录)** —— `tests/routeSuspenseBehavior.test.tsx`:

- 直接落在某条 lazy 路由上(冷启动 / 刷新)→ **fallback 正常显示**。
- **客户端导航**到一条 chunk 未缓存的路由 → **fallback 不显示,上一页继续留在屏幕上**,
  直到 chunk 到达。

也就是说:**点了导航链接之后,屏幕在若干百毫秒内毫无反应**。这比闪一下更难受,
而且在任何构建产物、任何 lint 规则里都不显形,只能靠驱动 router 才观测得到。
原因是 react-router 把导航状态更新包在 `startTransition` 里,React 不会用 fallback
替换**已经显示过的**内容。**实测在 MemoryRouter 下同样复现**,所以不是某个 history
实现的怪癖。

可选的修法(都需要人裁决,本步不做):
1. 每条路由各包一层 `<Suspense>` → 每次导航立刻出 fallback,但小 chunk 会闪。
2. fallback 用 CSS 延迟 250ms 淡入 → 快的不闪、慢的有反馈,代价是新 CSS + 一个要调的阈值。
3. 用 `useNavigation()` 之类在导航期间给链接一个 pending 态,不动 Suspense 结构。

### 8.6 已知缺陷(第 7 步只钉住;F1 与 F5 已在 `c074277` 修掉,其余仍未修)

- **F1 uid 靠打字打不出横线,但粘贴可以**。~~`slugifyForStableUid` 每次按键都对整个
  输入重新 slug 并 strip 首尾横线~~,所以逐字符敲 `cs-async-001` 得到的是
  **`csasync001`**;而把同一个字符串**粘贴**进去得到的是 **`cs-async-001`**。
  同一个意图、两种输入方式、两个不同的 uid —— 而 `.md` 里写的是后者,
  于是下次导入不是 update,是**多出一张重复卡**。(已实测验证,非推测。)

  **✅ 已修(`c074277`)**:把打字期归一化与最终归一化拆开
  (`slugifyWhileTyping` / `slugifyForStableUid`)。打字时不剥尾部分隔符,
  离开输入框时才剥;前导分隔符仍当场剥掉,因为 uid 不能以它开头,
  而删掉它不会挡住任何一次按键 —— 尾部那个才是「每一个刚打出来的横线」。
  由 `tests/cardFormStableUid.test.tsx` 守住,四个变异各自变红。

  ⚠️ **只修了从今天起的新输入。** 已经用手敲方式录进去、uid 里缺横线的历史卡片
  不会被这次改动碰到。自查办法见 8.7。
- **F2** ✅ **已修(`86dafe5`)**。编辑页 difficulty 越界时 `<select>` 显示值与实际值不符
  (界面只有 1/2/3,而导入接受 0..4;select 拿到没列出的值会回落到第一个选项,
  于是 difficulty=0 的卡显示成 Easy)。修法是补一个显示真实值的选项,
  **不给 0 和 4 编造系统里并不存在的语义**;它只在卡片已持有这种值时出现。
- **F3** ✅ **已修(`86dafe5`)**。`NewCardPage` 硬编码 `orderInDeck = 1`
  (注释还写着「默认用 1,更安全」),从第二张手录卡起导出校验必报
  Duplicate OrderInDeck —— **一个由控制台自己制造、再由它自己抱怨的缺陷**。
  改成读现有卡片算下一个号,步长 10 与导入通道一致;空卡组从 10 起而非导入的 0,
  因为导出校验会对 `OrderInDeck <= 0` 报警告。取卡片失败不挡录题。
  Download/Copy 改成有 error 就禁用并写明原因;**warning 不挡**——
  warning 是建议,拿它当门会让这道门恒常关闭因而失去意义。
- **F4** ✅ **已修(`86dafe5`)**。`EditCardPage` 调 `updateCard` 时不传
  `realWorldUsage`。API 层对 `undefined` 的键不发送,所以**不是数据丢失,
  而是一次悄悄没发生的编辑**,更难察觉。导入在判断 update / unchanged 时会比较
  这个字段,所以编辑落不了地也意味着这个卡组永远重新 replan。
  和隔壁 stable uid 是同一个毛病、相反的修法:uid 是身份不能改,usage 本该能改。
- **F5** `EditCardPage` 提交用的是 `card.stableUid` 而不是 `values.stableUid` ——
  **编辑页那个 uid 输入框改了等于没改**。

  **✅ 已修(`c074277`),但修的方向和第一眼想的相反。** 追查后端发现
  `stableUid` 是全系统的身份键:进度按 `(user_sub, deck_slug, stable_uid)` 归档
  (`src_C/Vpc/Runtime/ProgressEvents.cs:426`),调度状态的键是
  `deck_slug || ':' || stable_uid`(:379),`deckImport` 的对账只看 uid、
  从不看题面或行号。所以**改 uid = 把这张卡上所有用户的复习历史全部弃掉**,
  卡片当成新卡从头开始。
  也就是说这不是「提交时把修改弄丢了」,而是**「界面承诺了一件系统给不了的事」**
  —— 数据通路本来是对的,撒谎的是那个可编辑的输入框。
  修法是编辑模式下把该字段改成只读并写明原因,而不是让它「生效」。
- **F6** ✅ **已修(`91117b5`)**。表单校验 `revision > 0`,而它从未被发给服务器
  ——后端一直是接的(`Cards.cs` 创建时解析、更新字段表里也有),连客户端请求类型里
  都没有这个字段。**校验一个从不送出的值是个记号:一条什么都不保护的规则
  不是安全网,是一句「这里有东西被保护着」的宣称。**
  同一次提交还补齐了五个缺 `htmlFor` 的 label(点标题不聚焦、读屏说不出用途),
  以及 `tests/authoringRequestBody.test.ts` —— 见 8.8。
- **F7** `validateCards` 的 `BAD_DIFFICULTY` / `MISSING_QUESTION` / `MISSING_ANSWER`
  三条分支**经唯一生产入口 `parseDeckMarkdown` 不可达**:越界 difficulty 在 header
  解析阶段就被拦下并 `continue`,空 Q/A 被 `finishCard` 先丢掉。它们只在
  `tests/deckImport.test.ts` 直接调用 `validateCards` 时才被执行到。
  (这正是分歧表必须走 `parseDeckMarkdown` 而不是 `validateCards` 的原因 ——
  照着 `validateCards` 造表会高估导入门实际执行的规则。)

**第三扇门 `validateDeckExportLikeMobile`(`DeckPreviewPage.tsx:74`)本步没写测试**:
它是模块私有、未导出,要钉住它必须先导出它,而 `DeckPreviewPage.tsx` 本步必须保持
sha256 = `4736169d…` 逐字节不变。它那套第三规则(Difficulty 1..3 只是 warning、
OrderInDeck 唯一性是 error、OrderInDeck<=0 只是 warning、Question 空只是 warning、
Explanation 完全不查)只在此处以散文记录。

**顺手发现**:`vitest.config.ts` 里那段带大段注释的 `esbuild: { jsx, jsxImportSource }`
在 vitest 4 下**完全无效**(跑测试时会打印 `Both esbuild and oxc options were set...`,
JSX 能工作是 oxc 的默认行为)。本步不改,但那段注释目前在骗人。

### 8.7 本步新增/修改的文件与门禁

修改:`src/lib/deckImport.ts`、`src/components/CardForm.tsx`、`src/App.tsx`、
本文档。
新增:`src/lib/cardRules.ts`、`src/components/RouteFallback.tsx`、
`src/components/ChunkErrorBoundary.tsx`、
`tests/cardRuleDivergence.test.tsx`、`tests/cardRulesEquivalence.test.ts`、
`tests/cardRulesWiring.test.ts`、`tests/bundleFirstLoad.test.ts`、
`tests/routeFallback.test.tsx`、`tests/chunkErrorBoundary.test.tsx`、
`tests/routeSuspenseBehavior.test.tsx`。

**一字未动(收工 sha256 与开工逐字节相同)**:`DeckPreviewPage.tsx` `4736169d…`、
`NewCardPage.tsx` `cce0ebd2…`、`EditCardPage.tsx` `6c9ccddf…`、
`DeckListPage.tsx` `5b19b8e5…`、`vite.config.ts` `271d4ccf…`、
`tests/deckListPagePolling.test.tsx` `696c1e83…`。

收工门禁:`npx vitest run` **26 files / 252 tests 全绿**(213 → 252,+39);
`npx tsc -b --force` exit 0;`npx eslint src tests vitest.config.ts` **仍恰好
36 problems(35E+1W)**,新增文件贡献 0 条;`npm run build` 通过。
`tests/` 至今不在任何 project 的 include 里,所以额外在 scratchpad 造了一次性
standalone tsconfig(extends `tsconfig.app.json`,include `src` + `tests` +
`vitest.config.ts`)单独跑了一遍类型检查,exit 0,用完即删。

### 8.7 历史卡片自查:哪些 uid 可能在手敲时丢了横线

F1 的修复只作用于新输入。已经录进去的卡不会被改动,需要人工核对。

现在 AWS 凭证已过期,无法直接查库。不需要凭证的办法:控制台的卡片列表本来就
显示 `stableUid`(`CardListPage.tsx` 的等宽字体那一列),登录后逐个卡组扫一眼即可。

要找的形态:**整串没有任何分隔符、但读起来像是多个词粘在一起**,
例如 `csasync001`(应为 `cs-async-001`)、`jsbasicsletconstvar`
(应为 `js-basics-let-const-var`)。粘贴录入的卡不受影响,只有手敲的会中招。

在卡片列表页的浏览器控制台粘这段,可以把可疑的挑出来:

```js
[...document.querySelectorAll('tbody tr')]
  .map(tr => tr.querySelector('td.font-mono')?.textContent?.trim())
  .filter(uid => uid && !uid.includes('-') && uid.length > 8)
```

**发现之后不要直接改 uid**,原因见 F5:改 uid 会弃掉该卡已有的复习进度。
正确做法是先确认这张卡有没有真实的复习历史:
- 没有(比如刚录进去还没在手机上练过)→ 删掉重建,代价为零;
- 有 → 要么接受当前 uid 并把 `.md` 改成与它一致,要么需要一次带进度迁移的
  改名操作,那需要后端配合,不是控制台能做的事。

同一条注意事项对 `.md` 与库不一致的情况同样成立:导入按 uid 对账,
**对不上就是新建而不是更新**。

### 8.8 一条本轮反复出现、且我自己犯了两次的教训

「功能存在和功能生效之间隔着一次调用」在这个仓库出现了十一次。前九次是既有代码,
后两次是**在修前一次的过程中新造出来的**,都由变异测试当场抓住:

1. **ErrorBoundary 的 `resetKey`**(第 7 步补漏)。prop 写了、复位逻辑对了、
   行为测试也有,但把 `resetKey={location.pathname}` 从 `App.tsx` 删掉,
   257 条测试全绿 —— 没有任何东西证明 App 真的传了它。
   `tsc` 也盖不住,因为该 prop 是可选的(边界要能在没有 router 时被单独测)。
   补了一条读 `App.tsx` 语法树的断言。
2. **`revision` 的请求体**(F6)。页面级测试断言的是「页面传给 `createCard`
   的参数」,读的是一个被 mock 掉的函数的入参。所以从 API 层删掉
   `body.revision = params.revision` 之后 280 条全绿。

第二条给出了可推广的规则:

> **页面级测试只能看到它 mock 的那道缝为止。**
> 链条是 表单 → 函数入参 → 请求体;在 `api` 那层打 mock 的测试,
> 天然看不见 `api` 层内部把参数丢掉。要覆盖整条链,必须有一层测试把 mock
> 打在**更下面那道缝**(这里是 `http`)。

`tests/authoringRequestBody.test.ts` 就是那一层,它同时钉住了另一件容易被
「顺手清理」掉的事:**没传的字段必须从 body 里缺席,而不是发一个 undefined**。
局部更新的语义(「这项别动」)完全建立在这个区别上。


### 8.9 「首屏 305 kB」这个数字盖不住的那部分(在真实浏览器里量的)

第 7 步报的首屏 305,670 字节是**沿静态 import 边做闭包**算出来的,这是
「first load」的正确定义,但**不是「浏览器实际下载了什么」的定义**。

`App.tsx` 在模块作用域无条件跑 `void loadDeckList()`,为的是让控制台的正门在
React 挂载完之前就热好。这句在**登录页也会跑**——对一个还没登录、甚至可能永远
不会登录的人。在浏览器里实测(不是推断)未登录访问 `/login`:

| | 字节 | 文件数 |
|---|---:|---:|
| 首屏静态闭包 | 306,712 | 2 |
| **登录页真实下载** | **384,741** | **8** |
| 差额(预取链) | 78,029 | 6 |

多出来的 6 个:`DeckListPage`(26,470)、`http`/axios(37,687)、`authoring`(8,343)、
`ErrorBanner`(3,029)、`ConsoleShell`(1,691)、`sessionUser`(809)。

**没有改这个行为。** 能走到这个登录页的人下一步就是登录,这 78 kB 是他三秒后
本来也要付的。而且直觉上的修法是错的:`AuthCallbackPage` 用的是**路由跳转不是
整页刷新**,所以模块作用域不会重跑——「没 token 就不预取」会**恰好害了刚登录完
的人**,那正是最需要预取的时刻。要正确地做需要两个调用点,是另一次改动。

做的是**让数字诚实**:`tests/bundleFirstLoad.test.ts` 现在同时量两个闭包,
并给登录页单独设了预算(400 kB)。还加了一条**前提断言**——
因为 eager 闭包是靠文件名找到 DeckListPage 再走出来的,
**一旦有人删掉那句预取,这个测量就会继续为一个只下载 306 kB 的登录页报 384 kB**,
一个活得比自己前提更久的测量。所以前提本身也被断言了:删掉预取,测试变红。

---

## 第 9 步(2026-08-17)—— 删掉 19 个零调用 hook,并让 CI 第一次能跑绿

### 9.0 先更正上面几处会被读成现在时的数字

本文档开头写「`src/hooks/index.ts` 导出 22 个 hook」,4.1 A 的探针快照写
`exportedHooks.length = 22` / `orphans.length = 19` / `scannedFileCount = 75`。
**那些是写下时的实测值,保留原样是因为它们是历史记录,改掉等于伪造。**
但它们已经不是现在的事实。今天的值:

```
exportedHooks  = ["useCards","useDeck","useDeleteCard"]   ← 3 个,全部有页面在调
orphans        = []                                        ← 0 个
scannedFileCount = 73
hooksNotInBarrel = []
```

复跑方式(数字会烂,命令不会):

```bash
cd frontend && npx vitest run tests/hookWiring.test.ts
```

### 9.1 删了什么

19 个从来没有任何页面调用过的 hook。7 个整文件删除
(`useManifest` / `useDashboard` / `useAsync` / `useLocalStorage` / `useDebounce` /
`usePrevious` / `useIntersectionObserver`),另外 6 个是 `useDecks.ts` 与
`useCards.ts` 里的函数级删除——这两个文件里的 `useDeck` / `useCards` /
`useDeleteCard` 是 `CardListPage` 真正在用的,所以删函数不删文件。

**级联死代码**:hook 删掉之后,`src/api/authoring.ts` 的
`fetchDashboard`、`rebuildManifest` 和 `interface DashboardData` 变成零 importer
的悬空导出。三个一并删除。

`useDashboard.ts` 同时是 `cacheDuplicationCensus` 记的三份五分钟 TTL 之一,
所以那份普查从三缩到二——不是合并,是删除。

### 9.2 这一步暴露的一个方法论问题:删除型改动天然假绿

删的全是零调用代码,所以「删完测试还是绿的」什么都不证明——绿→绿说明没测到。
真正的收据是**状态发生改变**的检查。本步实际拿到的:

- **先删源码、不改测试**跑一次,`tests/hookWiring.test.ts` 的「the list cannot go
  stale」逐个点名了 19 个 hook,且**测试总数仍是 288**(3 失败 285 通过)——
  证明删除没有蒸发掉任何测试。
- **产物同一性**:`dist/assets/authoring-*.js` 在丢掉 3 个导出之后**字节数一个都没变**
  (8,343 → 8,343),`index-*.js` 同样纹丝不动(274,557 → 274,557)。
  这正是「删的确实是死代码」的证明:它们从来没进过产物,rollup 早就摇掉了。
  22 个产物里 20 个逐字节相同,变的只有
  `ContentIntelligencePage-*.js`(+54,修 lint)和 `index.css`(**−20**)。
- **CSS 那 20 字节值得单独说**:`.resize{resize:both}`。Tailwind 的 content 扫描
  扫到了 `useDebounce.ts` 注释里一句编造的宣传语(「窗口 resize」),
  于是一句假话真的在给全站每个用户发字节。

### 9.3 新增 `tests/apiSurfaceCensus.test.ts`

补的是所有现有工具共同的盲区:`noUnusedLocals` 按定义管不到 export,
ESLint 没有跨文件规则,rollup 把死导出摇掉所以产物里也看不出来。
于是「删了 hook 忘了删 `fetchDashboard`」是一个全套绿灯的状态。

它守 `src/api/authoring.ts` 的顶层导出中零 importer 的集合,做等值断言。
**这条测试的存在意义是靠「在中间状态变红」证明的**:只删 hook、没删 api 时它必须
红并点名 `fetchDashboard` / `rebuildManifest` / `DashboardData`——实测确实红了。
清单不为空(4 条既有死导出:`fetchPermissions` / `updatePermission` /
`bulkUpdatePermissions` / `checkPublishJobStatus`),那是与本步无关的既有债,
**如实记录而不是顺手删**。

### 9.4 一个差点发生的静默退化:棘轮给自己打麻药

`hookWiring.test.ts` 原来有一条自检
`expect(scan.exportedHooks.length).toBeGreaterThanOrEqual(ALLOWLIST 的条数)`。
白名单满的时候它是一条真实的下限(22)。**白名单清空之后右边变成 0,这条断言恒真——
把 `src/hooks/index.ts` 整个删掉它也照样绿。**

已实测复现:把 barrel 清成 `export {}`,用旧断言跑 → **通过**;换成写死具名的
`expect(scan.exportedHooks).toEqual(['useCards','useDeck','useDeleteCard'])` → 红。
「功能存在 ≠ 功能生效」这次差一点发生在检测器自己身上,而且全程绿灯。

同理,白名单清空后「the list cannot go stale」退化成 `expect([]).toEqual([])`,
以及两条 REASON 分类断言退化成空集循环——**一并删除**。
一个不会失败的测试和一个坏掉的测试从外面看一模一样。

### 9.5 CI 第一次能跑绿

`frontend/package.json` 里有一条
`releaseguard: file:../../../../Documents/Claude/.../releaseguard-0.7.6.tgz`,
**只在原作者本机存在,代码里零 import**。GitHub runner 上 `npm ci` 必然 ENOENT。
已确认这是 frontend job 今天唯一的必红原因,并已删除
(`npm uninstall --package-lock-only`,diff 恰好 25 行,只含它和它私有的 zod)。

`.github/workflows/ci.yml` 的 frontend job 加了 `npm run lint`。
**没有加独立的 `tsc` 步骤**,因为 `npm run build` 就是 `tsc -b && vite build`,
已实测:往 `src/` 塞一个真类型错,`npm run build` exit 2 且 vite 根本没开始构建。
理由与边界都写进了 ci.yml 的注释——特别是这条,任何人都不该再踩:

> **`npx tsc --noEmit` 在本仓库检查 0 个文件**(`tsconfig.json` 只有 references
> 没有 include),`--listFiles` 输出 0 行,塞任何类型错它都 exit 0。
> 本地要复现 CI 的类型检查请用 `npx tsc -b --force`。

顺带记下一个仍然成立的边界:**`tests/` 至今不被任何类型检查覆盖**
(不在 `tsconfig.app.json` 也不在 `tsconfig.node.json` 的 include 里),
只有 eslint 读它们。那是另一个任务。

### 9.6 剩下的债:src/ 里仍有 20 个文件、1,297 行从 main.tsx 不可达

CI 会绿、lint 0 error、tsc 过,但任何人点开 `src/components/ui/` 都会看到九个没人用的组件。
**本步没有删它们,因为它们不是同一类东西**:

| 目录 | 文件 | 行 | 为什么留着 |
|---|---:|---:|---|
| `components/ui/` | 9 | 809 | 通用组件库,删了要重写;需要单独决定是接线还是删 ⚠️ **第 10 步已改**:`ConfirmDialog.tsx` / `ConfirmDialogContext.ts` / `Button.tsx` 三个已接线并进入产物,见 9.8 |
| `components/decks/` | 5 | 350 | **下一步拆 `DeckListPage` 的预置零件**,删了就得重写 |
| `auth/` | 4 | 108 | `RequireGroup` / `RequireSuperAdmin` / `hostedUi` / `jwt` |
| `hooks/index.ts` | 1 | 30 | 见下 |

复跑这个数字的办法:从 `src/main.tsx` 出发做 import 图遍历(静态 + 动态 `import()`),
比对 `src/**/*.ts(x)` 全集。删除前后的**可达数都是 54**,这是不变量——
少一个就说明有活文件掉出了图。

### 9.7 `src/hooks/index.ts` 现在的角色

**src/ 里没有任何文件 import 这个 barrel。** `CardListPage` 走的是子路径
(`../hooks/useDecks`、`../hooks/useCards`),所以 barrel 一个字节都进不了产物。
它今天唯一的消费者是 `tests/hookWiring.test.ts` ——那条棘轮扫它来判定「哪些 hook
没人调」。删了 barrel 棘轮就塌,所以留着,但**它不是给页面用的便利导入**,
文件头已经写清楚了。

```bash
grep -rn "from '\.\./hooks'" frontend/src/    # 零命中
```

---

## 第 10 步(2026-08-17)—— 四处 `window.confirm` 换成 `ConfirmDialog`

### 10.1 裁决:是,只有 DROP TABLES 那一处需要更高的摩擦

四个调用点里,`AdminUsersPage` 的 reset 是唯一加了输入确认门
(`confirmPhrase: 'RESET'`)的。三条理由:

1. **爆炸半径不是同一类。** 其余三处分别销毁一张卡、一个 deck、或什么都不销毁
   (publish 幂等,重跑就是修复手段)。这一处 DROP 并重建
   decks/cards/progress/logs/permissions —— 所有人的数据,无撤销、无逐行恢复。
2. **误点距离是一个按钮。** `Reset & migrate (DEV only)` 与
   `Run migrate (no reset)` 在同一个 flex 行里,只差颜色。
3. **对话框自己的文案说 "Only use this in DEV",但这个按钮在每个构建里都发货**,
   指向控制台被配置到的任何 API。散文不是门。

**为什么不全都加:** 输入确认只在稀有时才买得到注意力。四处都要打字,
用户学会不看就打,严格比一次点击更糟 —— 它制造关心的错觉。
**为什么是 'RESET' 而不是二次对话框:** 令牌对目标是特定的;再来一个是/否对话框
只增加习惯化、不增加特定性。
**明确不做:** 重新认证、时间延迟、服务端确认令牌 —— 都需要后端改动。

`tests/adminUsersConfirm.test.tsx` 的第一个用例把这条裁决钉在原地:
「`Run migrate (no reset)` 不开对话框且直接调 `runMigrate(false)`」。
哪天有人给所有操作都加输入门,红的就是这一条。

### 10.2 Provider 挂在 `App.tsx`,在 `ChunkErrorBoundary` 内、`Suspense` 外

- **不挂 `main.tsx`:** 那一层的 provider(QueryClient / Auth / Router)是
  App 渲染前就必须存在的;而且 `main.tsx` 在模块作用域调 `createRoot`,
  测试里 import 它等于把整个应用挂进 `#root`,**接线因此无法被证明**。
  `App` 是普通组件,`tests/confirmWiring.test.tsx` 挂得起来。
- **在 boundary 内:** chunk 加载失败应当替换整屏(含开着的对话框)。
  顺带让 `tests/appBoundaryWiring.test.ts` 与 `chunkErrorBoundary.test.tsx`
  一个字符都不用改。
- **在 Suspense 外:** 开着的对话框必须挺过一次路由挂起,
  而不是被 fallback 替换时卸载、把等待中的 promise 永远挂住。

`tests/appConfirmWiring.test.ts` 用 AST 把这三条位置关系断言成范围包含,
不是「标签存在」。

### 10.3 `useConfirm()` 无 provider 时回退到 `window.confirm`,不抛

这是**给第 11 步的接口**,不是疏忽。本仓库大量页面级测试是裸挂的
(`<MemoryRouter><DeckListPage /></MemoryRouter>`,没有应用外壳),
`tests/deckListPagePolling.test.tsx` 也是。抛错会让它们全红,
而最省事的修法是给它们全都包一层 provider —— 那会静默删掉
「这个页面能独立工作」与「这个页面在应用里能工作」的区别。

回退在 `tests/confirmDialogA11y.test.tsx` 里被显式断言。
「真实应用不走这条路」是另一个主张,由
`tests/appConfirmWiring.test.ts`(AST 位置)与
`tests/confirmWiring.test.tsx`(挂真 `<App/>`,并把 `window.confirm` stub 成抛异常)
分别回答。

### 10.4 可及性:改的不是「不完整」,是**错的**

旧 `ConfirmDialog.tsx` 顶着注释 `// Focus trap: keep focus within dialog`,
而那个 handler 只处理 Escape,没有 trap;`autoFocus` 放在 **CONFIRM** 按钮上,
破坏性对话框的默认焦点正落在 "Delete" 上;`aria-modal` 完全缺失;
`aria-describedby="confirm-body"` 无条件输出而 `<p id="confirm-body">` 只在有 body 时渲染。
Escape 今天能工作纯属侥幸 —— `autoFocus` 恰好把焦点放进了持有 React `onKeyDown` 的子树。

现在:初始焦点落在**破坏性最低**的控件(destructive → Cancel,
非破坏 → 确认按钮,有 phrase → 输入框);手写 Tab / Shift+Tab 双向环绕 +
document 级 `focusin` 守卫;Escape 走 document 级 keydown,且与点击 overlay
解析出**同一个值**;overlay 从 mousedown 起算;destructive → `alertdialog`,
否则 `dialog`,两者都 `aria-modal="true"`;id 用 `useId`;
`aria-describedby` 只在真有 body 时输出。

⚠️ **写测试的人注意:** dom-testing-library **不解析 ARIA 子类**,
`getByRole('dialog')` 找不到 `alertdialog`。写错的表现像「对话框没打开」,
而自然的「修法」是把所有对话框都改成 `role="dialog"` —— 那会静默丢掉
`alertdialog` 语义。`tests/confirmDialogA11y.test.tsx` 两个方向各钉了一条。

### 10.5 一条**没有牙齿**的实现细节,如实记下来

焦点恢复用了 `trigger.isConnected` 守卫。开工前的假设是
「对已卸载节点 `focus()` 会静默把焦点丢给 body」。**实测这是错的**:
jsdom(以及规范)里 `focus()` 作用在已断开的元素上是 no-op ——
节点被移除时 `activeElement` 就已经变了,再调一次不改变任何东西。
所以这行**无法被测试给出牙齿**,也没有任何用例假装覆盖它;
它留着只是因为「只把焦点还给还在页面上的东西」是意图。
`tests/confirmDialogA11y.test.tsx` 里那条「不假装恢复一个被删掉的触发者」
是**记录行为**的用例,不是守卫,文件头写明了。

### 10.6 体积:预测 +4.0~5.5 kB,实测见收工报告

`ConfirmDialog.tsx` 与 `Button.tsx` 本步之前**一个字节都不在产物里**
(production 构建后没有任何 chunk 含 `confirm-title`,也没有含
`focus-visible:ring-indigo-500`)。所以这不是「已下载的代码获得调用者」,
而是把两个文件作为全新的**首屏**字节引入。


---

## 第 11 步(2026-08-17)—— paginated 数据通道提成 `useDeckPagination`

一件事:把 DeckListPage 的分页取数通道整块搬进 `src/pages/useDeckPagination.ts`。
**零行为改变**,而且这次「零」是按构造成立的:搬走的五段文本 sha256 与落地后
逐字节相同,一个参数化改写都不需要。

### 11.1 先补网,再动 src —— 顺序有硬证据

四个表征文件全部**对着未修改的 `DeckListPage.tsx`** 写到绿,那一刻同时留下两样证据:
`git diff --stat -- frontend/src` 打印为空,**且** `DeckListPage.tsx` 的 sha256 仍是
`c7055d4f…`(第 10 步的收工值)。空 diff 单独不能区分「没动过」与「动了又改回来」。

- `tests/deckPaginationLoadMore.test.tsx` —— `loadPagedMore` 此前**零覆盖**。
  三页夹具而不是两页:两页在 cursor 被重复发送的情况下照样通过。
- `tests/deckPaginationRace.test.tsx` —— `pagedRequestSeq` 守卫,此前**零覆盖**。
  到达顺序由 deferred promise 决定,不依赖 fake timers 或微任务调度。
- `tests/deckPaginationRowActions.test.tsx` —— `resolveDeckId` 的两条分支。
- `tests/deckPaginationErrorSurface.test.tsx` —— `pagedError` 的两种渲染面。
  其中致命面上的 **Retry 按钮此前从没有任何测试按过**,正是本仓库那个反复出现的
  缺陷形状:一个存在却从不被调用的控件。

`tests/deckPaginationHookWiring.test.ts` 是**提取之后**才写的,它的出处在文件头
写清楚了:提取前它以「模块不存在」失败,那是关于文件系统的证据,不是关于代码的。

### 11.2 搬迁验收:五段 sha256 全部逐字节相同

| 段 | 内容 | 原位置 | 落点 | sha256 |
| --- | --- | --- | --- | --- |
| A | 分页状态声明块(6 state + 2 ref) | `DeckListPage.tsx:173-184` | `useDeckPagination.ts:127-138` | `c6c240b2…` |
| B | `loadPagedFirst` + 分节横幅 | `:319-358` | `:140-179` | `f2bd87ca…` |
| C | `loadPagedMore` | `:360-382` | `:181-203` | `cb0a26dd…` |
| D | `[debouncedQ]` effect | `:427-433` | `:205-211` | `02e8ffbc…` |
| E | `PAGINATED_FALLBACK_CODES` | `:110-116` | `:69-75` | `3842f5ee…` |

一个参数化改写都没有,原因是签名的四个参数**以它们所替换的标识符命名**:
`superAdmin` / `debouncedQ` / `mountedRef` / `loadAll`。

**没搬走的东西,以及为什么**:`resolvedIdsRef` 紧挨在 A 段下面,但它只被
`resolveDeckId` 读,而后者写页面的错误反馈(`ERR_RESOLVE_ID`);`debouncedQ` 与
它的 300ms 防抖 effect 被三个页面调用点读(Retry、Refresh、handlePublish)。
搬走任何一个都会把切口扩进错误反馈或被禁的防抖常数。

### 11.3 两条不许动的实现细节,各有一条测试盯着

1. **两个 loader 保持普通 `async function`,不加 `useCallback`。** 它们每次渲染重建,
   因此永远闭合最新的 `paged`。变异 `useCallback(…, [paged.hasMore, pagedLoading])`
   —— 一个**看起来很合理**的 deps 数组 —— 让第二次 load more 重发 `cur-1`,
   而**只有第三页那条断言**看得见它(实测报错:`expected { cursor: 'cur-1' } to
   deeply equal { cursor: 'cur-2' }`)。
2. **`pagedRequestSeq` 保持 `useRef`。** 变异成每次渲染重建的普通对象 → R1、R2 精确变红。
   变异成真正的 `useState`(getter/setter 包装)→ **32 条红横跨 9 个文件**,
   连不许修改的对照组 `tests/deckListPagePolling.test.tsx` 都会被逼红。

### 11.4 effect 顺序确实变了,变化不可观测

挂载时的 effect 顺序从「mountedRef(1)、`[q]` 防抖(2)、legacy-mount(3)、
`[debouncedQ]`(4)」变成「mountedRef(1)、`[debouncedQ]`(2)、`[q]` 防抖(3)、
legacy-mount(4)」,因为 hook 的 effect 在它被调用的位置注册。逐对论证:
旧的 2 只是安排一个 300ms 定时器,同一个 commit 内不碰任何状态;
旧的 3 与旧的 4 各自开头就测 `listModeRef.current`,互斥,相对顺序不可观测。
`mountedRef` 仍是第一个 —— 那是唯一不能动的一条,两个 loader 都在 await 之后读它。
证据:`tests/deckListPagePolling.test.tsx`(指定对照组,**零编辑**)与
`tests/deckListPageFallback.test.tsx` 的 F1/F2/F3(**断言零编辑**,只改了文件头的
行号引用)全绿。

### 11.5 `listModeRef` 必须以 **ref 对象**返回,不是 `.current` 快照

这在第 10 步之后从洁癖升级成正确性要求:`handleDeleteDeck` 与 `handlePublish`
都在 **`await` 之后**读它,而第 10 步把阻塞的 `window.confirm` 换成了
`await confirm(...)` —— 对话框开着的那几秒里,`[debouncedQ]` effect 可以跑完
一整轮 `loadPagedFirst` 并把模式从 paginated 翻成 legacy。快照会让这两个 handler
读到渲染时的值。

⚠️ **这个 post-await 读取今天零覆盖**,`deckListPageFallback` 与
`deckListPagePolling` 都没有覆盖它。本步**没有补**:补它要造「对话框开着时后台
翻模式」的场景,会牵进本步禁区里的轮询代码。**记在这里,不当作已解决。**

### 11.6 体积:首屏 ±0,全部落在已经 lazy 的 chunk 里

前后各构建一次实测(不是推算):首屏静态闭包 **309,259 B → 309,259 B**,
`index-*.js` **279,304 B → 279,304 B** 逐字节相同(文件名 hash 变了,因为它内嵌了
DeckListPage chunk 的名字)。eager 闭包 387,464 → 387,874(**+410 B**),
差额**全部**在 `DeckListPage-*.js`(26,646 → 27,056),即已经 lazy 的边界之后。
