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
6. **`manifestState.meta` 是只写状态。**(本步新发现)`parseManifestMeta` 的返回值
   写进 state、写进 localStorage 缓存,**没有任何 JSX 读它**。
   它不是完全死的(缓存里存了、读回来又塞进 state),但它对用户不可见。
   第 6 步要么把它接到界面上,要么删掉它和它那 4 条单测——**本步不做这个裁决。**

---

## 六、第 6 步开工前必须先补的网

本步**没有覆盖**下面这些,它们是第 6 步(拆组件结构)的前置条件。
在补齐之前动组件结构,等于在没有安全网的地方拆承重墙。

1. **localStorage 缓存路径。** `getCache` / `setCache` / `CACHE_TTL` /
   `CACHE_KEY_DECKS` / `CACHE_KEY_MANIFEST` 全部零覆盖:缓存命中时的免 loading 渲染、
   TTL 过期后的清除、`forceRefresh` 绕过缓存、以及第五节第 1 条那个静默失败。
2. **`statusFilter` / `typeFilter` / 搜索过滤,以及第 603-606 行手写的 300ms debounce。**
   要特别注意 **双路径不对称**:paginated 模式下 `q` 经 debounce 走服务端,
   legacy 模式下是客户端过滤全量列表。同一个输入框,两套语义,零测试。
3. **删除 / 发布 / `ERR_RESOLVE_ID` 三条链路。** `ERR_DELETE_DECK`、`ERR_PUBLISH_DECK`、
   `ERR_RESOLVE_ID` 三个 key 没有任何页面级测试。这三条都会写 `window.confirm`
   与错误面,补网时要先想清楚 jsdom 下怎么 stub。
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

前提:第六节列的网**全部补齐**之后才能动。做的事:

1. 把 manifest 数据路径与 paginated 数据路径各自提进一个 hook
   (`useLegacyDeckList` / `usePagedDeckList`),模式切换留在页面里。
2. 表格行、筛选栏、发布任务面板抽成子组件。
3. `statusBadge` / `typeBadge` 跟着行组件走,届时一并裁决要不要独立模块。
4. 手写的 localStorage 缓存与 `CACHE_TTL` 是否让位给 react-query —— 独立裁决,不夹带。

### 第 7 步:代码分割

`dist/assets/index-*.js` 目前 520.94 kB(gzip 154.80 kB),超过 vite 500 kB 警告线。
按路由做 `React.lazy` 分割,控制台与学习端分包。**本步不做。**
