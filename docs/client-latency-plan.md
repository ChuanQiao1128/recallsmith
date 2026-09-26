# 客户端延迟工程计划(TRV 实习申请专用,2026-08)

> 定位一句话:`docs/low-latency-plan.md` 做的是**服务端与存储层**的延迟工程
> (定预算 → 测量 → 找热路径上的浪费 → 优化 → 用百分位说话);
> 这份文档把同一套方法搬到**用户真正等待的那一端**:浏览器控制台与手机 App。
>
> 规矩不变,四条:
>
> 1. **先有预算,再有优化。** 每条方案都写死"测什么、用什么工具、超过多少算不合格"。
> 2. **没有测量方案的优化提案无效。** 本文档第 0 条是测量地基,它排在所有优化之前,
>    因为现在两端的客户端测量命中数都是**零**。
> 3. **用百分位,不用平均值。** 客户端方差比服务端大得多(机型、网络、缓存冷热),
>    平均值会把最难受的那部分用户藏起来。
> 4. **诚实边界。** 这是毫秒到几百毫秒的世界,不是微秒世界;
>    凡是估计值一律标"估计",凡是本机实测一律注明机器与档位。
>
> 另外三条红线:不换框架、不重写、不提"看起来会更快但没法量"的改动。
> 已经做完的优化(移动端队列写通缓存、服务端摄入计时与冷启动分解、事件先落盘写序、
> 6-CTE 单语句、keyset 分页、delta patch 327 B、连接复用)一律不再重复提案。

## 证据说明

本文档所有 `file:line` 均在 2026-08-16 由实读源码核对过。两组本机实测:

**A. 控制台真实产物**(`cd frontend && npx vite build`,vite 7.2.4):

| 产物 | 体积 | gzip |
|---|---:|---:|
| `dist/assets/index-*.js` | 501.06 kB | 148.43 kB |
| `dist/assets/index-*.css` | 31.93 kB | 6.20 kB |
| `dist/index.html` | 0.46 kB | 0.29 kB |

182 modules transformed,构建输出直接打印 `Some chunks are larger than 500 kB` 警告,可复现。

**B. 逐依赖体积探针**(仓库自带 esbuild,`--bundle --minify --format=esm`,
NODE_ENV=production;每个探针是一个 namespace import,所以**含它自己的依赖**,
必须扣基线才是净体积):

| 探针 | 探针总量 min / gzip | 含哪些基线 | 净体积(推算) |
|---|---:|---|---:|
| react 单独 | 8 412 / 3 305 B | (基线本身) | 8.4 kB / 3.3 kB |
| react + react-dom/client | 193 475 / 60 333 B | (基线本身) | 193.5 kB / 60.3 kB |
| highlight.js core + 5 语言 | 49 005 / 15 916 B | 无 | **49.0 kB / 15.9 kB** |
| axios | 36 905 / 14 868 B | 无 | **36.9 kB / 14.9 kB** |
| @tanstack/react-query | 55 453 / 16 959 B | 含 react | **≈47.0 kB / ≈13.7 kB** |
| react-router-dom | 207 831 / 67 713 B | 含 react + react-dom | **≈14.4 kB / ≈7.4 kB** |

倒推:五个依赖净体积合计约 341 kB min,主 chunk 501 kB,
所以**应用自身代码约 160 kB min**(推算值,不是实测)。

**核查中修正的三处**(原始提案与代码不符,已改正):

| 原提案说法 | 实际 |
|---|---|
| `App.tsx` 静态 import "10 个页面" | 实际 **12 个**页面组件(`frontend/src/App.tsx:5-17`) |
| DeckEditPage 卡片计数在 `:180` | 实际在 `frontend/src/pages/DeckEditPage.tsx:182` |
| react-router-dom = 49.0 kB min / 17.4 kB gzip | 探针含 react-dom 基线,净体积仅约 **14.4 kB / 7.4 kB**,不是首屏包体的大头 |

另修正两处路径与行号:`DrawCeremonyScreen.tsx` 在 `mobile/src/screens/` 而非
`mobile/src/features/gacha/ceremony/`;`LibraryScreen` 的 `renderItem` 在 `:331-339` 而非 `:341`。

---

# 第 0 条:双端测量地基(其它一切的前提)

## (a) 这是什么

家里水费突然翻倍,但全屋一个水表都没装,你只能猜是马桶漏了还是花园管漏了。
现在两端就是这个状态:服务端已经有 p50 102.8 ms / p99 152.3 ms 的真数字,
客户端**一个数字都没有**。所以"我把它改快了"目前只能是一句感觉,不是事实。

要装的表分两类。**通用表**是行业已经定好的两个:
客人进门到第一道菜上桌(页面加载 LCP)、客人举手到服务员回应(每次点击/打字的响应 INP)。
**专用表**是这两个产品最要命的动线,通用指标看不见它们:
控制台的"点 Publish 到任务出现在列表里"、"粘贴 Markdown 到预览表格出现";
App 的"冷启动到能点"、"打完分到下一张卡能点"、"抽卡仪式期间掉了几帧"。

## (b) 现状

| 端 | 事实 | 证据 |
|---|---|---|
| 控制台 | `performance.mark` / `performance.measure` / `PerformanceObserver` / `web-vitals` / `console.time` 在 `frontend/src` 全目录命中数 **0** | rg 全目录 |
| 控制台 | 依赖里没有 `web-vitals` | `frontend/package.json:12-19` |
| 控制台 | 发布链路无任何埋点 | `frontend/src/pages/DeckListPage.tsx:612-643` |
| 控制台 | 导入预览链路无任何埋点 | `frontend/src/pages/DeckImportPage.tsx:186-214` |
| 控制台 | `index.html` 无任何 preconnect / 资源提示,而 API 是跨源 | `frontend/index.html:1-13` |
| App | `performance.now` / `console.time` / `InteractionManager` / `frameDrop` 在 `mobile/src` 命中数 **0** | rg 全目录 |
| App | 唯一的性能脚本跑在 Node 侧,用内存 Map 假装 AsyncStorage,脚本自己写明这是 lower bound | `mobile/scripts/bench-hot-paths.ts:21-30` |

真机与真浏览器上,零测量。

## (c) 两档

**小改进(两晚,两端各一晚)**

控制台侧,新增两个文件:

- `frontend/src/perf/vitals.ts`:用原生 `PerformanceObserver` 采
  LCP(`largest-contentful-paint`,取最后一条)、INP(`event` + `durationThreshold: 40`,
  取 p98 事件时长)、CLS、TTFB(`navigation`)。**不引第三方库**,包体增量为零;
  若图省事引 `web-vitals`,gzip 约 2 kB。
- `frontend/src/perf/journey.ts`:暴露 `markStart(name)` / `markEnd(name)`,
  内部走 `performance.mark` + `performance.measure`,只在 `import.meta.env.DEV`
  或 URL 带 `?perf=1` 时激活,生产默认关闭。

四个埋点:`DeckListPage.tsx:621`(publish 点击)→ 发布任务首次出现在 `publishJobs` 的那次渲染;
`DeckImportPage.tsx:189`(预览点击)→ `:207` setPreview 之后。
再加一个只在 `?perf=1` 显示的角落浮层,列最近 20 条 measure 并支持一键复制 JSON,
方便直接贴进 PR 描述。

App 侧,新增 `mobile/src/perf/marks.ts`:`mark(name)` / `measure(from, to)`,
底层用 Hermes 自带的 `global.performance.now()`,最近 200 条存环形数组,`__DEV__` 下打 p50/p95。
三个埋点:

1. `mobile/index.ts` 模块顶端记 t0 → `mobile/src/screens/HomeScreen.tsx:282` 的
   `useFocusEffect` 首次回调结束 = **冷启动 TTI**;
2. `mobile/src/screens/SessionCardScreen.tsx:377` `handleRating` 入口 →
   `setCurrent(nextState.nextCurrent)` 之后一个 `requestAnimationFrame` 回调
   = **评分到下一张卡可交互**;
3. 一个 `useFrameSampler()` hook,连续 `requestAnimationFrame` 记 delta,
   统计 >16.7 ms / >33 ms 的帧占比。

**诚实边界必须写在代码注释里**:`requestAnimationFrame` 只看得见 JS 线程,
UI 线程掉帧它测不到。所以必须用 RN Dev Menu 的 Perf Monitor(同时显示 UI FPS 和 JS FPS)
交叉验证一次,确认两者数量级一致。

**企业级演进(万级卡 / 十万用户)**

两端同一套 `{name, value}` 通过 `navigator.sendBeacon`(Web)与已有的 `/api/v1` 面(App)
上报,复用服务端已做的摄入计时通道。按 route / 角色 / 机型 / OS 版本 / deck 卡数分桶,
存 p50/p75/p99,用 RUM 分位数守门而不是本机 Lighthouse。
采样率 1%(App)与 10%(控制台)控制上报量。
CI 里跑 Lighthouse CI + `vite build` 体积断言 + 20 次冷启动取 p50,超预算直接红灯。
UI 线程帧率补原生采集(iOS `CADisplayLink`、Android `FrameMetrics`),补上 JS 侧的天生盲区。

## (d) 怎么测量

| 指标 | 工具 | 预算(先按当前 200 卡规模定,第一次测完校准) |
|---|---|---|
| LCP p75 | PerformanceObserver + Lighthouse | ≤ 2.5 s |
| INP p75 | PerformanceObserver(`event`) | ≤ 200 ms |
| 首屏 JS gzip | `vite build` 输出表 | ≤ 110 kB |
| publish 点击 → 任务可见 p75 | journey mark | ≤ 3 s(优化前基线) |
| 预览点击 → 预览可见 p75 | journey mark | ≤ 1.5 s |
| 冷启动 TTI | `mobile/index.ts` t0 → Home 首次 focus 回调 | p50 < 2.0 s,p95 < 3.5 s |
| 评分 → 下一张卡可交互 | marks + rAF | p95 < 100 ms |
| 仪式期间 JS 长帧(>33 ms)占比 | useFrameSampler | < 2% |

**测量档位是纪律**:控制台一律 Chrome DevTools 的 **Slow 4G + 4× CPU throttling**,
每条旅程跑 10 次取 p50/p75,冷缓存与热缓存各一组;
App 一律在**至少一台低端安卓**上跑,冷启动方差大,至少 20 次取 p50 与 p95 两个数。

## (e) 预期量级

本身不降低一毫秒延迟(估计建表成本两晚)。收益是把后面 12 条从"我觉得"变成"我量到",
并且可能给出其中至少一条的正确结论是"**别改**"。
埋点自身开销估计 < 1 ms/次 mark,控制台包体增量 < 1 kB gzip(不引库)。

---

# 控制台(frontend/)

## C1 · 首屏包体:501 kB 一个 chunk,里面装着从没被调用的 react-query

### (a) 这是什么

搬家时把全屋家具打包成一个巨大的箱子,哪怕你只想进门坐下喝口水,
也得先把整箱抬进屋、拆完才能坐。控制台一共十二个页面,用户打开首页只需要"卡组列表"这一件家具,
却被迫下载并解析包含代码高亮器、卡片编辑器、管理员页在内的全部代码。
更冤的是箱子里有一台冰箱从来没插过电:请求缓存库装了、包在了外面、但没有任何页面用它。

代码分割就是把大箱子拆成按房间打包的小箱子,进哪个房间才拆哪个箱子。
它对首屏的作用是实打实的两笔:少传字节,也少解析字节。

### (b) 现状

| 事实 | 证据 |
|---|---|
| 单 chunk 501.06 kB / gzip 148.43 kB,vite 直接打警告 | 本机 `npx vite build` |
| 12 个页面全部静态 import,全仓无一处 `React.lazy` | `frontend/src/App.tsx:5-17` |
| `highlight.js` core + 5 语言 + 主题 CSS 静态 import | `frontend/src/components/CardForm.tsx:8-14` |
| 而 CardForm 只被两个页面用到,却因静态图进了首屏 | `NewCardPage.tsx:6`、`EditCardPage.tsx:7` |
| `QueryClientProvider` 挂在根上,配置齐全 | `frontend/src/main.tsx:13`、`frontend/src/api/queryClient.ts:4-23` |
| 但 `useQuery` / `useDecks` / `useCards` / `useManifest` 在 `pages/` 与 `components/` 命中数 **0** | rg |
| 即三个 hooks 文件全是死代码 | `hooks/useDecks.ts`、`useCards.ts`、`useManifest.ts` |
| 没有 preconnect,而 API 跨源 | `frontend/index.html:1-13`;`vite.config.ts:9` 指向 execute-api |

体积账(探针实测):highlight.js 15.9 kB gzip + react-query 约 13.7 kB gzip,
合计约 **29.6 kB gzip 是可以完全不进首屏的**,占当前 148.43 kB 的 20%。

### (c) 两档

**小改进(两晚)**

1. `App.tsx` 里除 `LoginPage` / `AuthCallbackPage` / `DeckListPage` 外全部改 `React.lazy`
   加一个 Suspense fallback(复用现有的 "Loading console…" 样式)。
   首屏三个路由保持静态,免得多一次往返。
2. `CardForm` 里 highlight.js 改动态 `import()`。仓库里已有现成写法可抄:
   `frontend/src/components/CardForm 2.tsx:79-92` 就是懒加载版本(该影子文件不在依赖图里,
   只当参考实现用,见"明确不做的"第 2 条)。
3. react-query 二选一,不许再拖:要么按 C3 真正用起来,要么把 `main.tsx:13` 的 Provider
   与三个死 hooks 摘掉,白省约 13.7 kB gzip。
4. `index.html` 加 `<link rel="preconnect" href="{API origin}" crossorigin>`。
5. `vite.config.ts` 加 `manualChunks`,把 react + react-dom(193.5 kB min / 60.3 kB gzip)
   拆成长期缓存的 vendor chunk,业务代码迭代时不失效它。

**企业级演进**

每个路由 chunk 加 hover / 焦点预取(鼠标悬停行时 `import()`),让分割不带来第二次等待;
构建接 `rollup-plugin-visualizer`,把"首屏 JS gzip"写进 CI 门禁;
静态资源上 CDN + immutable 长缓存 + content hash(Vite 已有 hash),vendor 与业务 chunk 分离。

### (d) 怎么测量

- **测什么**:每个 chunk 的 min / gzip 体积;首屏加载的 JS 传输字节;
  Performance 面板的 "Evaluate Script" 总时长;LCP p75。
- **工具**:`npx vite build` 输出表(基线已有:501.06 kB / 148.43 kB)+ visualizer 看构成;
  DevTools Network 过滤 JS 看首屏传输总量;Lighthouse 移动档跑 10 次取 p75。
- **预算**:首屏 JS gzip ≤ 110 kB;任一 chunk min ≤ 250 kB;
  LCP p75 ≤ 2.5 s(Slow 4G + 4× CPU)。

### (e) 预期量级

估计首屏 min 从 501 kB 降到 330 至 360 kB,gzip 从 148 kB 降到 100 至 110 kB
(highlight.js 15.9 + react-query 13.7,加上其余九个页面的业务代码)。
Slow 4G + 4× CPU 下 LCP 估计改善 150 至 400 ms;
桌面局域网下可能只有 30 至 80 ms,**所以必须用节流档位报数才诚实**。
preconnect 对首个 API 请求估计省 100 至 300 ms(跨源冷连接,估计值)。

---

## C2 · 发布闭环:点击要绕三跳,而轮询会在一次软失败后永久停摆

### (a) 这是什么

你在柜台点了单,厨房其实已经开始做了,但大堂的取餐屏幕要靠服务员定时去后厨问一句"好了没"。
现在有两个问题。一是点单之后服务员要先翻花名册确认你是谁(多一次请求),
再把整块屏幕从头刷一遍(你之前翻过的页全部作废)。
二是这位服务员如果某一次去问,后厨敷衍了一句"接口返回不成功",他就**再也不去问了**,
屏幕从此定格,客人只能自己按刷新。

用户感知到的"发布好慢",很多时候不是后端慢,是前端不再去看结果了。
这条的价值不在毫秒,在于它消除的是一种**无限延迟**。

### (b) 现状

| 事实 | 证据 |
|---|---|
| 只有 `res.success && res.data` 分支里才排下一次轮询 | `DeckListPage.tsx:657`、重排在 `:676` |
| catch 分支以 30 s 重排 | `:678-683` |
| "HTTP 成功但 `res.success=false`"这条软失败路径**既不重排也不提示**,轮询永久停止 | 上两行的空隙 |
| 退避计数器是跨任务累加,不是每任务独立,第 3 个任务一上来就落到 10 s 档 | `:665-672` |
| 轮询在 mount 时**无条件**启动 | `:687-692` |
| 但非 superadmin 根本看不到 Publish Jobs 面板,照样每 30 s 打一次接口 | `:851`、`:984` 的 `superAdmin` 门 |
| 全仓 `visibilitychange` 命中数 **0**,后台标签页照常轮询 | rg |
| 发布链路:confirm → `resolveDeckId`(分页行可能无 id,要多一次 GET)→ `publishDeck` | `:612-643`;`resolveDeckId` 在 `:541-554` |
| 成功后 `await loadPagedFirst(debouncedQ)` 把列表**重置回第一页** | `:634` |
| 用户之前点过的 "Load more"(每页 50 条)全部作废 | `:1212-1221`;`pages/deckListPagination.ts:11` |

### (c) 两档

**小改进(两晚)**

1. 把 `setTimeout` 重排移到 finally 语义的位置,让成功 / 软失败 / 异常三条路径**都**排下一次;
   软失败用 30 s 慢档,并在 UI 上显示"上次刷新失败"。
2. 轮询只在 superAdmin 且当前面板可见,或存在进行中任务时启动。
3. 加 `document.visibilitychange`:隐藏时暂停,可见时立即拉一次。
4. 发布成功后不再整表重置:用 `setPaged` 局部把该行状态改成 publishing
   (`:600-604` 的 `removeDeckBySlug` 已有同类局部更新的先例可仿),
   并立刻把一条乐观的 PENDING 记录插进 `publishJobs`,让"点击到任务可见"变成 **0 次网络往返**。
5. 退避计数器按 jobId 维护,不再全局累加。

**企业级演进**

轮询换成服务端推送(SSE / WebSocket)或 `ETag` / `If-None-Match` 条件请求,
把"每 2 秒一次全量 jobs 列表"变成增量;jobs 列表本身分页,只订阅当前用户可见的任务;
服务端返回 `Retry-After` 由客户端遵守,并加 ±20% jitter 打散重试相位,
避免十万用户在同一秒集体轮询造成自我 DDoS。

### (d) 怎么测量

- **测什么**:`publish 点击 → 任务可见` 的 measure(第 0 条已埋);
  发布后到状态变 SUCCESS 的端到端时间;轮询请求数/分钟;后台标签页的请求数。
- **工具**:DevTools Network 按 `publish/jobs` 过滤,数一分钟内的请求数,
  分别在**前台 / 后台 / 非 superadmin** 三种状态各测 1 分钟;
  停摆用例用 DevTools 的请求 Block 规则模拟一次软失败,观察此后是否还有请求发出。
- **预算**:

| 场景 | 预算 |
|---|---|
| publish 点击 → 任务可见 p75 | ≤ 500 ms(乐观插入后应接近 0) |
| 发布进行中的轮询间隔 | ≥ 2 s |
| 空闲 / 后台标签页 | ≤ 1 次 / 30 s |
| 非 superadmin | 0 次 |
| 任意单次失败后恢复轮询 | ≤ 60 s |

### (e) 预期量级

点击到任务可见:现状包含 confirm、可能的 `resolveDeckId` 往返、`publishDeck`、整表重载,
估计 p75 在 1 至 3 s;乐观插入后估计降到 100 ms 量级(主要是渲染)。
轮询停摆修复带来的不是毫秒,是把"永远看不到结果"这种无限延迟消掉。
非 superadmin 关掉轮询,估计每用户每小时省 120 次无效请求。

---

## C3 · 返回导航零缓存:冰箱插着电,但没人往里放东西

### (a) 这是什么

家里装了冰箱,但每次做饭还是跑一趟超市买同样的鸡蛋。
项目里已经装了一个专门管"请求缓存 / 去重 / 后台刷新"的库,连对应的 hooks 都写好了,
但**没有任何页面在用**;同时代码里另外手写了两套半成品缓存。
结果:你从卡组列表点进某个卡组,再点返回,整个列表又从网络重新拉一次,
用户看到的是熟悉的页面又白屏转圈一次。

### (b) 现状

| 事实 | 证据 |
|---|---|
| react-query 已装、已包在根上、配置齐全(staleTime 5 min / gcTime 10 min / refetchOnWindowFocus) | `main.tsx:13`;`api/queryClient.ts:4-23` |
| 三个 hooks 完整可用但零调用 | `hooks/useDecks.ts`、`useCards.ts`、`useManifest.ts`;rg 命中 0 |
| 白付的体积 | 探针实测约 47.0 kB min / 13.7 kB gzip |
| 手写缓存一:localStorage 五分钟 TTL | `DeckListPage.tsx:35-65`(读 `:44-57`,写 `:59-65`) |
| 只在 legacy 分支的 `loadAll` 里用 | 写入点 `:418`、`:448`;读取点 `:382-383` |
| 手写缓存二:100 ms in-flight 去重 | `api/dedupe.ts:10`、`:18-44` |
| superadmin 走的分页分支**完全没有缓存**,每次挂载 / 搜索 / 发布后都是真实往返 | `DeckListPage.tsx:478-515` |
| 卡片页每次进入都重新 fetch,返回再进入还是重新 fetch | `CardListPage.tsx:37-95` |

100 ms 的去重窗口对**导航级别**的复用毫无帮助,它实际挡的是开发期 StrictMode 的双触发。

### (c) 两档

**小改进(两晚,二选一,并把结果量出来)**

- **方案 A(推荐)**:只把 `DeckListPage` 的分页列表与 `CardListPage` 的卡片列表接到 react-query
  (`useInfiniteQuery` / `useQuery` + `placeholderData: keepPreviousData`),
  删掉这两处的手写 localStorage 缓存,保留 dedupe 作为兜底。
  返回导航命中内存缓存直接渲染,同时后台静默刷新。
- **方案 B**:如果不打算用,就把 Provider 与三个死 hooks 摘掉,先把 13.7 kB gzip 拿回来
  (与 C1 合并执行)。

无论哪个方案,都要先用第 0 条量出"卡组列表 → 卡片页 → 返回"的三段耗时作为基线。
**不许两个都做一半,那正是现在这个状态的根因。**

**企业级演进**

`useInfiniteQuery` 天然承接现有 keyset 游标(`pages/deckListPagination.ts` 的 `nextCursor`
直接当 `pageParam`,这是复用已完成的服务端分页,不是重做它);
staleTime 分层(列表 30 s、manifest 5 min);`prefetchQuery` 在鼠标悬停行时预取该卡组的卡片;
写操作用 optimistic update + rollback 取代"发布后整表重载"(接 C2);
再叠加 HTTP 层 `ETag` / `Cache-Control` 协商缓存,把命中缓存的请求压成 304。

### (d) 怎么测量

- **测什么**:返回导航的可交互时间;同一 URL 在一次会话中的重复请求次数;缓存命中率。
- **工具**:DevTools Network 录"列表 → 卡片页 → 返回 → 再进另一卡片页"这条路径,
  数 `/authoring/decks` 与 `/authoring/cards` 的请求条数(现状预期每次导航都有一条);
  第 0 条埋 `nav:decklist-visible` 的 measure 跑 10 次取 p75;
  react-query DevTools 可直接看命中与失效。
- **预算**:返回导航 0 次新请求(后台刷新不算阻塞);返回后首屏可见 p75 ≤ 150 ms;
  单会话同一 key 的重复请求 ≤ 1 次 / staleTime 窗口。

### (e) 预期量级

返回导航从"一次完整往返"降到接近 0(内存命中,仅渲染)。
参照服务端已测 p50 102.8 ms / p99 152.3 ms,加上跨源 TLS 与渲染,
前端感知估计 200 至 400 ms,这部分基本可以归零。
若选方案 B,则是首屏 gzip 省约 13.7 kB。两个方向都能出前后数字。

---

## C4 · DeckEditPage 串行瀑布:为了显示一个卡片数量,先等 deck 再拉全量 cards

### (a) 这是什么

去柜台办两件事,明明可以同时递两张单子,却偏要等第一张办完才递第二张,白等一个来回。
更浪费的是第二张单子的目的只是问"这盒卡有几张",服务员却把整盒卡搬出来让你自己数。
页面上那个小小的数字,代价是一次额外的往返,加一份完整卡片数据的下载与解析。

### (b) 现状

| 事实 | 证据 |
|---|---|
| 先 `await fetchDeckById(deckId)`,setState、填表单之后才发第二个请求 | `DeckEditPage.tsx:140` → `:176` |
| 第二次请求的**唯一用途**是取一个 `.length` | `:182` `count: (cardsRes.data ?? []).length` |
| 整份卡片数组被传输并逐条 `normalizeCard` 规范化 | `api/authoring.ts:364-380` |
| 第二个请求的参数 `found.id` 就是 URL 里已有的 `deckId`,**不存在真实依赖** | `:176` 对比 `:129` |
| 同仓两个对照页面已经用 `Promise.all` 并行,说明这是局部遗漏不是全局风格 | `CardListPage.tsx:44-47`;`DeckPreviewPage.tsx:153` |
| `Deck` 类型本身就带 `totalCards`,列表页正是直接用它显示卡片数 | `DeckListPage.tsx:719` |
| 全仓 `pages/` 里 `AbortController` 命中数 0,只有一个 `cancelled` 布尔位,请求本身还在跑 | `DeckEditPage.tsx:126`、`:141` |

### (c) 两档

**小改进(一晚)**

1. 直接用 `deck.totalCards` 显示计数,删掉第二次请求(最省)。
2. 若担心 `totalCards` 有漂移,退一步把两个请求改成 `Promise.all`,至少省掉一个 RTT。
3. 两条请求都加 `AbortController`,在 effect cleanup 里 abort。

**企业级演进**

任何"只要计数"的地方都不应下发行数据。后端提供 count 字段或轻量聚合端点
(服务端已有 6-CTE 单语句的先例,计数可以并进同一条 deck 查询);
前端统一约定"列表页只取摘要字段,详情页才取全量",
并在 API 层用 TypeScript 类型把摘要与全量分成两个类型,防止再有人顺手拉全量。

### (d) 怎么测量

- **测什么**:进入编辑页到表单可交互的时间;这条路径上的请求数与响应字节数。
- **工具**:DevTools Network 看 `/authoring/cards?deckId=` 的 Size 与 Time,
  **把 Waterfall 的串行台阶截图作为前后对比证据**(这张图最直观);
  第 0 条埋 `deckedit:open→ready` 跑 10 次取 p75。
- **预算**:编辑页打开的请求数 ≤ 1(或并行 2);
  `deckedit:open→ready` p75 ≤ 400 ms(Slow 4G);单页下载字节 ≤ 50 kB。

### (e) 预期量级

删掉第二次请求可省 1 个 RTT(服务端 p50 102.8 ms,加跨源开销前端感知估计 120 至 200 ms),
外加一份全量卡片 JSON 的传输与解析:200 卡约 100 至 300 kB 未压缩,
解析加 normalize 估计 5 至 15 ms。若只改并行,则省下那一个 RTT。
规模到万级卡时,这条从"浪费"变成"打不开"。

---

## C5 · 输入响应(INP):每敲一个字整页重画,折叠面板里藏着一次全量序列化

### (a) 这是什么

想象你在一块巨大的白板上写字,但这块白板的设计是:你每写一个字母,整块白板就被擦掉重画一遍,
包括角落里那张没人看的大表格。搜索框现在就是这样。
另外页面上五处报错用的是浏览器原生弹窗,它会**硬阻塞主线程**直到用户点掉,
这段时间既不可测也不可中断。

### (b) 现状

| 事实 | 证据 |
|---|---|
| 搜索框是受控输入,每次按键都 setState | `DeckListPage.tsx:1044-1049` |
| 300 ms 防抖只防网络请求,不防渲染 | `:563-566` |
| `viewRows` 的 useMemo 依赖数组里带着 `q` | `:781` |
| 但在 paginated 模式下 `q` 根本不参与过滤(服务端已按 q 过滤) | `:706-731`、`:707-709` 的注释 |
| 即每次按键把已加载的全部行重新 map + filter 一遍 | `:710-731` |
| 表格行是内联 JSX,没有行级 `React.memo`,每行含 4 至 6 个按钮全部重建 | `:1104-1192` |
| 折叠面板里 `JSON.stringify(manifestState.raw, null, 2)` 在 `<details>` 内,React 不管 open 与否都会执行 | `:1235`(块 `:1229-1238`) |
| 该路径在 superAdmin 且分页端点回退到 legacy 时生效 | `:490-498` → `loadAll` → `:448` 填 raw |
| 五处 `alert()` 硬阻塞主线程 | `DeckListPage.tsx` 5 处、`CardListPage.tsx` 2 处 |
| localStorage 的 `JSON.stringify` + `setItem` 是同步写,读取端 `JSON.parse` 同样同步 | `:59-65`、`:44-57` |

### (c) 两档

**小改进(两晚)**

1. 表格行抽成 `const DeckRow = React.memo(...)`,props 传原始字段而非新建对象。
2. `viewRows` 的 useMemo 在 paginated 分支去掉对 `q` 的依赖,或直接按 `listMode` 拆成两个 memo。
3. `<details>` 里的序列化改成只在 open 时计算(受控 open 状态 + 条件渲染),或裁剪成前 N 行预览。
4. 用页面内的错误条替换 7 处 `alert()`。**不引任何新库**:
   `DeckListPage.tsx:928-938` 已有现成的红色 banner 样式可复用。
5. localStorage 写入加体积上限,超过阈值就跳过缓存,避免大 payload 同步写。

**企业级演进**

搜索框改成非受控 + `useDeferredValue` / `startTransition`,
把"输入响应"和"列表重算"分成两个优先级;列表行虚拟化(接 C6);
manifest 调试面板整体挪到独立路由并懒加载,避免它的体积与序列化成本混进主页面;
localStorage 缓存迁到 IndexedDB 或 Cache Storage 走异步写,主线程只留一次 postMessage。

### (d) 怎么测量

- **测什么**:INP p75;单次按键的 long task 时长;React commit 时长;`JSON.stringify` 单次耗时。
- **工具**:DevTools Performance 录一段"在搜索框连打 10 个字符",
  看 Main 轨道每次 keypress 的任务时长;React DevTools Profiler 看每次 commit 的 duration
  与重渲染组件数;第 0 条的 INP observer 直接给 p75;序列化单独用 `performance.now()` 包一层量。
- **预算**:INP p75 < 200 ms;单次按键主线程任务 < 50 ms;任何同步 JSON 操作 < 16 ms。

### (e) 预期量级

估计 200 卡组规模下,按键渲染时间从 10 至 30 ms 降到 3 至 8 ms。
回退到 legacy 且 manifest 较大时,去掉折叠面板的序列化估计单次省 5 至 40 ms
(取决于 manifest 体积,需实测)。
替换 `alert()` 的收益是把"用户点掉之前一切冻结"从不可测变成 0。
规模放大到万级卡组时,这几项是 INP 从 <200 ms 掉到 >500 ms 的主因,
属于"现在便宜、以后昂贵"的修法。

---

## C6 · 列表与导入的渲染账单:Intl 构造器、全量行、算两遍的表、每卡一次 setState

### (a) 这是什么

把一本 500 页的书全部影印出来铺在桌上,只为了让你看最上面那几行。
卡片页现在一次把整个卡组的卡片全部取回并全部画成表格行,用户屏幕上其实只看得到十几行。
更细的一笔账是每一行都要把两个时间戳格式化成本地时间字符串,
这个操作看着无害,实际上每次调用都在新建一个格式化器,行数一多就是明显的卡顿源。

导入页那边是另一种浪费:同一张表在一次渲染里被拼接并排序了**两遍**;
批量导入时每写完一张卡就整页重画一次,像柜台每登记一本书就把整个大堂重新布置一遍。

### (b) 现状

| 事实 | 证据 |
|---|---|
| 卡片页一次性取回整个卡组,端点无 limit / cursor 参数 | `CardListPage.tsx:44-47`;`api/authoring.ts:364-380` |
| 直接全量 `cards.map` 渲染,无分页、无虚拟化、无行级 memo | `CardListPage.tsx:234-276` |
| 每行两次 `new Date(...).toLocaleString()`,每次都新建一个格式化器;200 卡 = 400 次 | `:245`、`:246` |
| `RarityDistribution` 对同一数组做 3 次 filter,useMemo 依赖是数组引用 | `components/RarityDistribution.tsx:12-35`(filter 在 `:15-17`) |
| 导入预览表同一次渲染里 `toRows(preview.plan)` 被调用**两次**,无 useMemo | `DeckImportPage.tsx:448`、`:455` |
| 导入是明确设计过的串行写入,理由写在文件头(不并行 / 失败不中断 / 清空字段送空串) | `lib/deckImportRunner.ts:11-22`、循环 `:155-192` |
| 每完成一张调用 onProgress | `:191` |
| 回调直接 `setProgress`,即每写完一张卡就触发一次页面级 setState,整个 615 行组件重渲染 | `DeckImportPage.tsx:241`;进度条只占 `:520-532` |
| onProgress 明明带了 `current: ImportAction`,前端丢弃了;UI 无速率、无剩余时间、无取消 | `deckImportRunner.ts:191`;`DeckImportPage.tsx:241` |
| `useIntersectionObserver` 已存在但目前无人使用 | `hooks/useIntersectionObserver.ts:51`;rg 页面命中 0 |

### (c) 两档

**小改进(两晚)**

1. 模块作用域建一个共享的 `const DT = new Intl.DateTimeFormat(undefined, {...})`,
   行内改用 `DT.format(ts)`,一次性消掉 N×2 次格式化器构造。
2. 行组件抽出并 `React.memo`。
3. `DeckImportPage` 的 `toRows` 用 useMemo 包一次,只算一遍。
4. 卡片表先加一个纯客户端的"每页 100 行"或"先渲染前 100 行 + 展开更多",
   **不引任何虚拟化库**就能验证收益。
5. 导入进度回调节流:每 100 ms 或每 N 张才 setState 一次(用 ref 累加 + rAF flush),
   把重渲染次数从 N 次降到常数;进度相关 UI 抽成独立小组件。
6. 用已有的 `current` 字段显示"正在写 stableUid=xxx",并用最近 10 张的移动平均算吞吐与剩余时间。

**企业级演进**

cards 端点补上与 admin decks 同款的 keyset 分页(前端已有 `pages/deckListPagination.ts`
这套纯函数与去重逻辑可复用,属于把已完成的分页设计扩展到第二个端点);
列表用 `IntersectionObserver` 触发下一页,配合窗口虚拟化只渲染可视行 + overscan;
搜索与排序全部下推服务端。
导入侧在**保住完整失败清单**这个不可让步的约束下,把串行换成有界并发窗口(k = 4 至 6),
对 429 / 5xx 做带 jitter 的退避。

### (d) 怎么测量

- **测什么**:卡片页 open → ready;渲染 N 行的 commit 时长;每行渲染成本;
  导入期间的 commit 次数;单卡写入 p50/p95;预览分段(fetch / parse / plan)。
- **工具**:React DevTools Profiler 记录一次挂载的 commit duration,
  按 100 / 200 / 500 / 1000 行做一组曲线(本地 mock 数据放大规模),
  **画出"行数 vs 首屏渲染毫秒"的斜率图**,这张图最能说明问题;
  Intl 部分用 `performance.mark` 包住 map 阶段单独量;
  写入段在每次 onProgress 里记时间戳,跑完 `console.table` 打直方图。
- **预算**:

| 指标 | 预算 |
|---|---|
| 卡片页 open → ready p75(Slow 4G,200 卡) | ≤ 800 ms |
| 单次 commit | ≤ 50 ms |
| 每行渲染成本 | ≤ 0.15 ms |
| 导入预览 p75(200 卡) | ≤ 1.5 s |
| 导入期间 commit | ≤ 1 次 / 100 ms |
| 单卡写入 p95 | ≤ 300 ms |

**并发窗口方案上线前必须先有串行基线的 p50/p95**,否则并发只会把延迟换成 429。

### (e) 预期量级

200 卡规模下,共享 Intl 格式化器估计省 5 至 20 ms/次渲染;
行级 memo 让删除单卡后的重渲染从 O(N) 降到 O(1);
`toRows` 去重复调用估计省一次 O(N log N) 排序;
进度节流让 200 卡导入的 commit 从 200 次降到约 20 次,估计省 100 至 600 ms 主线程时间。
**真正的收益出现在斜率上**:现状每增加 1000 行大约线性增加数十毫秒(需实测确认斜率),
分页 / 虚拟化把它压成常数。
诚实说明:200 卡时用户几乎感觉不到,所以这条的价值是"先量出斜率、再决定何时上虚拟化"。
有界并发 k=4:若单卡写入 p50 约 120 ms,200 卡串行约 24 s,理论上降到 6 至 8 s
(估计,且必须先确认后端限流与 Lambda 并发上限)。

---

# 移动端 App(mobile/)

## M1 · 投影写合并:事实同步落盘不变,可重建的那一半延迟并合并

### (a) 这是什么

交易所的成交记录必须一笔一笔写进账本,丢一笔就是事故;
但"我现在持仓多少"那张小抄,是可以从账本重算出来的。
现在这个 App 每打一次分,既写账本,又把整本小抄从头重抄一遍,而且必须抄完你才能看下一张卡。
账本必须同步写(**这条绝不动**),小抄可以晚一点写、可以几次合并成一次,
因为哪怕这时候断电,小抄也能从账本重建出来。

这条和已完成的"队列写通缓存"是**同一个病的不同器官**:那次修的是账本的读放大,
这次修的是小抄的写放大。两者不重叠。

### (b) 现状

| 事实 | 证据 |
|---|---|
| 评分路径:先 `recordReviewEvent`(事实),再 `await saveDeckProgress`(投影) | `SessionCardScreen.tsx:401` → `:421` |
| 写序的理由已写在注释里,是刻意设计,不许动 | `SessionCardScreen.tsx:396-399` |
| `saveDeckProgress` 每次把整个 progress 数组 filter 一遍再全量 `JSON.stringify` 写 | `review/storage.ts:565-570` |
| 紧接着还调 `upsertDeckMeta`,这是**第二次** `setItem`,只为写一个时间戳 | `storage.ts:571` → `:402-409` |
| 而 `loadDeckProgress` 已经写过一次同样的 meta | `storage.ts:561` |
| 所以一次打分 = 3 次 setItem(queue + progress + meta),其中 2 次写的是可重建的投影 | 上述三处 |
| `CardProgress` 8 个字段 | `review/model.ts:4-27` |
| 崩溃恢复需要的纯函数**已经存在且已被测**:幂等与交换律 | `review/model.ts:213-219`;`tests/unit/scheduler.properties.test.ts:215-249` |
| 但 `foldProgress` 在 `mobile/src/` 里**零调用点**,只有定义 | rg 全目录 |

序列化量估计:每条 CardProgress 约 180 B,200 卡约 36 KB/次,万级卡约 1.8 MB/次。
关键是它是 **O(N)**:打一次分的代价随牌组大小线性增长。

### (c) 两档

**小改进(两晚)**

1. 打分路径直接删掉 `upsertDeckMeta` 那次 setItem。`loadDeckProgress` 已经写过,
   零语义变化零风险。
2. `saveDeckProgress` 改成 write-behind coalescer:内存里存 `dirtyProgress[slug]`
   (就是 `nextState.updatedProgress`,本来就是新数组),trailing timer 400 ms 合并;
   打分路径**不 await 它**,只 await 已有的 `recordReviewEvent`。
3. **强制 flush 点(这是取舍的核心)**:
   AppState 转 background、屏幕 blur / unmount、
   会话结束导航前(`SessionCardScreen.tsx:449-451` 的 `navigation.replace('Settlement')` 之前)、
   `scheduleProgressSync` 触发前。
4. 崩溃恢复:`loadDeckProgress` 之后,把本地队列里尚未被 ack 的事件用 `foldProgress` 重放到投影上。
   这个函数已经写好、测好,只差接线。

取舍说白了:合并窗口内崩溃,投影最多旧 400 ms,**事实一条不丢**,下次启动 replay 补回来;
代价是启动多一次 O(未 ack 事件数) 的 fold。
窗口设 0 就是今天的行为,设 ∞ 就是每次启动全量 replay,
400 ms 是把"一次 tap 内不重复写"和"启动 replay 不太长"两头都压住的点。

**企业级演进**

1. 全量数组写换成脏卡增量写:progress 从一个大 key 拆成按 stableUid hash 的分片 key,
   让一次打分的写入量从 O(牌组) 变成 O(1)。
   (AsyncStorage 在 Android 底层本来就是 SQLite,这是换存储布局,不是换框架。)
2. 投影正式降格为可丢弃缓存:加 `projectionVersion`,schema 变更时直接丢弃并从事件重建,
   这样"白名单漏字段就静默丢数据"的风险从"必须小心"变成"重建一次就好"。
3. 合并窗口自适应:连续快打时拉长,间隔久了立即 flush。

### (d) 怎么测量

- **测什么**:评分 → 下一张卡可交互 p50/p95(第 0 条的表);
  每会话 `saveDeckProgress` 的实际落盘次数(= 合并率);启动时 replay 的事件条数。
- **工具**:同一台机器、同一副牌组,前后各 100 次打分对比;两个计数器直接 `__DEV__` 打印。
- **预算**:p95 < 100 ms;20 张卡的会话里合并率 ≥ 3:1;启动 replay 条数 p95 < 50。
- **必须补一条崩溃一致性测试,不写这条测试就不该合**:
  模拟"队列写成功、投影 timer 未触发"后强杀,
  重新 load 出来的投影必须严格等于 `foldProgress(loaded, unackedEvents)`。

### (e) 预期量级

打分点击路径上少 2 次 AsyncStorage setItem 加 1 次全量 stringify。
估计:200 卡时省 3 至 8 ms/次;10k 卡时省 30 至 80 ms/次,且消灭掉一条 O(N) 曲线。
全部是估计,真数字必须靠第 0 条量出来。
这条的说服力恰恰在于它能给出前后两组数字,以及一条崩溃一致性测试。

---

## M2 · resolveDeckBySlug 无内存缓存:每次回首页,每副牌全量读盘 + 解析 + 逐卡重建,而且做两遍

### (a) 这是什么

想知道书架上有几本书,每次都把整个书架搬到桌上重新码一遍,而不是看一眼贴在侧面的清单。
每次切回首页,App 就把每副牌的整个 JSON 从磁盘读出来、解析一遍、
再把每张卡重新造一个新对象,而且同一副牌在同一轮刷新里做了**两遍**。

### (b) 现状

| 事实 | 证据 |
|---|---|
| `resolveDeckBySlug` 全程无缓存 | `content/deckRepository.ts:527` |
| 进函数先付 4 次异步:getDeckMeta / loadManifestCached / 会员判定 / getInfoAsync | `:531-568` |
| 然后 `readAsStringAsync` + `JSON.parse` | `:571-572` |
| 再对**每张卡** `.map()` 造新对象 | `:577` 走 `mapRawDeckV1ToDeckExport`;`:580+` 走 flat 版本 |
| 全仓十余处调用点 | rg `resolveDeckBySlug` 共 26 行命中 |
| 最贵的是 Home 循环里逐副牌调 | `features/gacha/home/deckActionResolver.ts:147` |
| 同一轮循环里 `applyCachedRemoteProgress` 内部**又调一次** | `:181` → `sync/progressSync.ts:1770` |
| 那里还调一次 `loadDeckProgress` | `progressSync.ts:1783` |
| 回到 Home 循环再调一次 `loadDeckProgress` | `deckActionResolver.ts:186` |
| 触发频率:每次回到首页都跑 | `screens/HomeScreen.tsx:282` 的 `useFocusEffect` |
| Library 同理 | `screens/LibraryScreen.tsx:97` |

即每副牌每次 Home focus:2 ×(读文件 + 解析 + 逐卡 map) + 2 ×(读 progress + reconcile)。

### (c) 两档

**小改进(两晚)**

加一层 `Map<cacheKey, DeckContent>`,`cacheKey = ${userKey}:${slug}:${meta.buildId}`
(`buildId` 已经在 meta 里,`deckRepository.ts:533` 就读得到),安装 / 更新 / purge 时按 slug 失效;
并发用 single-flight,仓里已有现成模式可抄(`deckRepository.ts:53` 的 `_installInFlight`)。
同时把 Home 循环里那次重复的 `resolveDeckBySlug` / `loadDeckProgress` 改成**参数传进去**,
而不是各自重新解析。

**企业级演进**

万级卡时把整副牌缓存进内存本身就成了内存问题(10k 卡 × 约 600 B ≈ 6 MB/副 × N 副)。
运行时也必须分块:`content/chunkedInstall.ts:20` 已经把内容**下载**成 chunk
(并发 3,`:290-303` 分批下载 + 断点续传),但最后把所有 chunk 合并成**一个** flat `deck.json` 落盘,
运行时又退回单文件全量解析。
做法:安装时额外产出一个索引(stableUid → chunkSeq / orderInDeck / revision / rarity),
Home / Library / 调度器只吃索引(几百 KB 级),卡片正文按 chunk 懒加载 + LRU;
`resolveDeckBySlug` 的返回类型拆成 `DeckIndex` 与 `getCard(uid)`。

### (d) 怎么测量

- **测什么**:`{slug, cards, readMs, parseMs, mapMs}`;每次 Home focus 的 `resolveDeckBySlug` 调用次数。
- **工具**:在 `resolveDeckBySlug` 内用第 0 条的 mark 打点;调用次数用一个模块级计数器。
  用 200 卡和一个人造 10k 卡 deck 各测一次,**把耗时对卡数的曲线画出来**,
  这是"O(N) 是不是真的"的证据,也是最能说明问题的一张图。
- **预算**:Home focus 的 deck 解码总耗时 p95 < 50 ms;
  每副牌每次 focus 的 `resolveDeckBySlug` 调用次数 = 1(现在是 2)。

### (e) 预期量级

估计 200 卡 × 5 副牌,单副解码 5 至 15 ms(Hermes 解析 + 逐卡 map),
Home focus 现在光解码就花 50 至 150 ms。
加缓存后第二次起接近 0,冷启动第一次仍要付(那部分归 M3)。
顺手消掉 Home 循环里那次重复解析,这一半是白捡的。

---

## M3 · 冷启动:72 个屏幕全静态 import

### (a) 这是什么

开餐厅,每天开门前把菜单上全部 72 道菜的食材都从冷库搬到操作台,哪怕今天只卖早餐。
App 启动时会把所有页面的代码都求值一遍,才轮到显示第一屏。

### (b) 现状

| 事实 | 证据 |
|---|---|
| `App.tsx` 共 88 条 import,其中 **72 条**是 `XxxScreen` | `mobile/App.tsx`,grep 精确计数 |
| `React.lazy` / `Suspense` 在 `App.tsx` 命中数 **0**,全部静态 | rg |
| 被拖进首屏求值路径的重模块 | `screens/DrawCeremonyScreen.tsx` 1418 行;`components/CeremonyLottie.tsx` 1132 行;`sync/progressSync.ts` 1827 行;`content/deckRepository.ts` 1626 行 |
| 启动还串着一次远程版本检查,`checking` 时整屏只显示 spinner | `App.tsx:202` |

### (c) 两档

**小改进(两晚,顺序不能反)**

1. 先用第 0 条的 TTI mark 拿 baseline。**至少 20 次冷启动取 p50 与 p95**,
   冷启动方差大,单次数字没有意义。
2. 开 Metro 的 inline requires(`babel.config.js` 里的 `transform-inline-requires`,
   这是 build 配置,不是框架变更),它把模块求值推迟到第一次真正用到;测前后 TTI。
3. 若还不够,把最冷的一批(Settings / Milestone / Error / Debug / Plan 类,约 40 个屏)
   改成 `React.lazy` + 一个共享 Suspense fallback。

**企业级演进**

路由级分包 + 首屏最小闭包(只留 Splash / Home / SessionCard 三个屏是同步的);
确认 Hermes bytecode 预编译已开(Expo 54 默认开,**要验不要假设**);
启动阶段用第 0 条打点分解成 bundle 求值 / navigation ready / Home 首次数据 三段,
就像服务端那个 9.2 s 冷启动被拆成 init 303 ms + 首次建库连接 4294 ms 一样,
**先知道钱花在哪一段,再决定动哪一段**。

### (d) 怎么测量

- **测什么**:`mobile/index.ts` 顶端 t0 → HomeScreen 首次 `useFocusEffect` 回调结束;
  模块求值顺序(require 计数或 Metro bundle 分析),确认哪些重模块确实在首屏路径上。
- **预算**:TTI p50 < 2.0 s,p95 < 3.5 s;
  inline requires 开关前后各 20 次冷启动,对比 p50 和 p95 两个数。

### (e) 预期量级

估计 inline requires 在这种"多屏 + 重样式模块"的 app 上通常省 10% 至 25% 的 JS 求值时间。
**这条的置信度明显低于 M1 / M2**:它高度依赖 Metro 打包细节与机型,
必须以实测为准,**测出来没用就诚实撤回**。

---

## M4 · 抽卡仪式:33 ms 定时器驱动 setState 的逐帧动画

### (a) 这是什么

动画像放电影,两种放法:把胶片交给放映机(原生线程)自己转,或者你自己每秒手动翻 30 次画片。
这个仪式页现在是后者:一个 33 ms 的定时器每秒 30 次去改 React 状态,
每改一次这个 1418 行的组件就整个重渲染。
只要这时候 JS 线程被别的事情占住(比如打分正在写盘),画面就卡。

### (b) 现状

| 事实 | 证据 |
|---|---|
| `setInterval(..., 33)` 每 tick 调**两个** setState | `screens/DrawCeremonyScreen.tsx:804-813`(`:807`、`:808`) |
| 组件有 11 个 `useState`,高频变的几个任何一个变都触发全组件 re-render | 同文件,grep 计数 11 |
| 7 个阶段由 9 处 `setTimeout` 串成,是**时间戳驱动不是动画驱动**,JS 线程一堵就错位 | 同文件,grep 计数 9 |
| 好消息:28 处 `useNativeDriver: true`,只有 1 处 false | `:606`,注释写"opacity not native-drivable in older RN" |
| 而 `package.json` 写的是 react-native 0.81.5,现在其实可以 | `mobile/package.json:43` |
| Skia 已在依赖里且已被使用,数学全在 UI 线程跑 | `mobile/package.json:26`;`components/HolographicLayer.tsx:18` |

### (c) 两档

**小改进(两晚,顺序很重要:先量再改)**

1. 用第 0 条的 `useFrameSampler` 在仪式期间采 JS 帧间隔,拿到 baseline 掉帧率。
2. `orbitSamples` 这个纯计数的 state 先确认不影响渲染输出,然后改成 `useRef`,
   setState 立刻少一半。
3. orbit 从 `setInterval` + setState 换成一个 `Animated.Value` + `Animated.timing(useNativeDriver: true)`,
   React 完全退出逐帧。
4. `:606` 那处 `useNativeDriver: false` 在 RN 0.81 上改成 true,
   改完对着帧率表看差值。**这就是一条能出前后数字的最小实验。**
5. 11 个 useState 收成 `useReducer`:一次 dispatch = 一次 re-render,
   而不是同一 tick 里多次;orbit / particles 子树 `React.memo` 掉。

**企业级演进**

逐帧场景整体搬到 UI 线程。仓里已有先例和依赖(Skia 2.2.12,
`HolographicLayer.tsx:18` 的注释明写数学全在 UI 线程跑),
所以是**复用已有依赖,不是引新框架**。
同时把 7 阶段的 `setTimeout` 链换成 `Animated.sequence`,让阶段由动画完成回调驱动:
JS 卡顿时整体变慢但**不会错位**。时间戳驱动会错位,这是两种设计的本质差别。

### (d) 怎么测量

- **测什么**:rAF delta 采样(JS 长帧占比);仪式期间该组件的 render 次数。
- **工具**:`useFrameSampler` + RN Perf Monitor 的 UI/JS 双 FPS 交叉验证;
  `console.count` 统计 render 次数。**必须在低端安卓上跑**,掉帧只在那里出现。
- **预算**:仪式期间 JS 长帧(>33 ms)占比 < 2%;
  组件 render 次数从约 90 次(3 s × 30)降到 < 15 次。

### (e) 预期量级

render 次数降一个数量级,这个几乎确定。
掉帧改善多少完全取决于 baseline:
**如果 baseline 本来就接近 0 掉帧,这条的正确结论就是不做**。
这正是为什么它排在测量后面而不是前面。

---

## M5 · Library 列表:今天 200 卡看不出差别,这条是未来投资

### (a) 这是什么

图书馆的展示柜:现在的做法是给每一本书都做一个实体展位,哪怕你只看得见 8 本。
200 本还行,1 万本就要先摆一万个展位。
另外现在每换一次筛选条件,整个柜子会被拆掉重搭一次,滚动位置和已渲染的格子全部作废。

### (b) 现状

| 事实 | 证据 |
|---|---|
| FlatList 只给了 data / key / numColumns / keyExtractor / renderItem,**没有任何**性能属性 | `screens/LibraryScreen.tsx:249-340`;grep `getItemLayout` / `initialNumToRender` / `maxToRenderPerBatch` / `windowSize` / `removeClippedSubviews` 命中数 0 |
| `key` 里带了 filter,等于切一次筛选整个 FlatList 卸载重建 | `:252` |
| `renderItem` 是内联箭头函数 | `:331-339` |
| `LibraryCardTile` 没有 `React.memo`,父组件一变全部 tile 重渲染 | `features/gacha/library/LibraryCardTile.tsx:28` |
| 有意思的是行高其实是已知固定值,已硬编码在失败兜底里 | `LibraryScreen.tsx:262` `ROW_HEIGHT_GUESS = 132` |
| VM 层对 rows 做 6 次独立 filter 算计数,再加一次 filter 出卡片,共 7 次全量遍历 | `features/gacha/library/libraryMapper.ts:146-154`、`:172-180` |
| progress 每次打分都换新数组,所以 VM 全量重算 | 依赖是数组引用 |

### (c) 两档

**小改进(两晚)**

补齐 `getItemLayout`(行高用现成的 132 加间距,**先在 RN 里量准,别照抄这个 guess**)、
`initialNumToRender={12}`、`maxToRenderPerBatch={8}`、`windowSize={5}`、
`removeClippedSubviews`(Android);
`LibraryCardTile` 包 `React.memo`;`renderItem` 提成 `useCallback`;
筛选改成只换 `data` 不换 `key`(保留 cell 复用),只在 `numColumns` 变化时才换 key;
VM 那 7 次遍历合并成 1 次 reduce。

**企业级演进**

万级卡时把 VM 计算搬出渲染路径:按 status / rarity 预建倒排索引,
counts 变成 O(1) 读、筛选变成 O(结果集),progress 变更只增量更新受影响那一张卡所在的桶;
列表数据源改成"索引 + 按需取正文",直接接 M2 的 chunk 索引。
必要时把 FlatList 换成同 API 的 FlashList。
注意这是换一个列表组件,不是换框架,**而且必须先有前后帧率数字才做**。

### (d) 怎么测量

造 200 / 2000 / 10000 张卡三档假 deck,量三件事:
进入 Library 到列表出现的时间;快速滚动时 JS 帧间隔 p95(第 0 条的采样器);
`buildLibraryVM` 单次耗时。
**预算**:10k 卡时首帧 < 500 ms;滚动长帧占比 < 5%;`buildLibraryVM` p95 < 30 ms。
三档一起测才能画出"到几千张开始崩"的拐点。

### (e) 预期量级

诚实说:200 卡的今天几乎看不出差别,**这条是未来投资,不是当下收益**。
估计 2000 卡以上时 `getItemLayout` + `React.memo` 是滚动掉帧"从明显到基本消失"的分界;
10k 卡时不加虚拟化参数,首帧会是秒级。
价值在于那张"卡数 vs 帧率"的曲线,它告诉你还有多少余量。

---

## M6 · 同步上行载荷:先称重,预期结论是"不裁"

### (a) 这是什么

寄快递前先称重。现在每次同步把 25 条评分记录打成一包上行,每条里塞了整个卡片进度对象。
到底多重?没人量过。
称完很可能发现只有十几 KB,那正确答案就是**不动它**,把工程时间花在别处。
一个有数字支撑的"不做",和一个有数字支撑的"做"同样值钱。

### (b) 现状

| 事实 | 证据 |
|---|---|
| 批大小写死 25 | `sync/progressSync.ts:1483` |
| 一轮最多 20 批,即 500 条,剩下等下一轮 | `:1488` |
| 每条事件 19 个字段 | `:1499-1529` |
| 冗余一:`eventType` 与 `type: 'review'` 重复 | `:1502`、`:1503` |
| 冗余二:`reviewedAtMs` 与 `eventTimeMs` 同值 | `:1516`、`:1517` |
| 冗余三:`progressAfter`(整个 CardProgress,8 字段)与从它算出的 `nextReviewAtMs` 同时上行 | `:1520`、`:1527` |
| 冗余四:`cardRevision` 与 `lastSeenRevision` 高度相关 | `:1509`、`:1528` |

注意:这条与已完成的 "delta patch 327 B" **不重叠**。那条优化的是**下行**(服务端到客户端的补丁),
这条问的是**上行**(客户端到服务端的事件批),方向相反,证据也不同。

### (c) 两档

**小改进(一行代码的实验,一晚)**

在 `apiJson` 调用前打点 `JSON.stringify(body).length`,跑一个真实会话,
拿到「每批字节数 / 每条平均字节数 / 一轮同步的上行总量」。然后**按数据决定**:

| 实测结果 | 行动 |
|---|---|
| 每批 < 20 KB | 把"测过,不值得裁"写进文档,收工 |
| 每批 > 100 KB(例如离线一周攒了 3000 条要分 120 批) | 删掉那三处重复字段;保留 `nextReviewAtMs`,去掉 `progressAfter`(服务端能从事件重算投影,和 M1 的事实/投影分层是同一个道理,只是发生在网络这一层) |

**企业级演进**

`BATCH` 从写死的 25 改成**按字节预算自适应**(目标例如 64 KB/请求)。
理由:单条事件的大小会随 schema 演进变大,写死条数等于把请求体大小交给未来的自己去踩。
再加请求压缩;离线积压很大时改成优先级推送,先补最近 N 天,旧的后台慢慢补,
避免重连瞬间打出上百个串行请求把首屏堵死。

### (d) 怎么测量

客户端打点上行字节数,和服务端已有的摄入 p50/p99(102.8 / 152.3 ms)做交叉;
再把一轮同步的墙钟时间分解成 网络 / 序列化 / 存储 三段。
**预算**:单请求 body < 64 KB;推 25 条的一轮同步 p95 < 1.5 s。
测量成本低到没有理由不测。

### (e) 预期量级

估算 25 条 × 约 450 B ≈ 11 KB/批,所以**预期结论就是不改**。
这条真正的产出有两个:一份有数字支撑的 "no",
以及自适应 BATCH 这个防未来的改动。
它防的是 schema 变大之后某天突然开始超时,而那时候没人记得 25 这个常数是哪来的。

---

# 明确不做的(看过、有理由、写下来)

## 通用

1. **不换框架、不重写。** `DeckListPage.tsx` 1242 行、职责混杂(数据、轮询、过滤、渲染、调试面板),
   确实难读,但"重写成 hooks + 组件拆分"没有任何延迟数字支撑。
   而且仓库里已经有一份别人做到一半的拆分产物(`DeckListPage 2.tsx` + `components/decks/*`,
   引用了不存在的 `hooks/useDeckListData`),正是这类改造的失败样本。
   ⚠️ **2026-08-18 补注**:上面那句写这份文档时是现在时,现在只是历史。
   `frontend/src/components/decks/` 已在 7ae7b29 删除,拆分后来由
   `frontend/src/components/deckList/` 下新写的 5 个组件完成。
   句中的 `hooks/useDeckListData` **故意保持裸路径**:那半句的全部论点就是它从来不存在,
   写成完全限定形式会让 `frontend/tests/docsPaths.test.ts` 去要求创建一个
   "不存在"本身就是论据的文件。
   移动端同理:Expo 54 + RN 0.81.5 + React 19 + Zustand 全部保留。
   本文档全部方案都是在现有结构上做点状改动。

2. **不把"拆大文件"当性能方案卖。** `DrawCeremonyScreen.tsx` 1418 行确实难维护,
   但在拿到帧率 baseline 之前,拆文件是代码整洁不是性能优化。
   混进性能提案会让整份清单不可信。

3. **不重复已做过的项。** 移动端队列写通缓存、服务端摄入计时与冷启动分解、
   事件先落盘写序、6-CTE 单语句、keyset 分页、delta patch、连接复用,一律未再提案。
   C6 的"批量导入端点"只从前端延迟视角补一条约束(批量端点必须返回 per-item 结果,
   否则会丢掉现有的完整失败清单),不重复其设计;
   M6 明确区分了上行与已完成的下行 delta patch。

## 控制台

4. **不删 `X 2.tsx` 影子文件来"减包"。** 实测 `npx vite build` 只 transform 了 182 modules
   且构建成功,而这些文件 import 了不存在的模块(如 `../hooks/useDocumentTitle`),
   证明它们根本没进依赖图,删了对 bundle 一个字节都不省。
   它们是代码整洁问题,不是延迟问题。

5. **不建议现在用 fetch 换 axios。** 实测 axios 36.9 kB min / 14.9 kB gzip,看着诱人,
   但 `api/authoring.ts` 全靠 `axios.isAxiosError` 做错误码归一
   (`:350-358` 的 404/403 特判就是分页端点回退的依据),换掉等于重写整层错误契约。
   收益远小于回归风险,且属于红线里的"重写"。
   等 C1 做完再看首屏预算是否还差这 15 kB。

6. **不建议现在引入虚拟列表库(Web 侧)。** 当前 200 张卡 / 每页 50 个卡组,
   虚拟化的收益在实测斜率出来之前是零假设。
   C6 给的做法是先画"行数 vs 渲染毫秒"的曲线再决定;直接上库属于"没有测量方案的优化"。

7. **不建议把 Markdown 解析搬进 Web Worker。** `parseDeckMarkdown` 在 200 卡下大概率不是瓶颈,
   而导入预览的延迟里还夹着一次全量 `fetchCardsByDeck`(`DeckImportPage.tsx:195`)。
   先按 C6 把 fetch / parse / plan 三段分开量,谁大改谁。

8. **不建议加 Service Worker / 离线缓存。** 这是一个内部作者控制台,
   运维成本(版本更新卡死、缓存投毒排查)远高于收益,
   且 C3 的内存缓存已经能解决绝大部分"返回导航重新请求"的痛点。

9. **不建议动 `dedupe.ts` 的 100 ms 窗口。** 它实际作用是挡住 React StrictMode 的开发期双触发,
   不是导航级缓存。把 TTL 调大属于用错工具解决 C3 的问题,正解是二选一。

## 移动端

10. **不动"事实必须同步落盘"。** `recordReviewEvent` 的 await 保持原样。
    `SessionCardScreen.tsx:396-399` 与 `progressSync.ts:505-521` 的注释已经把取舍写清楚了
    (窗口被刻意设为零,并类比了数据库与交易系统的 fsync 策略),那个判断是对的。
    任何"把队列写也 defer 掉"的提案都是拿丢数据换毫秒。
    M1 恰恰是它的反面:**只动可重建的那一半**。

11. **不给 `mobile/src/mock/` 做任何优化。** 那是设计稿数据,不在运行路径上。

12. **不把"AsyncStorage 换 MMKV"当独立方案。** 换存储引擎的收益会被 M1(少写几次)
    和 M2(少读几次)大部分吃掉。先把读写次数降下来再谈换引擎,
    否则是用一个新依赖的风险,换一个从没量过的收益。顺序反了。

13. **`getActiveUserSub` 的 1500 ms TTL 缓存已核查**(`review/storage.ts:26-60`),
    命中率高,未命中也只是一次 getItem,不值得单开一条。
    同理 `getSyncAccessToken`(`progressSync.ts:679-691`)已有内存 memo,
    打分路径上不会真的去读存储。

14. **不提"减少 Home 的 `useFocusEffect` 触发频率"这种靠节流掩盖问题的做法。**
    `LibraryScreen.tsx:42` 已经有一个 1.5 s 的 `REFRESH_DEBOUNCE_MS` 在做这件事,
    它治的是症状。真正的病在 M2(每次 focus 全量解析两遍)。
    **把每次 focus 变便宜,比减少 focus 次数正确。**

<!-- paths-not-on-disk
     本文档里出现、但磁盘上确实没有的仓库路径，逐条登记在这里。
     一条 = 一行 "- 路径"；其余文字是说明，不会被读成条目。
     规则与核对方式见 frontend 的 tests/docsPaths.test.ts 文件头。
     登记 ≠ 改写历史：上文的句子与时态都保持原样。

     - mobile/src/features/gacha/ceremony/   :60 把它当作【错的】路径引用
       （"DrawCeremonyScreen.tsx 在 mobile/src/screens/ 而非 …"），它本来就不该存在。
     - mobile/src/perf/marks.ts              :111 是一条"新增 …"的提案，从未建成。
     - frontend/src/components/decks/        已在 7ae7b29 删除；:947 那段是失败样本的历史记录。
     - frontend/src/components/deckList/     :951 那条 2026-08-18 补注写的是当时的位置；
       2026-08-18 阶段 D 又把这 5 个组件整体搬进 frontend/src/features/deckList/components/。
       补注本身是历史记录，原样保留。
     - mobile/src/mock/                       :1004 引用的 mock 数据目录已在 R1.7.0 G20 删除；
       正文的句子与时态保持原样。
-->
