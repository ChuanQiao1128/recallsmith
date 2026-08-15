# 支柱二:React 前端

> **卡片是"素材"不是"成品"。**
> 录入 Anki / RecallSmith 时,强烈建议不要照抄下面的 A,而是先盖住答案自己讲一遍,
> 再用自己的话把 A 改写成你会在面试里说出口的版本。**改写本身就是学习**:
> 你能把它压缩成三句自己的话,才说明这个概念真的进了你脑子;照抄只是把它搬进了软件里。
> EN 那一行同理,读出声、改成你自己的语气,面试时能脱口而出的才算数。

> **本文的锚点是你自己的代码**(全部为真实文件,可以打开对照):
> - `mobile/src/screens/DrawCeremonyScreen.tsx`:7 阶段 `CeremonyPhase` 状态机
>   (`'swipe' | 'approach' | 'hold' | 'tear-flip' | 'flash-reveal' | 'settle' | 'cards-on-table'`),
>   `useState<CeremonyPhase>('swipe')`、`timers = useRef<number[]>([])`、`useMemo(phaseDurations)`。
> - `mobile/src/sync/progressSync.ts`:offline-first 事件队列,eventId 幂等,rating 事件 debounce 10s。
> - `mobile/src/features/gacha/home/deckActionResolver.ts`:`DeckAction` 判别联合
>   (`kind: 'open' | 'install' | 'update' | 'trial-start' | 'paywall' | 'none'`)。
> - `mobile/src/review/model.ts`:`CardProgress` 接口(注意:它是可选字段包,不是判别联合,后面模块 7 会拿它做反例)。
> - `frontend/`:React 19 + react-router-dom v7 + @tanstack/react-query v5 + Vite 的管理控制台。

---

## 1. 渲染模型

### 概念讲解

**Mental model 一句话**:组件不是"画在屏幕上的东西",组件是**一个纯函数,输入 state 和 props,输出一份"这一刻界面应该长什么样"的描述**。
React 拿着这份描述,和上一份对比,自己去算 DOM 要怎么改。你负责描述结果,React 负责推导过程。这就是 `UI = f(state)`。

**为什么这样设计。** 想想 jQuery 时代的写法:用户点了一下,你要手写"把这个 class 去掉、把那个节点插进去、把计数器 +1"。
问题不是麻烦,问题是**路径数量爆炸**:N 个状态两两组合会产生 N² 条迁移路径,你必须每条都写对。
声明式把它压回 N:你只描述每个状态对应的样子,迁移路径交给 diff 算法算。
你的 `DrawCeremonyScreen` 是最好的例子:7 个 phase 如果用命令式写,要处理 42 种迁移;
用 `UI = f(phase)` 写,你只写了 7 段"这个 phase 长什么样",迁移由 React 负责。

**re-render 到底什么时候触发。** 只有三个来源,记死:

1. 组件自己的 state 变了(`setState` 且新值和旧值 `Object.is` 不同);
2. **父组件重渲染了**(默认无条件传染给所有子组件);
3. 组件订阅的 context value 变了。

最常见的误解是"props 变了所以子组件重渲染"。**反过来**:是父组件先重渲染,顺手重新调用了子组件,
子组件才拿到新 props。props 完全没变,子组件一样会重渲染(除非用 `React.memo` 拦一道)。
另一个误解是"重渲染 = 操作 DOM"。不是。重渲染 = 重新调用你的函数、生成新的 element 树、做 diff。
**只有 diff 出差异的那部分才会碰真实 DOM**,这就是为什么"重渲染很多次"不一定慢。

**虚拟 DOM 的真实价值。** 它不是"比操作 DOM 快"(多做一层对比只会更慢一点),
它买到的是两件事:(a) 让你能写声明式代码而不必手写迁移;
(b) 把一批更新**攒起来一次性提交**(automatic batching,React 18 起在所有场景生效,包括 setTimeout、Promise、原生事件回调里)。
一个事件处理函数里连着 3 次 `setState`,只会渲染一次、提交一次。

**Reconciliation(协调)的两条核心规则**:

- **同一位置 + 同一 element type = 同一个组件实例,state 保留。**
  `<Modal>` 前后都在同一个位置且都是 `Modal`,内部 state 不会丢。
- **type 变了 = 卸载整棵旧子树、挂载新的,state 全丢。**
  `{isEditing ? <Input/> : <span/>}` 切换时,`Input` 的所有 state 和 DOM 都被销毁。
  更隐蔽的坑:**在组件内部定义组件**。每次渲染 `function Row(){...}` 都是一个新的函数引用,
  type 不同 → React 每次都当作全新组件,子树 state 每次输入一个字符就被清空一次。

**key 的真正作用:身份,不是性能。**
默认情况下 React 用"在兄弟列表中的位置"来配对新旧元素。列表顺序会变、会插入、会删除时,
位置就不再等于身份了。key 是你对 React 说:"别看位置,看这个 id,它才是这一项的身份"。
key 只在**同一个父节点的兄弟之间**有意义,不需要全局唯一。
用 index 当 key 在列表**只追加不重排不删除**时是对的;一旦头部插入,
React 会认为"第 0 项内容变了",于是把新数据塞进旧组件实例里,导致
"输入框里的文字跟着串位""动画播在错的行上""checkbox 勾选跳到隔壁"。
反过来,key 也是一个**主动重置 state 的工具**:给组件换一个 key,就是明说"这是新身份",React 会卸载重建。

**什么时候这套模型会坏。**
渲染函数里做副作用(改外部变量、发请求、写 ref)会坏,因为 React 在 StrictMode 开发模式下会**故意调用两次渲染**来暴露你的不纯;
并发渲染下 React 还可能渲染到一半丢弃重来。渲染必须是纯的,这不是风格建议,是这套模型成立的前提。

### 卡片素材(手动录入用)

- **Q:** 子组件的 props 一个都没变,父组件重渲染了,子组件会不会重渲染?为什么?
  **A:** 会。React 默认不做 props 比较,父组件重渲染就意味着重新调用了子组件函数,生成新的 element 树。
  "props 变导致子渲染"这个因果是反的:是父先渲染,子才拿到新 props。
  想拦住这一层要显式用 `React.memo`,它才会对 props 做浅比较后决定跳过。
  但重渲染不等于改 DOM,diff 之后没差异就不会碰真实 DOM,所以大多数时候不值得去拦。
  **难度:** d1
  **EN:** A child re-renders because its parent re-rendered, not because its props changed.

- **Q:** 为什么说虚拟 DOM 的价值不是"比直接操作 DOM 快"?
  **A:** 因为它多做了一层对比,单次操作只会更慢一点。它换来的是两件别的东西:
  一是让你写声明式代码,不用手写状态之间的迁移路径(N 个状态的两两迁移是 N²,声明式压回 N);
  二是把一批更新攒起来一次提交(batching),避免中间态触发多次布局和重绘。
  说"虚拟 DOM 快"在面试里是减分项,说"它买的是可预测性和批量提交"才对。
  **难度:** d2
  **EN:** The virtual DOM buys predictability and batching, not raw speed.

- **Q:** `{isEditing ? <Input value={v}/> : <Input value={v} readOnly/>}` 和 `{isEditing ? <Input .../> : <span>{v}</span>}`,切换时哪个会丢掉输入框的光标和内部 state?为什么?
  **A:** 第二个会丢。React 按"同一位置 + 同一 element type"配对:第一个前后都是 `Input`,是同一个实例,state 和 DOM 节点保留;
  第二个 type 从 `Input` 变成 `span`,React 卸载整棵旧子树再挂新的,state、DOM、光标全部销毁。
  这条规则也解释了为什么把条件分支写成两个不同标签会让人"莫名其妙丢焦点"。
  **难度:** d1
  **EN:** Same position plus same element type means React keeps the instance; a type change unmounts the subtree.

- **Q:** 在组件函数体内部再定义一个子组件,会发生什么?
  **A:** 每次父组件渲染都会创建一个新的函数引用,React 认为 element type 变了,于是卸载旧子树、挂载新的。
  后果是子组件的 state 每次父渲染都被清空,输入框每敲一个字就丢一次内容,effect 反复卸载重跑。
  修法是把组件定义提到模块顶层,需要传数据就走 props。
  这也是"为什么我的表单一直自己清空"这类 bug 最常见的根因之一。
  **难度:** d1
  **EN:** Defining a component inside another component creates a new type every render, so the subtree remounts.

- **Q:** key 到底解决什么问题?为什么说它不是性能优化?
  **A:** key 解决身份识别。没有 key 时 React 用"在兄弟中的位置"配对新旧元素,而列表重排、插入、删除会让位置不等于身份。
  key 是告诉 React "这一项的身份是这个 id,不要看位置"。
  它带来的性能提升只是副产品,主作用是正确性:身份错配会让 state、动画、focus 落在错的行上。
  key 只需要在同一父节点的兄弟之间唯一,不需要全局唯一。
  **难度:** d1
  **EN:** Keys are about identity across renders, and correctness is the point, not speed.

- **Q:** 什么情况下用数组 index 当 key 是安全的?什么情况下会出错,出的是什么错?
  **A:** 只追加、不重排、不删除、且每项没有内部 state 时是安全的。
  一旦在头部插入一项,index 0 从 A 变成 B,React 会认为"第 0 个组件的内容变了"而复用旧实例,
  于是把新数据塞进旧组件里:输入框内容串行、勾选状态跳到隔壁、动画播在错误的行上。
  判断标准很简单:数据的身份是否和它的位置绑定,不绑定就必须用稳定 id。
  **难度:** d1
  **EN:** Index keys are safe only for append-only lists with no per-item state.

- **Q:** 你想在切换 deck 时把某个详情组件的所有内部 state 清空,最干净的做法是什么?
  **A:** 给它一个随 deck 变化的 key,例如 `<DeckDetail key={slug} .../>`。key 变了就是身份变了,React 卸载旧实例再挂新的,state 自然是初始值。
  比在 `useEffect` 里监听 slug 然后逐个 `setX(初始值)` 好:后者会多渲染一帧旧数据,而且每加一个 state 就要记得多写一行重置。
  这是 key 除了列表之外最重要的用法。
  **难度:** d1
  **EN:** Changing a component's key is the cleanest way to reset all of its internal state.

- **Q:** 一个事件处理函数里连着调 `setA(1); setB(2); setC(3)`,会渲染几次?在 `setTimeout` 里呢?
  **A:** 都是一次。React 18 起 automatic batching 覆盖所有场景,包括 setTimeout、Promise 回调、原生事件监听器,不再只限于 React 合成事件。
  这也是为什么"状态拆得多"通常不构成性能问题:同一批更新只提交一次。
  React 17 及以前只在 React 事件里批处理,所以旧文章里那条"setTimeout 里会渲染三次"的说法已经过期。
  **难度:** d1
  **EN:** Since React 18, updates are batched everywhere, not just inside React event handlers.

- **Q:** 为什么 React 在开发模式(StrictMode)下会故意把你的组件渲染两次?
  **A:** 为了暴露不纯的渲染。React 的模型要求渲染是纯函数:同样的 state 和 props 必须产生同样的输出,且不产生副作用。
  渲染两次可以让"在渲染里改外部变量、push 进数组、写 ref、发请求"这类问题立刻显形(计数翻倍、列表重复)。
  这只在开发模式发生,生产不会。看到双倍效果不要去加锁绕过,要去掉渲染期的副作用。
  **难度:** d1
  **EN:** StrictMode double-renders in dev to surface impure render logic early.

- **Q:** 用你的 DrawCeremony 举例,说明 `UI = f(state)` 相比命令式写法省掉了什么。
  **A:** 省掉了状态之间的迁移路径。7 个 phase 命令式要处理最多 42 条 "从 X 到 Y 该改哪些节点";
  声明式只要写 7 段 "这个 phase 下界面长什么样",迁移由 reconciliation 算。
  我在 `DrawCeremonyScreen.tsx` 里只维护一个 `useState<CeremonyPhase>`,渲染分支和动画参数都是它的纯函数,
  加一个 phase 的成本是线性的,不是平方的。
  **难度:** d1
  **EN:** Declarative rendering turns N-squared transition paths into N state descriptions.

---

## 2. state 与 props

### 概念讲解

**Mental model 一句话**:props 是"上面传下来的、只读的参数";state 是"这个组件自己记住的、会随时间变的东西"。
一个组件就是 `render(props, state)`。props 不可改是设计约束,不是礼貌:改了父组件不知道,数据流就断了。

**不可变更新为什么是硬要求。**
React 判断"要不要重渲染 / 要不要跳过"靠的是 `Object.is` 的**引用比较**,不是深比较。
你写 `items.push(x); setItems(items)`,引用没变,React 认为什么都没发生,直接 bail out,界面不更新。
这不是 React 偷懒:深比较一棵大对象树的成本可能比重渲染还高,而且不可判定(函数、循环引用)。
引用比较是 O(1) 的,代价是把"声明变化"的责任交给你:**新值必须是新对象**。

这条约束还有两个更深的理由,面试问到"为什么必须不可变"时答这两条会明显高一档:

1. **并发渲染需要能丢弃一次渲染重来。** React 可能渲染到一半发现有更高优先级的更新,丢弃这次结果重新渲染。
   如果你在渲染里就地改了对象,旧值已经没了,重来一次得到的结果就不一样,渲染不再是纯函数。
2. **不可变数据让"上一版"依然可读**,这正是 memo、`useMemo` 依赖比较、时间旅行调试能成立的基础。

正确写法就是造新引用:`setItems(prev => [...prev, x])`、`setUser(prev => ({...prev, name}))`。
嵌套深了就分层展开,或者用 Immer 这类库把"看起来像 mutation"的写法编译成不可变更新。

**函数式更新(updater)什么时候必须用。**
`setCount(count + 1)` 里的 `count` 是**这次渲染闭包捕获的那个值**。
同一批里连写两次,两次读的都是同一个旧值,结果只 +1。
`setCount(c => c + 1)` 由 React 排队依次执行,读到的是队列里的最新值,结果是 +2。
规则:**新值依赖旧值时,一律用 updater**。这一条在 `progressSync` 那种"事件不断入队"的场景里尤其重要。

**状态提升(lifting state up)。**
两个兄弟组件要读写同一份数据时,把这个 state 提到它们最近的共同父组件,再用 props 往下传值、往下传回调。
这是 React 的默认答案,在你伸手去拿 context 或状态库之前先问一句:提一层够不够。
代价是 props drilling:传三四层以上就该考虑 context 或组件组合(把 JSX 作为 children 传下去,往往能直接消掉中间层的传递)。

**派生状态是反模式。**
如果一个值可以从现有 state / props 算出来,**就不要把它存成 state**。
反例是这样:`const [filtered, setFiltered] = useState([]); useEffect(() => setFiltered(items.filter(...)), [items])`。
问题有三个:多渲染一帧(用户先看到旧的 filtered)、两份数据可能不同步、每加一个来源就要多一条 effect。
正确写法是**在渲染期直接算**:`const filtered = items.filter(...)`,算得慢再包 `useMemo`。
你项目里 `progressSelectors.ts` / `homeSelectors.ts` 这种 selector 文件就是这个思想:
真源只有 `CardProgress`,首页要展示的进度、日历、CTA 全是它的纯函数派生结果,不是另存一份的 state。

**"props 变了要重置 state"怎么办。**
不要写 `useEffect(() => setX(props.x), [props.x])`。两个更好的选择:
(a) 整个组件都该重来 → **换 key**(模块 1 讲过);
(b) 只有一部分要跟随 → 渲染期比较:保存"上一次的 prop",发现变了就在渲染中直接 `setState`
(React 支持这种"渲染期调整 state",它会立刻重跑本组件而不提交中间结果,比 effect 少一帧)。

**什么时候会坏 / 常见误解。**
- 误解:"state 是同步的"。`setX(1)` 之后立刻读 `x` 仍是旧值,因为当前渲染的闭包不会变。
- 误解:"把所有东西塞一个大 state 对象更干净"。合并本身没错,但每次更新都要正确展开,漏一层就丢字段。
- 误解:"用 state 存一切"。不参与渲染的东西(定时器 id、上一次的滚动位置)应该放 ref,放 state 只会白白触发渲染。

### 卡片素材(手动录入用)

- **Q:** `items.push(newItem); setItems(items)` 为什么界面不更新?
  **A:** 因为引用没变。React 用 `Object.is` 做引用比较来判断是否需要重渲染,同一个数组对象比较下来相等,直接 bail out。
  深比较不做的原因是成本可能超过重渲染本身,而且对函数和循环引用不可判定。
  正确写法是造新引用:`setItems(prev => [...prev, newItem])`。
  **难度:** d0
  **EN:** React compares by reference, so mutating in place looks like no change at all.

- **Q:** 除了"React 靠引用比较",不可变更新还有什么更深的理由?
  **A:** 并发渲染允许 React 渲染到一半丢弃重来。如果渲染过程中就地修改了对象,旧值已经被破坏,重跑得到的结果会不一样,渲染就不再是纯函数。
  另外不可变数据保证"上一版仍然可读",这是 memo 比较、useMemo 依赖判断、时间旅行调试成立的前提。
  面试答到这一层,比只说"React 比较引用"高一档。
  **难度:** d3
  **EN:** Immutability keeps render pure and re-runnable, which is what concurrent rendering requires.

- **Q:** 同一个 handler 里写 `setCount(count+1); setCount(count+1)`,结果加了几?怎么改成加 2?
  **A:** 只加 1。两次读到的 `count` 都是本次渲染闭包里捕获的同一个旧值,所以两次都算出同一个新值。
  改成 `setCount(c => c + 1)` 两次即可:updater 会被排队依次执行,第二个读到的是第一个的结果。
  规则记死:新值依赖旧值时一律用函数式更新。
  **难度:** d1
  **EN:** Use the updater form whenever the next state depends on the previous one.

- **Q:** `useEffect(() => setFiltered(items.filter(f)), [items])` 这种写法为什么是反模式?换成什么?
  **A:** 因为 filtered 是派生数据,不该存成 state。这样写会多渲染一帧(用户先看到旧结果)、制造两份可能不同步的数据、每多一个输入源就多一条 effect。
  正确做法是渲染期直接算:`const filtered = items.filter(f)`,量大再用 `useMemo` 包住。
  判断口诀:能从现有 state 算出来的,就不要存。
  **难度:** d1
  **EN:** Derive during render instead of syncing derived values with an effect.

- **Q:** 一个 prop 变化时需要清空组件所有内部 state,为什么"换 key"比 effect 里逐个重置好?
  **A:** 换 key 是一次卸载重建,所有 state 一次性回到初始值,不会多渲染一帧旧数据,也不会随着 state 增多而漏掉某一个。
  effect 方案是"渲染完了再纠正",用户能看到一帧错的内容,而且每新增一个 state 都要记得补一行重置。
  只有一部分 state 要跟随 prop 时,才考虑渲染期比较上一次 prop 并直接 setState。
  **难度:** d1
  **EN:** Reset a component by changing its key instead of clearing each state in an effect.

- **Q:** 什么时候该把 state 提升到父组件,什么时候不该?
  **A:** 两个兄弟组件要读写同一份数据、或者父组件需要根据子组件的值做决策时,提升到最近的共同父组件。
  不该提升的情况是:只有一个组件用它,提上去只会让父组件被无关的更新拖着重渲染。
  提升的代价是 props drilling,传三四层以上就该考虑 context 或用 children 组合来消掉中间层。
  **难度:** d0
  **EN:** Lift state to the closest common ancestor, but only as high as it actually needs to go.

- **Q:** 为什么 props 不能直接修改?说"因为它是只读的"不够,真正的后果是什么?
  **A:** 真正的后果是数据流断裂。props 的真源在父组件,子组件改了它,父组件的 state 并没有变,下一次父渲染又会把旧值传下来,界面表现为"改了又跳回去"。
  而且这份改动对 React 不可见,不会触发任何重渲染,所以症状常常是"数据明明变了但界面没动"。
  要改就把回调传下来,让真源所在的那一层去 setState:谁拥有这个 state,谁才有权改它。
  **难度:** d0
  **EN:** Mutating props breaks the single source of truth, so the parent just overwrites it on the next render.

- **Q:** 在 `setX(1)` 的下一行读 `x`,读到什么?为什么这个设计是合理的?
  **A:** 读到旧值。`x` 是本次渲染闭包里的一个常量,`setX` 排入的是"下一次渲染用什么",不会回头改当前这次渲染的变量。
  合理性在于:一次渲染中所有变量保持一致(render 是快照),否则同一函数体内前后读到不同的 `x`,推理会变得不可能。
  需要立刻用新值就自己算一个局部变量,或者用 updater。
  **难度:** d1
  **EN:** State is a snapshot per render, so reading it right after setting still gives the old value.

- **Q:** 什么东西应该放 state,什么东西不该放?
  **A:** 参与渲染输出的放 state,不参与渲染的放 ref 或普通变量。
  定时器 id、上一次的滚动位置、动画句柄这些只在副作用里用的东西放 state 只会白白触发渲染,
  我在 `DrawCeremonyScreen.tsx` 里就是用 `useRef<number[]>([])` 存 timer id,而 `phase` 才是 state。
  另一条:能算出来的不放 state(派生数据在渲染期算)。
  **难度:** d1
  **EN:** If a value does not affect the rendered output, it belongs in a ref, not in state.

---

## 3. hooks 深入

### 概念讲解

**Mental model 一句话**:每次渲染都是一张**快照**。这次渲染里的 props、state、以及你定义的所有函数,
都是**属于这一次渲染的独立副本**,它们被闭包冻结在那一刻。hook 的绝大多数坑,都是"某段代码活得比它的那次渲染更久"造成的。

**闭包陷阱。** 经典例子:

```jsx
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000); // count 永远是 0
  return () => clearInterval(id);
}, []); // 依赖为空,effect 只在挂载时跑一次
```

`count` 被捕获在**挂载那次渲染**的闭包里,永远是 0,所以计数停在 1。
三种修法,按优先级:
(a) 用 updater:`setCount(c => c + 1)`,不再读闭包里的 count,依赖数组就可以合法地为空;
(b) 把 count 加进依赖数组,让 effect 每次都重建 interval(语义变了,注意抖动);
(c) 用 ref 存一个"始终指向最新值"的引用,适合那种"回调需要最新值但不该因此重建订阅"的场景
(你的 `progressSync` 的 debounce timer 和触发策略就是这一类:定时器不该因为渲染而重建)。

**依赖数组的真实语义。** 最重要的一句:**依赖数组不是"什么时候运行"的开关,而是"和上次相比变了没有"的声明。**
React 在每次渲染后,把这次的依赖数组和上次的逐项做 `Object.is` 比较,只要有一项不同就:先跑上次的 cleanup,再跑这次的 effect。
推论几条:
- 数组长度必须固定,不能条件式增减(hook 靠调用顺序定位)。
- 里面必须列出 effect 用到的**所有**来自渲染作用域的值,漏了就是 stale closure。
  `eslint-plugin-react-hooks` 的 exhaustive-deps 报的不是风格问题,是正确性问题。
- **对象和函数每次渲染都是新引用**,直接放进依赖数组等于"每次都变",effect 每渲染必跑。
  这就是 `useCallback` / `useMemo` 真正的用途之一:稳定依赖项的引用。
- 空数组 `[]` 的意思不是"只跑一次",而是"没有任何依赖会变",所以在 StrictMode 下依然会挂载 → 清理 → 再挂载一次。

**清理函数(cleanup)。** 它在两个时机跑:组件卸载时,以及**下一次 effect 执行之前**。
后半句常被忽略,但它才是 effect 的正确心智模型:**每次 effect 都要能自己收尾**,
订阅要退订、定时器要 clear、请求要 abort 或设置忽略标志。
没有 cleanup 的典型症状:切页面后 setState 报警告、旧请求后到覆盖了新数据、定时器越积越多。
React 18+ 的 StrictMode 故意"挂载 → 卸载 → 再挂载"一次,就是为了让缺失的 cleanup 立刻暴露(重复订阅、双份请求)。
你在 `DrawCeremonyScreen.tsx` 里用 `timers = useRef<number[]>([])` 收集 timer id 再统一清,正是这个模式的正确形态:
7 阶段流程里每个 phase 都会排定时器,phase 一变必须把上一批全部作废,否则动画会串。

**useEffect 什么时候不该用**(这是面试区分度最高的一题,官方文档专门有一篇 "You Might Not Need an Effect"):
- **派生数据**:能在渲染期算的不要用 effect + state(模块 2 讲过)。
- **响应用户事件**:点击后要发请求、要打点,写在事件处理函数里,不要"设一个 state 再用 effect 监听它"。
  判断标准:这件事是"因为用户做了某个动作"还是"因为组件出现在了屏幕上"。前者进 handler,后者才进 effect。
- **把 props 同步进 state**:换 key 或渲染期比较。
- **纯计算的缓存**:那是 `useMemo` 的活。
effect 真正该干的只有一件事:**和 React 之外的世界同步**(订阅、DOM 测量、网络、定时器、日志)。
另外,数据获取用 effect 手写会缺 race condition 处理、缓存、重试;你的控制台已经用 `@tanstack/react-query` 接管了这块,这是标准答案。

**useRef vs state。** 一句话区分:**改了要重画用 state,改了不该重画用 ref。**
ref 是"一个跨渲染保持同一身份的可变盒子"(`.current`),写它不触发渲染,读它拿到的永远是最新值(不是闭包快照)。
两种用途:(a) 存 DOM 节点;(b) 存不参与渲染的可变值(timer id、上一次的值、最新回调)。
禁忌:**不要在渲染期读写 ref**,渲染必须纯,并发渲染下这会产生不一致。ref 只在 effect 和事件回调里碰。

**useLayoutEffect。** 和 useEffect 唯一的区别是时机:它在 DOM 变更后、浏览器**绘制之前**同步执行。
只有一种正当理由用它:你要测量布局然后立刻改样式,用 useEffect 会让用户看到一帧闪烁。
代价是它阻塞绘制,滥用会掉帧。默认永远先选 useEffect。

### 卡片素材(手动录入用)

- **Q:** `useEffect(() => { const id = setInterval(() => setCount(count+1), 1000); return () => clearInterval(id) }, [])`,计数会停在几?为什么?
  **A:** 停在 1。`count` 被闭包冻结在挂载那次渲染,永远是 0,所以每秒都在算 `0 + 1`。
  根因是 interval 活得比创建它的那次渲染更久,却仍然读着那次渲染的快照。
  最好的修法是 `setCount(c => c + 1)`,不读闭包就没有陈旧问题,依赖数组也能合法留空。
  **难度:** d1
  **EN:** The interval closes over the first render's count, so it keeps computing zero plus one.

- **Q:** 依赖数组的真实语义是什么?说"控制 effect 什么时候跑"为什么不准确?
  **A:** 它是"和上一次渲染相比,这些值变了没有"的声明,不是一个运行开关。
  React 每次渲染后把这次数组和上次逐项做 `Object.is` 比较,有一项不同就先跑上次的 cleanup,再跑这次的 effect。
  所以正确的写法方向不是"我想让它少跑,就少写几个依赖",而是"effect 用到什么就必须列什么,想让它少跑就去稳定那些依赖的引用"。
  漏写依赖换来的不是性能,是 stale closure。
  **难度:** d2
  **EN:** The dependency array declares what the effect reads, not when it should run.

- **Q:** 为什么把一个内联对象或内联函数放进依赖数组,effect 会每次渲染都跑?
  **A:** 因为对象和函数字面量每次渲染都会创建新引用,`Object.is` 比较必然不相等。
  修法是让引用稳定:函数用 `useCallback`,对象用 `useMemo`,或者干脆把需要的字段拆成原始值放进依赖(`[user.id]` 而不是 `[user]`)。
  这也是 `useCallback` 最正当的用途之一:稳定依赖项,而不是"省一次函数创建"。
  **难度:** d1
  **EN:** Object and function literals are new references every render, so they always look changed.

- **Q:** cleanup 函数在哪两个时机执行?忽略掉第二个时机会出什么 bug?
  **A:** 组件卸载时,以及**下一次 effect 执行之前**。
  忽略第二个时机会导致资源叠加:订阅越积越多、定时器不清理、旧请求后到覆盖新数据。
  正确的心智模型是"每一次 effect 都要能自己收尾",不是"卸载时收拾一下"。
  我在 DrawCeremonyScreen 里用一个 ref 数组收集所有 timer id,phase 一变就整批 clear,就是这个模式。
  **难度:** d1
  **EN:** Cleanup runs before the next effect, not only on unmount.

- **Q:** StrictMode 下 effect 挂载时跑了两次,该怎么处理?
  **A:** 不要绕过,要补 cleanup。React 18+ 故意做"挂载 → 卸载 → 再挂载"来暴露不可重入的 effect。
  如果 effect 写对了(订阅有退订、请求有 abort 或忽略标志、定时器有 clear),跑两次的最终状态和跑一次完全一样。
  用 `useRef` 加一个 `hasRun` 布尔来跳过第二次是在掩盖问题,生产环境里同样的缺陷会以别的形式(快速切页、路由重挂)复现。
  **难度:** d1
  **EN:** Double-invoked effects in StrictMode are a test of your cleanup, not a bug to suppress.

- **Q:** 用户点按钮后要发一个请求,写在 handler 里还是"setState 然后 useEffect 监听"?判断标准是什么?
  **A:** 写在 handler 里。判断标准是这件事的起因:因为**用户做了一个动作**就进事件处理函数,因为**组件出现在屏幕上或某个外部值变了**才进 effect。
  用 state + effect 绕一圈的代价是多一次渲染、时序更难推理、而且这个 state 会变成一个没人需要的中间真源。
  effect 的正当职责只有一个:和 React 之外的世界同步。
  **难度:** d2
  **EN:** Event-driven work belongs in the handler; effects are for syncing with the outside world.

- **Q:** 列出至少三种"看起来该用 useEffect,其实不该"的情况。
  **A:** (1) 派生数据,应该在渲染期直接算,慢再 useMemo;
  (2) 响应用户事件,应该写在 handler 里;
  (3) 把 props 同步进 state,应该换 key 或在渲染期比较上一次的 prop;
  (4) 数据获取,手写会缺 race 处理、缓存、重试,应交给 react-query 这类库(我的控制台就是这么做的)。
  剩下真正属于 effect 的只有订阅、DOM 测量、定时器、和外部系统同步。
  **难度:** d1
  **EN:** Effects are a last resort for external synchronization, not a general-purpose reaction mechanism.

- **Q:** useRef 和 useState 怎么选?一句话标准是什么?
  **A:** 改了需要重画用 state,改了不该重画用 ref。
  ref 是一个跨渲染保持同一身份的可变盒子,写 `.current` 不触发渲染,读它拿到的是最新值而不是闭包快照。
  典型 ref 用途:DOM 节点、timer id、"最新回调"、上一次的值。
  典型误用:把参与渲染的数据放 ref,结果界面不更新,然后靠强制刷新救场。
  **难度:** d0
  **EN:** Use state when a change must repaint, and a ref when it must not.

- **Q:** 为什么不该在渲染函数体里读写 ref?
  **A:** 因为渲染必须是纯的:同样的输入要产生同样的输出且无副作用。
  在渲染期写 ref 是副作用,StrictMode 双渲染会让它执行两次;并发渲染下 React 可能丢弃一次渲染重来,ref 里却留下了那次被丢弃渲染的痕迹。
  ref 只应该在 effect 和事件回调里读写。
  **难度:** d3
  **EN:** Reading or writing refs during render breaks purity and misbehaves under concurrent rendering.

- **Q:** useLayoutEffect 和 useEffect 的区别是什么?什么时候才该用前者?
  **A:** 时机不同:useLayoutEffect 在 DOM 变更后、浏览器绘制**之前**同步执行,useEffect 在绘制之后异步执行。
  只有一种正当理由用前者:需要测量布局再立刻调整样式或滚动位置,否则用户会看到一帧闪烁(比如 tooltip 先出现在错的位置再跳走)。
  代价是它阻塞绘制,滥用直接掉帧。默认先用 useEffect。
  **难度:** d1
  **EN:** useLayoutEffect runs before paint, so use it only to prevent a visible flash after measuring layout.

- **Q:** 为什么 hooks 不能写在条件语句或循环里?
  **A:** 因为 React 靠**调用顺序**把每次渲染的 hook 和它保存的状态槽位对应起来,没有名字只有序号。
  条件调用会让某次渲染的第 2 个 hook 从 useState 变成 useEffect,状态就错位了,React 会直接报错或者读到别的 hook 的值。
  这也是为什么依赖数组长度必须固定。要条件化就把条件放进 hook 内部,或者把这段逻辑拆成一个子组件。
  **难度:** d1
  **EN:** Hooks are matched by call order across renders, so the order must be identical every time.

- **Q:** 一个 effect 里发请求,组件很快被卸载或参数很快变了,会出什么问题?怎么处理?
  **A:** race condition:先发的慢请求后到,覆盖了后发的快请求的结果,界面显示的是过期数据。
  处理方式是在 cleanup 里作废这一次:设一个 `let ignore = false`,cleanup 里置 true,回调里判断后再 setState;
  或者用 AbortController 取消请求。
  更好的答案是别手写,交给 react-query 之类的库,它把 race、缓存、重试、失效一起解决了。
  **难度:** d2
  **EN:** Without a cleanup guard, a slow earlier request can land after a newer one and overwrite it.

---

## 4. 受控 / 非受控与表单

### 概念讲解

**Mental model 一句话**:受控组件的真源在 React state,DOM 只是投影;非受控组件的真源在 DOM 自己身上,React 只在需要时去问一下。
两种都合法,选哪种取决于"你是否需要在每次按键之间介入"。

**受控(controlled)**:`<input value={v} onChange={e => setV(e.target.value)} />`。
每次按键触发 state 更新 → 重渲染 → input 拿到新 value。
好处是**界面永远等于 state**:你可以实时校验、格式化(自动加空格的卡号)、禁用提交按钮、把值同步给别的组件。
代价是每个字符都走一次渲染,以及"忘了写 onChange 就打不了字"(React 会警告你提供了 value 却没有 onChange)。

**非受控(uncontrolled)**:`<input defaultValue="x" ref={inputRef} />`,提交时读 `inputRef.current.value`,
或者直接在 submit 里用 `new FormData(e.currentTarget)` 一次性取全部字段。
好处是零渲染开销、代码短;代价是输入过程中你无法介入。

**怎么选(面试标准答法)**:
默认用受控,因为绝大多数表单都需要即时校验或联动;
字段特别多、只在提交时才需要值、或者性能敏感(大表单每次按键全表重渲染)时用非受控;
文件输入 `<input type="file">` **只能是非受控**(出于安全,它的 value 不能由 JS 设置)。

**几个经典坑**:
- **value 从 `undefined` 变成有值**:组件会从非受控切成受控,React 会在控制台警告,而且切换那一刻行为不确定。
  修法是给一个确定的初始值(`useState('')` 而不是 `useState()`,或者 `value={v ?? ''}`)。
- **`defaultValue` 只在挂载时生效**,后来改它不会更新输入框。想让它跟着外部数据重置,换 key。
- **`onChange` 的语义和原生不同**:React 的 `onChange` 实际上绑的是原生 `input` 事件,每次按键都触发,
  而原生 DOM 的 `change` 是失焦时才触发。面试里能说出这一条会加分。
- **受控 select / checkbox**:`checkbox` 用 `checked` 而不是 `value`;多选 `select` 的 value 是数组。
- **表单提交默认会刷新页面**,SPA 里必须 `e.preventDefault()`。
- **React Native 没有表单这回事**:`TextInput` 用 `value` + `onChangeText`,没有 submit 事件,提交逻辑全在按钮 handler 里。
  你的 RN 应用里这一层其实全是"手写受控"。

**性能上的现实提醒。** "受控输入很慢"通常是伪命题:慢的是**你把 state 放在了太高的层级**,导致每次按键重渲染整个页面。
解法不是改成非受控,而是把这个 state 下沉到只包住这个字段的小组件里(状态下沉,和状态提升是一对反向工具)。

### 卡片素材(手动录入用)

- **Q:** 受控和非受控组件的真正区别是什么?各自的代价是什么?
  **A:** 区别在真源位置:受控的真源是 React state,DOM 是投影;非受控的真源是 DOM 节点自己,React 只在需要时读。
  受控的代价是每次按键一次渲染,收益是可以实时校验、格式化、联动;
  非受控的代价是输入过程中无法介入,收益是零渲染开销、代码短。
  默认选受控,字段极多或只在提交时取值时选非受控。
  **难度:** d0
  **EN:** Controlled inputs keep React state as the source of truth; uncontrolled ones leave it in the DOM.

- **Q:** 一个 input 的 `value` 从 `undefined` 变成 `"abc"`,会发生什么?为什么?
  **A:** 组件从非受控切换成受控,React 会在开发环境警告,切换瞬间的行为不可靠。
  原因是 React 用"这次渲染有没有提供 value"来判断这个 input 归谁管,中途换管辖权它无法安全迁移。
  修法是从一开始就给确定值:`useState('')`,或者写 `value={v ?? ''}`。
  异步数据填表单最容易踩这个坑。
  **难度:** d1
  **EN:** Switching an input between uncontrolled and controlled mid-life is undefined behavior and React warns about it.

- **Q:** React 的 `onChange` 和原生 DOM 的 `change` 事件有什么区别?
  **A:** React 的 `onChange` 实际上监听的是原生 `input` 事件,每次按键立刻触发;
  原生的 `change` 事件在文本框上要等失焦或回车才触发。
  React 这样做是为了让受控组件的语义一致:state 必须跟得上每一次输入。
  知道这条才能解释"为什么受控输入每敲一个键就重渲染一次"。
  **难度:** d2
  **EN:** React's onChange maps to the native input event, so it fires on every keystroke.

- **Q:** 表单打字卡顿,应该把受控改成非受控吗?
  **A:** 通常不该。卡顿的真正原因一般是 state 放得太高,一次按键触发了整页重渲染。
  正确解法是**状态下沉**:把这个字段的 state 移到只包住它的小组件里,让重渲染范围缩到一个输入框。
  改成非受控是放弃能力去换性能,应该是最后手段,而且会让实时校验和联动没法做。
  **难度:** d2
  **EN:** Laggy typing usually means the state lives too high, so push it down instead of going uncontrolled.

- **Q:** `defaultValue` 在什么时候生效?外部数据到达后想更新它怎么办?
  **A:** 只在组件挂载那一次生效,之后改 `defaultValue` 对已有的 DOM 节点没有任何作用。
  想让它跟着外部数据重置,就给这个输入框或整个表单换一个 key,让 React 卸载重建,新的 `defaultValue` 才会被采用。
  这是模块 1 那条"key 是身份"规则的直接应用。
  **难度:** d1
  **EN:** defaultValue applies only at mount, so remount via a new key to pick up fresh data.

- **Q:** 哪种输入框必须是非受控的?为什么?
  **A:** `<input type="file">`。出于安全,浏览器不允许 JavaScript 设置它的 value,否则网页就能伪造用户选择的文件路径去偷文件。
  所以你只能读 `e.target.files` 或通过 ref 读,不能把它当受控组件写。
  唯一能通过脚本设置的值是空字符串(用来清空选择)。
  **难度:** d1
  **EN:** File inputs must stay uncontrolled because browsers forbid scripts from setting their value.

- **Q:** SPA 里表单提交为什么必须 `e.preventDefault()`?
  **A:** 因为 `<form>` 的默认行为是向 action 地址发起一次真实的浏览器导航,页面会整个刷新,SPA 的内存状态、路由栈、未提交数据全部丢失。
  阻止默认行为后再自己发请求,才是单页应用的提交方式。
  顺带一提,保留 `<form>` 而不是用一个裸 button,是为了拿到回车提交和浏览器的原生校验、无障碍语义。
  **难度:** d0
  **EN:** Without preventDefault the form triggers a full page navigation and the SPA state is gone.

- **Q:** 提交时一次性拿到所有字段值,有哪些做法?
  **A:** 非受控路线最省事:`const data = Object.fromEntries(new FormData(e.currentTarget))`,前提是每个输入框都有 `name`。
  受控路线就是直接读那份 state 对象。
  ref 路线适合只有一两个字段需要命令式访问(比如提交后聚焦第一个出错的字段)。
  选择标准还是那条:输入过程中要不要介入。
  **难度:** d1
  **EN:** FormData on submit is the quickest way to read an uncontrolled form in one shot.

- **Q:** React Native 的输入和 Web 表单有什么结构性差异?
  **A:** RN 没有 form 元素也没有 submit 事件,`TextInput` 用 `value` + `onChangeText`,提交逻辑全部写在按钮的 handler 里。
  也没有浏览器原生校验和 FormData,校验必须自己写。
  所以 RN 里实际上只有"受控"这一种模式,我的 RN 应用里表单层就是手写受控加自定义校验。
  **难度:** d1
  **EN:** React Native has no form element or submit event, so every input is effectively controlled by hand.

---

## 5. 性能

### 概念讲解

**Mental model 一句话**:React 的性能问题几乎总是"**渲染了不该渲染的东西**"或"**渲染了太多东西**",
前者用记忆化(memoization)解决,后者用虚拟化解决。先测量,再动手。

**先说最重要的一条纪律**:这三个 API 都不是免费的。
`memo` 要做浅比较,`useMemo` / `useCallback` 要存依赖数组、每次渲染都要比较依赖。
如果被保护的计算本来就便宜,你付出的比较成本比省下来的还多,这叫**反优化**。
更糟的是它污染代码可读性,并且制造一种"我优化过了"的错觉。
面试里正确的姿态是:**默认不加,profiler 指出热点后再加**。(React 19 生态里的 React Compiler 正是想把这类手动记忆化自动化掉,但它是需要显式接入的编译期方案,不是默认行为,回答时不要说成"React 19 自动帮你 memo 了"。)

**三者各自解决什么**:

- **`React.memo(Component)`**:解决"父渲染无条件传染给子"。
  它对 props 做**浅比较**,全部相等就跳过这次子树渲染。
  失效条件很好记:只要有一个 prop 是每次新建的对象、数组、内联函数,浅比较必然不等,memo 白加。
  这就是为什么 memo 常常要和 useCallback / useMemo 配套,单独用一个往往没效果。
- **`useMemo(fn, deps)`**:缓存**一个计算结果的值**。两个用途:
  (a) 计算本身昂贵(排序几千条、跑一遍统计);
  (b) 结果要作为 props 传给 memo 化的子组件、或者要进另一个 hook 的依赖数组,**需要引用稳定**。
  用途 (b) 在实践中比 (a) 更常见,而且更值得说。
- **`useCallback(fn, deps)`**:就是 `useMemo(() => fn, deps)` 的语法糖,缓存**函数引用**。
  它几乎从不为了"少创建一个函数对象"(那个成本可以忽略),而是为了让引用稳定,
  这样下游的 memo 才拦得住,依赖数组才不会每次都变。

**判断口诀**:memo 保护子树,useMemo 保护值,useCallback 保护函数引用;
**后两个存在的主要理由是让第一个能生效,或者让依赖数组稳定**。

**什么时候是反优化(必答)**:
- 组件本身很小、props 每次都变:memo 只是白比一遍。
- 缓存一个 `a + b`:比较依赖的成本高于计算本身。
- 给一个没有被 memo 包住的子组件传 `useCallback` 的函数:下游根本不比较 props,稳定引用毫无意义。
- 依赖数组写错导致缓存永远命中旧值:这已经不是性能问题,是 bug。
- 到处 memo 让你不敢重构:维护成本是真实成本。

**其他更有效的手段(往往比 memo 有用得多)**:
- **状态下沉**:把 state 放进真正需要它的那个小组件,重渲染范围自然缩小(表单卡顿的标准解法)。
- **内容上提 / children 组合**:把不依赖该 state 的部分作为 `children` 传进来。
  children 是在父的父那一层创建的 element,状态变化时它的引用没变,React 会跳过这棵子树,不用写任何 memo。
- **拆分 context**(见模块 6)。
- **列表虚拟化**。

**列表虚拟化(windowing)。**
思想:一个 5000 行的列表,屏幕上只能看到 15 行,那就**只挂载可视区加少量缓冲的那些行**,
用一个撑起总高度的容器(或 transform 偏移)骗过滚动条,滚动时回收并复用行组件。
收益不只是渲染时间,更是 DOM 节点数:节点越多,浏览器的样式计算、布局、内存占用越糟。
代价:需要知道行高(定高最简单,不定高要测量并缓存),浏览器原生的 Ctrl+F 搜不到未挂载的行,焦点和滚动恢复要自己处理。
Web 上是 react-window / react-virtuoso 这类库;**React Native 的 `FlatList` 本身就是虚拟化列表**,
这也是为什么 RN 里"能用 FlatList 就别用 ScrollView + map",以及为什么 `keyExtractor` 必须给稳定 id(回收复用时靠它认身份)。

**测量优先。** React DevTools Profiler 能告诉你"哪个组件渲染了、为什么渲染(Why did this render)、花了多久"。
先看火焰图,再决定动哪里。没测量就 memo 是猜。

### 卡片素材(手动录入用)

- **Q:** `React.memo`、`useMemo`、`useCallback` 各自解决什么问题?用一句话区分。
  **A:** memo 保护子树(拦住父渲染的无条件传染),useMemo 保护一个值(缓存计算结果或稳定引用),useCallback 保护函数引用。
  关键的关联是:后两个存在的主要理由,是让 memo 的浅比较能真的通过,或者让依赖数组不要每次都变。
  单独用 memo 而不稳定 props,基本等于没加。
  **难度:** d1
  **EN:** memo guards a subtree, useMemo guards a value, useCallback guards a function identity.

- **Q:** 给子组件包了 `React.memo` 却发现它照样每次都渲染,最可能的原因是什么?
  **A:** 有 prop 是每次渲染新建的引用:内联函数 `onClick={() => ...}`、内联对象 `style={{...}}`、内联数组、或者临时算出来的对象。
  memo 做的是浅比较,新引用必然不等,所以直接跳过失败。
  修法是用 useCallback / useMemo 稳定这些 prop,或者把它们改成原始值。
  **难度:** d1
  **EN:** memo does a shallow compare, so any inline object or function prop defeats it.

- **Q:** 举两个"加了记忆化反而更差"的例子。
  **A:** (1) 用 useMemo 缓存 `a + b` 这种廉价计算:比较依赖数组的成本高于重新计算,还多占内存;
  (2) 给一个没被 memo 包住的子组件传 useCallback 函数:下游根本不比较 props,稳定引用完全没有意义。
  再加一条:依赖数组写漏导致缓存命中旧值,那就从性能问题变成正确性 bug 了。
  纪律是先用 Profiler 定位热点,再决定加哪一个。
  **难度:** d2
  **EN:** Memoizing cheap work or feeding a non-memo child costs more than it saves.

- **Q:** 除了 memo 家族,还有哪两个手段能显著减少重渲染范围?
  **A:** 状态下沉和 children 组合。
  状态下沉:把 state 移进真正用它的那个小组件,重渲染范围自然收窄(表单卡顿的标准解法)。
  children 组合:把不依赖该 state 的部分作为 `children` 传进来,它的 element 是在更上层创建的,state 变化时引用没变,React 直接跳过这棵子树。
  这两个都是结构性修复,不需要写任何 memo,优先级应该高于记忆化。
  **难度:** d2
  **EN:** Moving state down and passing subtrees as children cut re-renders without any memoization.

- **Q:** 列表虚拟化的核心思想是什么?省的是什么?
  **A:** 只挂载可视区加少量缓冲的行,用一个撑起总高度的容器骗过滚动条,滚出去的行被回收复用。
  省的不只是渲染时间,更关键是 DOM 节点数量:节点越多,样式计算、布局和内存越糟,几千行会直接把主线程压垮。
  代价是要知道行高、原生页面搜索搜不到未挂载的行、焦点和滚动恢复要自己管。
  **难度:** d1
  **EN:** Virtualization renders only the visible window, cutting DOM node count rather than just render time.

- **Q:** React Native 里为什么"能用 FlatList 就别用 ScrollView + map"?
  **A:** 因为 `FlatList` 本身就是虚拟化列表,只挂载视口附近的行并回收复用;`ScrollView` 会把所有子元素一次性全部挂载。
  几百上千项时后者的内存和首次渲染时间会线性爆炸,低端安卓机直接卡死。
  配套要点是 `keyExtractor` 必须返回稳定 id:回收复用时靠它识别身份,给 index 会让内容串行。
  **难度:** d1
  **EN:** FlatList is virtualized by default while ScrollView mounts every child at once.

- **Q:** 有人说"React 19 有 Compiler 了,不用再手写 memo",这句话哪里不准确?
  **A:** React Compiler 是一个需要显式接入的编译期工具(通过 babel 插件配置),不是 React 19 的默认行为,项目没接就完全没有它。
  它的目标确实是自动完成大部分手动记忆化,但你仍然要保证组件是纯的,它才敢做这些变换。
  面试里稳妥的说法是:"方向是自动化,但当前项目里我还是按需手动加,并且先测量"。
  **难度:** d3
  **EN:** The React Compiler is opt-in tooling, not automatic behavior you get for free in React 19.

- **Q:** 怎么定位"到底是哪里渲染太多"?
  **A:** 用 React DevTools Profiler 录一段交互,看火焰图里哪些组件参与了这次 commit、各花了多久,并打开 "Why did this render" 看触发原因。
  先确认是"渲染次数太多"还是"单次渲染太慢",两者的解法完全不同:前者靠 memo / 状态下沉 / 拆 context,后者靠减少工作量或虚拟化。
  没有 profile 就加 memo,是在猜。
  **难度:** d1
  **EN:** Profile first: too many renders and one slow render need completely different fixes.

- **Q:** `useCallback` 真正的价值是"少创建一个函数对象"吗?
  **A:** 不是。创建一个函数的成本基本可以忽略,而 useCallback 自己还要存依赖并每次比较,单看这一项其实是净亏。
  它的价值全在**引用稳定**:让下游 memo 的浅比较能通过,让 useEffect 的依赖数组不要每次都变。
  所以判断该不该用,看的是"这个函数会不会被别人比较",而不是"这个函数创建贵不贵"。
  **难度:** d2
  **EN:** useCallback exists to stabilize identity for consumers, not to avoid allocating a function.

---

## 6. 状态管理光谱

### 概念讲解

**Mental model 一句话**:状态管理不是选一个库,而是给每一份数据**找到它该住的最低楼层**。
往上抬一层就多一批被牵连重渲染的组件,所以默认往下放,只在被逼的时候才往上抬。

**光谱从下到上**:

1. **组件内 `useState`**:只有这个组件用。默认起点,永远先试这一层。
2. **提升到共同父组件**:两个兄弟要共享。代价是 props drilling。
3. **`useReducer`**:状态之间有约束、迁移有规则时。
   `useReducer` 相对 `useState` 的真正好处不是"状态多",而是**把"怎么变"集中到一个纯函数里**,
   于是迁移合法性可测试、可推理、不会散落在十几个 handler 里。
   你的 `CeremonyPhase` 7 阶段就是天然的 reducer 候选:phase 的合法迁移是一条链,写成 reducer 就能一眼看出哪些跳转是非法的。
4. **Context**:跨很多层、变化不频繁的数据(主题、当前用户、语言、feature flag)。
5. **外部 store**(Zustand / Redux / Jotai 等):全局、更新频繁、需要细粒度订阅、需要在 React 之外读写。
6. **服务端状态另算**(下面单说)。

**Context 的重渲染代价(这是本模块的核心考点)。**
Context **不是状态管理库,它是依赖注入**:它解决"怎么把值传下去",不解决"谁该重新渲染"。
机制是:Provider 的 `value` 只要 `Object.is` 变了,**所有** `useContext` 的消费者都会重渲染,
**不管它们只读了 value 里的哪一个字段**。中间隔着 `React.memo` 也拦不住,context 传播是绕过 props 比较的。

由此产生两个经典 bug:
- **value 是内联对象**:`<Ctx.Provider value={{user, setUser}}>`,每次父渲染都是新对象,所有消费者全量重渲染。
  修法是 `useMemo` 包住 value。
- **一个大 context 塞了所有东西**:主题、用户、购物车、UI 开关全在一个 value 里,
  购物车一变,只读主题的组件也跟着重渲染。
  修法是**按变化频率拆 context**:变得慢的和变得快的分开;
  经典拆法还有"state context + dispatch context"两个 Provider,因为 dispatch 引用永远稳定,
  只 dispatch 不读 state 的组件就完全不会被牵连。

**什么时候换成外部 store。**
判断标准不是"状态多",是这几条命中任意一条:
(a) 更新频率高且消费者多,context 的全量通知开销受不了;
(b) 需要**细粒度订阅**(只订阅 store 里的一个字段,别的字段变了我不动);
(c) 需要在 React 组件之外读写(比如你的 `progressSync.ts` 这类同步循环、后台任务、事件队列);
(d) 需要中间件(持久化、日志、时间旅行)。
外部 store 在 React 里的正确接入方式是 **`useSyncExternalStore`**:它是 React 18 为外部数据源提供的官方 hook,
关键作用是防止并发渲染下的 **tearing**(同一次渲染中,不同组件读到了外部 store 的不同版本,画面自相矛盾)。
现代状态库内部都用它。

**服务端状态是独立的一类,别混进客户端状态。**
"后端那份数据的本地缓存"和"这个下拉框开没开"根本不是一回事:前者会过期、会失败、需要重试、需要去重、需要失效重取。
用 `useState` + `useEffect` 手写它,你会一步步重新发明 react-query,而且大概率漏掉 race condition。
你的控制台用 `@tanstack/react-query` 正是这个分层:**server state 交给 query 库,client state 留给 useState / context**。
这是面试里非常干净的一句回答。

**offline-first 是这条光谱的极端形态。**
你的 RN 应用里,真源根本不是内存里的 React state,而是**本地持久化**(AsyncStorage)加一条**事件队列**:
`progressSync.ts` 里打完分先 `saveDeckProgress()` 落盘让 UI 立刻正确,再把带 `eventId` 的事件入队,
push 时靠 eventId 幂等去重(服务端返回 duplicateEventIds,客户端才敢删),rating 事件走 debounce 合批。
这里值得讲清楚的取舍是:**UI 只读本地,永远不等网络**,一致性靠"最终一致 + 幂等重放"来保证,
而不是靠"等服务端确认再更新界面"。React state 在这套结构里只是本地数据的一层投影。

### 卡片素材(手动录入用)

- **Q:** 为什么说 Context 是依赖注入而不是状态管理?这个区分带来什么后果?
  **A:** 因为它只解决"值怎么传到深层组件",不解决"谁应该重新渲染"。
  后果是:Provider 的 value 一变,所有 useContext 的消费者全部重渲染,不管它们只读了其中哪个字段,中间的 React.memo 也拦不住。
  所以 context 适合放变化不频繁的数据(主题、当前用户、语言),高频更新要么拆 context,要么换成支持细粒度订阅的外部 store。
  **难度:** d2
  **EN:** Context is dependency injection: it delivers values but gives you no control over who re-renders.

- **Q:** `<Ctx.Provider value={{user, setUser}}>` 有什么问题?
  **A:** value 是内联对象,每次 Provider 所在组件渲染都会创建新引用,`Object.is` 必然不等,于是全部消费者无差别重渲染,哪怕 user 根本没变。
  修法是 `const value = useMemo(() => ({user, setUser}), [user])`。
  这是 context 性能问题里最常见的一个,而且很容易在 code review 里一眼看出来。
  **难度:** d1
  **EN:** An inline provider value is a new object every render, so every consumer re-renders.

- **Q:** 一个 context 里塞了主题、当前用户、购物车,会有什么问题?怎么拆?
  **A:** 任何一项变化都会让所有消费者重渲染,购物车加一件商品会牵连只读主题的组件。
  拆的原则是按**变化频率**分组:慢变的(主题、语言)一个 Provider,快变的(购物车)另一个。
  还有一个经典拆法是 state 和 dispatch 分成两个 context:dispatch 引用永远稳定,只需要触发动作的组件就完全不会被牵连。
  **难度:** d2
  **EN:** Split contexts by update frequency, and keep dispatch in its own context because its identity never changes.

- **Q:** 什么时候该从 useState 换成 useReducer?理由不是"状态变多了"的话,是什么?
  **A:** 当状态之间存在约束、迁移有规则的时候。useReducer 的真正价值是把"怎么变"收进一个纯函数,于是迁移逻辑集中、可单测、不会散落在十几个 handler 里。
  我的 DrawCeremony 是 7 阶段 phase 机(swipe → approach → hold → tear-flip → flash-reveal → settle → cards-on-table),
  这种"合法迁移是一条链"的东西写成 reducer,非法跳转一眼就能看出来。
  **难度:** d2
  **EN:** Reach for useReducer when transitions have rules, not merely when there are many fields.

- **Q:** 什么信号说明该从 context 升级到外部状态库?
  **A:** 命中任意一条:更新频繁且消费者众多、需要只订阅某个字段的细粒度订阅、需要在 React 组件之外读写、需要持久化或日志这类中间件。
  只是"层级传得深"不算,那用 context 或组件组合就够了。
  反过来,如果数据其实是服务端数据的缓存,该上的是 react-query 而不是全局 store。
  **难度:** d1
  **EN:** Move to a store when you need fine-grained subscriptions or access from outside React.

- **Q:** `useSyncExternalStore` 解决什么问题?tearing 是什么?
  **A:** 它是 React 18 给外部数据源提供的官方订阅入口,解决并发渲染下的 tearing。
  tearing 指的是同一次渲染过程被打断,外部 store 在中途变了,导致先渲染的组件读到旧值、后渲染的读到新值,同一帧画面自相矛盾。
  这个 hook 让 React 能在提交前检查数据是否变过并在必要时重渲染,现代状态库内部都用它。
  **难度:** d4
  **EN:** useSyncExternalStore prevents tearing, where one render reads two different versions of an external store.

- **Q:** 为什么 server state 和 client state 要分开管?
  **A:** 因为性质完全不同:服务端数据是远端的本地缓存,会过期、会失败、需要重试、去重、失效重取、后台刷新;
  客户端 UI 状态(弹窗开没开、当前 tab)没有这些属性。
  用 useState + useEffect 手写服务端状态,最后一定是在重新发明一个更差的 react-query,而且往往漏掉 race condition。
  我的控制台就是这样分层:server state 交给 @tanstack/react-query,client state 留给 useState 和少量 context。
  **难度:** d1
  **EN:** Server state is a cache with staleness and retries; UI state is not, so they need different tools.

- **Q:** 你的 RN 应用是 offline-first,这时"真源"在哪里?React state 扮演什么角色?
  **A:** 真源是本地持久化(AsyncStorage)加一条事件队列,不是内存里的 React state。
  打完分先落盘让 UI 立刻正确,再把带 eventId 的事件入队,push 时服务端用 eventId 幂等去重并返回 duplicateEventIds,客户端凭这个才敢删队列项。
  React state 在这套结构里只是本地数据的一层投影,UI 永远不等网络,一致性靠最终一致加幂等重放来保证。
  **难度:** d1
  **EN:** In an offline-first app the local store is the source of truth and React state is only a projection of it.

- **Q:** 为什么 offline-first 队列里每个事件都要带一个 eventId?
  **A:** 因为网络重试和应用被杀会导致同一个事件被重复投递,没有幂等键的话进度会被重复应用。
  eventId 让服务端可以识别重复并返回 duplicateEventIds,客户端据此安全地从队列删除,
  这样"至少一次投递"就被收敛成了"效果上恰好一次"。
  这跟我后端里 recallsmith 的 event_id 幂等和 Reply In My Voice 的 Stripe 幂等计费是同一个模式。
  **难度:** d1
  **EN:** An event id turns at-least-once delivery into effectively-once processing.

- **Q:** 选状态方案的默认顺序是什么?
  **A:** 先 useState 放在最低的那一层,不够就提升到共同父组件,迁移有规则就换 useReducer,
  跨层且变化不频繁才上 context,高频或需要细粒度订阅才上外部 store,服务端数据一律走 query 库。
  核心原则是给每份数据找它能住的最低楼层:往上抬一层就多一批被牵连重渲染的组件。
  **难度:** d0
  **EN:** Keep every piece of state at the lowest level that still works.

---

## 7. TypeScript in React

### 概念讲解

**Mental model 一句话**:TS 在 React 里的最大价值不是"给 props 加类型注释",
而是**用类型把不可能的状态变成不可表达的状态**(make illegal states unrepresentable)。
一个建模良好的类型,能让一整类 bug 在编译期就不存在。

**props 类型:实践约定。**
- 用 `type` 还是 `interface` 都行,团队一致即可;`type` 更适合联合类型,`interface` 支持声明合并。
- **不要用 `React.FC`**。它的历史问题是隐式加了 `children`(现在已移除,但仍然让泛型组件写起来更别扭),
  直接写 `function Button(props: ButtonProps)` 更简单也更好推断。
- children 就显式写:`children?: React.ReactNode`。
- 想继承原生元素属性,用 `React.ComponentProps<'button'>`:
  `type ButtonProps = React.ComponentProps<'button'> & { variant: 'primary' | 'ghost' }`。
  这样 `onClick`、`disabled`、`aria-*` 全都自动有了,不必手抄。
- 事件类型不要写 `any`:`React.ChangeEvent<HTMLInputElement>`、`React.MouseEvent<HTMLButtonElement>`。
- 字面量联合优于 string:`variant: 'primary' | 'ghost'` 让拼错在编译期就报错,还能自动补全。

**泛型组件。**
需求场景是"容器不关心元素类型,但要把类型透传出去",典型是列表:

```tsx
type ListProps<T> = {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
};
function List<T>({ items, keyOf, renderItem }: ListProps<T>) {
  return <ul>{items.map(i => <li key={keyOf(i)}>{renderItem(i)}</li>)}</ul>;
}
```

调用时 TS 会从 `items` 推断出 `T`,`renderItem` 的参数自动有类型,不需要手写 `<List<Deck> ...>`。
**`.tsx` 里的坑**:箭头函数写 `const List = <T>(props) => ...` 会被解析成 JSX 标签,
要写成 `<T,>` 或 `<T extends unknown>` 来消歧义。用 `function` 声明就没这个问题。

**判别联合建模 UI 状态(本模块最重要的一节)。**
反面教材是"布尔标志包":

```ts
type State = { isLoading: boolean; data?: Deck[]; error?: Error };
```

它能表达 `isLoading: true` 同时 `error` 有值同时 `data` 有值这种根本不该存在的组合,
于是你的渲染分支要靠一串 if 猜谁优先,而且每加一个字段组合就多一类边界 bug。

判别联合把状态空间收敛成有限且互斥的几个:

```ts
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: Deck[] }
  | { status: 'error'; error: Error };
```

三个收益,面试要说全:
1. **不可能的状态不可表达**,loading 和 error 不会同时成立;
2. **收窄(narrowing)**:`if (s.status === 'success')` 之后 `s.data` 一定存在,不用 `!` 或可选链;
3. **穷尽检查**:`switch` 的 `default` 分支里写 `const _never: never = s`,以后新增一个 status 忘了处理,**编译期就报错**。

你的 `deckActionResolver.ts` 里的 `DeckAction` 就是这个形态:
`{ kind: 'open'; slug }` / `{ kind: 'install'; slug; remoteUrl; remoteVersion; remoteSha256 }` / `'update'` / `'trial-start'` / `'paywall'` / `'none'`。
注意它的精妙处:**只有需要下载的那几个分支才带 `remoteUrl` 这组字段**,
`'open'` 和 `'paywall'` 分支里这些字段压根不存在,所以"想 open 却去读 remoteUrl"这种代码根本编译不过。
这正是判别联合的价值:字段的存在性本身携带了业务含义。

对照着看 `review/model.ts` 里的 `CardProgress`:它是一个**可选字段包**
(`lastReviewedAt?`、`lapses?`、`hardStreak?`、`revisionDemotedAt?`)。
这不是错,它是一个**持久化数据结构**,可选是为了兼容老版本写下的行、以及减小存储体积,
而且合并逻辑(per-column LWW)本来就要逐字段处理。
但把它直接摊到 UI 层就是错的:**持久化模型该用可选字段包容历史,视图模型该用判别联合排除歧义**,
中间靠 selector(`progressSelectors.ts` 那一层)做转换。能把这个取舍讲清楚,比背判别联合定义有用得多。

**其他实用点**:
- `as const` 把字面量数组/对象锁成字面量类型,配合联合类型很好用。
- 尽量少用 `as`:类型断言是关掉检查,不是解决问题。真正需要的是类型守卫函数(`x is Foo`)。
- `useState<Deck | null>(null)` 要显式给泛型,否则会被推断成 `null`。
- `useRef` 的类型在 React 19 的 `@types/react` 里被统一了:所有重载都返回 `RefObject<T>`,`current` 一律可写,
  `MutableRefObject` 已被标记弃用。所以旧文章里"传 null 得到只读 RefObject、传初始值得到可写 MutableRefObject"
  这条区分,在你的项目(frontend 和 mobile 都是 React 19)里已经不成立。
  现在真正要留意的是**推断出的类型里带不带 `null`**:`useRef<HTMLInputElement>(null)` 是 `RefObject<HTMLInputElement | null>`,
  读 `current` 必须先判空;`useRef<number[]>([])` 是 `RefObject<number[]>`,可以直接 push
  (你在 `DrawCeremonyScreen` 里收集 timer id 就是这一种)。
- React 19 起 `ref` 可以直接作为 props 传给函数组件,不再必须 `forwardRef`(旧代码里的 forwardRef 仍然有效)。

### 卡片素材(手动录入用)

- **Q:** 用 `{ isLoading: boolean; data?: T[]; error?: Error }` 建模请求状态有什么问题?
  **A:** 它允许不可能的组合:loading 为 true 的同时 error 和 data 都有值。
  于是渲染分支要靠一串 if 猜优先级,每加一个字段就多一类边界 bug,而且 `data` 永远是可选的,到处要写可选链或非空断言。
  换成 `status` 判别联合后,状态空间收敛成互斥的几个,收窄之后 data 一定存在。
  **难度:** d1
  **EN:** Boolean flag bags allow impossible combinations; a discriminated union makes them unrepresentable.

- **Q:** 判别联合除了"防止非法状态",还带来哪两个实际好处?
  **A:** 一是收窄:`if (s.status === 'success')` 之后 TS 知道 `s.data` 一定存在,不需要 `!` 或可选链;
  二是穷尽检查:在 switch 的 default 分支写 `const _never: never = s`,以后新增一个 status 却忘了处理,编译期直接报错。
  第二条在长期维护里价值最大,它把"加状态忘了改 UI"这类回归变成编译错误。
  **难度:** d2
  **EN:** Discriminated unions give you narrowing for free and exhaustiveness checks at compile time.

- **Q:** 你项目里的 `DeckAction` 联合,为什么把 `remoteUrl` 只放在部分分支里?
  **A:** 因为字段的存在性本身在表达业务规则:只有 install / update / trial-start 这几个需要下载的分支才有 remoteUrl、remoteVersion、remoteSha256,
  `open` 和 `paywall` 分支里这些字段根本不存在。
  于是"在 open 分支里去读 remoteUrl"这种代码编译不过,不需要靠运行时断言或 code review 兜底。
  如果把所有字段拍平成可选,这层保护就没了。
  **难度:** d3
  **EN:** Putting fields only on the branches that need them lets the compiler enforce the business rule.

- **Q:** 为什么 `CardProgress` 用可选字段而不是判别联合?这是不是不一致?
  **A:** 不是不一致,是分层不同。CardProgress 是持久化模型,可选字段用来兼容老版本写下的行、控制存储体积,而且它的合并逻辑本来就是逐字段处理。
  判别联合适合的是视图模型:UI 需要的是互斥且无歧义的状态。
  正确做法是持久化层保留可选字段包容历史,selector 层转换成判别联合再给 UI,而不是把存储结构直接摊给组件。
  **难度:** d3
  **EN:** Persistence models tolerate history with optional fields; view models should be unions that remove ambiguity.

- **Q:** 在 `.tsx` 里写泛型箭头函数组件为什么会报错?怎么写?
  **A:** 因为 `<T>` 会被解析器当成 JSX 标签的开头。
  解决办法是写成 `<T,>` 加一个逗号,或者 `<T extends unknown>`,都是给解析器消歧义;
  更省事的是直接用 `function List<T>(props: ListProps<T>)` 函数声明,函数声明没有这个歧义。
  **难度:** d1
  **EN:** In .tsx a lone type parameter looks like JSX, so write it as a trailing-comma generic or use a function declaration.

- **Q:** 为什么现在不推荐用 `React.FC`?
  **A:** 主要是它没带来什么价值却增加约束:历史上它隐式加了 `children`(导致不接受 children 的组件也能传),
  写泛型组件时也更别扭,而直接 `function Button(props: ButtonProps)` 推断更自然、返回类型也更灵活。
  需要 children 就显式写 `children?: React.ReactNode`,意图更清楚。
  **难度:** d1
  **EN:** Prefer a plain typed function over React.FC; it infers better and states children explicitly.

- **Q:** 想让自定义 Button 支持所有原生 button 属性,怎么写类型?
  **A:** `type ButtonProps = React.ComponentProps<'button'> & { variant: 'primary' | 'ghost' }`,然后把剩余属性展开到元素上。
  这样 onClick、disabled、type、aria-* 全都自动继承,不用手抄也不会漏,原生属性升级时类型跟着走。
  variant 用字面量联合而不是 string,拼错在编译期就报错,还能自动补全。
  **难度:** d1
  **EN:** Extend ComponentProps of the underlying element instead of re-declaring native props by hand.

- **Q:** `useState(null)` 之后 `setUser(user)` 报类型错,为什么?
  **A:** 因为 TS 从初始值把类型推断成了 `null`,后面赋别的类型自然不合法。
  显式给泛型:`useState<User | null>(null)`。
  同类问题还有 `useState([])` 被推成 `never[]`,要写 `useState<Deck[]>([])`。
  规律是:初始值不足以代表完整状态空间时,必须手动给类型参数。
  **难度:** d0
  **EN:** When the initial value does not represent the full state space, annotate the useState generic.

- **Q:** `useRef<HTMLInputElement>(null)` 和 `useRef<number[]>([])` 拿到的类型差在哪?旧文章说的"只读 RefObject vs 可写 MutableRefObject"现在还成立吗?
  **A:** 不成立了。React 19 的 `@types/react` 把 useRef 的重载统一成返回 `RefObject<T>`,`current` 一律可写,`MutableRefObject` 已被弃用。
  现在真正的差别只剩类型里带不带 null:传 `null` 得到 `RefObject<HTMLInputElement | null>`,每次读 `current` 都要判空;
  传 `[]` 得到 `RefObject<number[]>`,可以直接 push,我在 DrawCeremonyScreen 里收集 timer id 用的就是后者。
  能指出"这条规则随类型定义改过"本身就比背旧结论强。
  **难度:** d2
  **EN:** In React 19 typings useRef always returns a writable RefObject, so the only real difference left is whether null is part of the type.

- **Q:** 为什么应该少用 `as` 断言?替代方案是什么?
  **A:** 因为 `as` 是关掉检查而不是解决问题:你在向编译器保证一件它无法验证的事,保证错了就是运行时崩溃,而且以后类型改了它也不会报错。
  替代方案是类型守卫函数(`function isDeck(x: unknown): x is Deck`)、判别联合的收窄、或者在边界处做真正的运行时校验(比如 zod)。
  唯一比较正当的 as 用法是 `as const` 和确实无法表达的窄化,并且要在旁边写清理由。
  **难度:** d1
  **EN:** A type assertion silences the checker instead of proving anything, so prefer type guards.

---

## 8. 面试高频:SPA 路由、错误边界、SSR

### 概念讲解

#### SPA 路由原理

**Mental model 一句话**:SPA 路由是"**假装导航**":URL 变了,但浏览器没有向服务器要新文档,
是 JS 拦下这次导航、改了地址栏、然后渲染另一棵组件树。

机制拆开就三件事:
1. **改地址栏不刷新页面**:`history.pushState(state, '', '/decks/42')`。它改 URL 和历史栈,但不发请求。
2. **响应前进后退**:用户点浏览器返回时触发 `popstate` 事件,路由器监听它,重新匹配路径并渲染。
   (注意:`pushState` 自己不会触发 `popstate`,所以路由库需要在 push 的同时自己通知订阅者。)
3. **路径 → 组件的匹配**:把当前 pathname 拿去和路由表匹配,解析出参数(`/decks/:slug`),渲染对应的组件树。
   react-router v6/v7 的嵌套路由 + `<Outlet/>` 就是让"布局"和"页面"分层匹配。

**部署时必踩的坑**:直接访问 `/decks/42` 或者刷新页面,请求真的会打到服务器,而服务器上并没有这个文件,于是 404。
解法是服务器把所有未匹配路径都回退到 `index.html`(SPA fallback),让前端路由接管。
S3 + CloudFront 上就是配置错误页回退到 index.html。这一条在面试里被问到的频率很高,因为它证明你真的部署过。

**hash 路由 vs history 路由**:`/#/decks/42` 不需要服务器配置(hash 部分不会发给服务器),
代价是 URL 难看、SEO 差。能配服务器就用 history 模式。

**其他要点**:代码分割(`React.lazy` + `Suspense`)通常按路由切,首屏只下载当前路由的 chunk;
路由切换时要处理滚动位置恢复和焦点管理(无障碍),这两点是"做过真项目"的信号。

#### 错误边界(Error Boundary)

**Mental model 一句话**:错误边界是组件树里的 try/catch,catch 住的是**子树在渲染期抛出的错误**,
把整页白屏降级成局部的兜底 UI。

要点:
- **必须是 class 组件**(实现 `static getDerivedStateFromError` 用来渲染降级 UI,`componentDidCatch` 用来上报日志)。
  没有等价的官方 hook,实践中直接用 `react-error-boundary` 这类封装。
- **它捕获不到**:事件处理函数里的错误、异步代码(setTimeout / Promise)里的错误、服务端渲染过程中的错误、以及边界组件**自己**抛的错误。
  原因是它挂在 React 的渲染/提交生命周期上,而事件回调和异步任务不在那条链上。事件里的错误就老老实实 try/catch。
  (SSR 那条要说准一点:服务端渲染的错误由渲染 API 自己的 `onError` 回调上报,
  流式 SSR 下客户端可以在 hydration 时重新渲染那棵子树,这时客户端的错误边界才会参与。)
- **为什么需要它**:React 16 起,渲染期未捕获的错误会**卸载整棵树**(设计判断是:显示错乱的 UI 比空白更危险,比如转账页面显示错金额)。
  所以不放边界就是白屏。
- **放哪里**:按"失败域"放。整个 app 一个兜底,每个路由一个,风险高的 widget(图表、第三方嵌入、你的 ceremony 动画)单独一个,
  这样一个 widget 崩了不会把整页带走。
- **配套**:降级 UI 里给一个"重试"按钮,内部通过换 key 重挂子树来恢复。
- React 19 补充了 root 级别的 `onCaughtError` / `onUncaughtError` 回调,便于统一上报,但边界组件本身仍然是 class。

#### SSR 概念一页

**几个名词先分清**(面试最常混):
- **CSR**:服务器只给一个空 HTML + JS bundle,浏览器下载执行后才有内容。首屏慢,SEO 差,部署简单。
- **SSR**:服务器为这次请求执行组件、生成 HTML 发给浏览器,用户很快看到内容;
  然后浏览器下载 JS 做 **hydration**(把事件监听和状态"接"到已有 DOM 上),页面才可交互。
- **SSG**:构建期就把 HTML 生成好,请求时直接发静态文件。最快,但内容必须在构建时已知。
- **ISR / 增量再生成**:SSG 加上按需或定时的后台再生成。
- **RSC(React Server Components)**:和 SSR 不是一回事。SSR 是"在服务器上把组件渲染成 HTML 字符串",
  RSC 是"某些组件**永远只在服务器上运行**,它们的产物以特殊格式传给客户端,代码不进 bundle"。
  RSC 的收益是减少 bundle 体积和让数据获取贴近数据源,SSR 的收益是首屏 HTML。两者常一起用。

**hydration 的坑**:服务端渲染出的 HTML 必须和客户端首次渲染的结果一致,不一致就是 **hydration mismatch**。
典型原因是渲染期用了 `Date.now()`、`Math.random()`、`window`、`localStorage`、或者时区/语言相关的格式化。
修法是把这类"只有客户端知道的东西"推迟到 effect 里,或者显式标记该节点抑制警告。

**什么时候不需要 SSR**:登录后才能访问的后台管理系统(不需要 SEO,首屏多几百毫秒无所谓)完全可以纯 CSR。
你的控制台就是这一类,用 Vite 打 CSR 包是正确取舍,不要为了"听起来先进"上 SSR。
**什么时候需要**:面向公众、要 SEO、要社交分享预览、首屏速度直接影响转化的页面(落地页、内容页、电商)。

### 卡片素材(手动录入用)

- **Q:** SPA 路由是怎么做到"URL 变了但页面没刷新"的?
  **A:** 靠 History API:`history.pushState` 改地址栏和历史栈但不发请求,路由器再根据新 pathname 匹配路由表、渲染另一棵组件树。
  前进后退通过监听 `popstate` 事件处理。
  注意 pushState 本身不会触发 popstate,所以路由库要在 push 的同时自己通知订阅者重新渲染。
  **难度:** d1
  **EN:** SPA routing uses pushState to change the URL without a request, then re-renders based on the new path.

- **Q:** SPA 部署后,直接访问 `/decks/42` 报 404,为什么?怎么修?
  **A:** 因为刷新或直接访问是真的向服务器请求那个路径,而服务器上只有 index.html,没有这个文件。
  修法是配置 SPA fallback:所有未匹配的路径都返回 index.html,让前端路由接管。
  静态托管上就是把 404 回退到 index.html(S3 + CloudFront 的错误页回退就是这么配的)。
  用 hash 路由可以绕过,代价是 URL 难看且 SEO 差。
  **难度:** d1
  **EN:** The server must fall back to index.html for unknown paths so the client router can take over.

- **Q:** 错误边界捕获不到哪些错误?为什么?
  **A:** 捕获不到事件处理函数里的错误、异步代码(setTimeout、Promise)里的错误、服务端渲染过程中的错误,以及边界自己抛出的错误。
  原因是它挂在 React 的渲染和提交生命周期上,事件回调和异步任务不在那条调用链里,React 无从拦截。
  事件里的错误就用普通 try/catch,异步的用 catch 后 setState 进入错误状态;
  SSR 的错误走渲染 API 的 onError 回调,客户端在 hydration 重新渲染那棵子树时边界才接得住。
  **难度:** d1
  **EN:** Error boundaries only catch errors thrown during rendering, not in event handlers or async code.

- **Q:** 如果不放错误边界,一个子组件渲染时抛错会怎样?这个设计的理由是什么?
  **A:** React 16 起会卸载整棵组件树,用户看到白屏。
  理由是 React 团队认为**显示错乱的 UI 比什么都不显示更危险**:一个渲染失败的转账页面可能显示错误金额并让用户点确认。
  所以正确做法是按失败域布置边界:整个 app 一个兜底,每个路由一个,高风险 widget 单独一个,让局部失败只降级局部。
  **难度:** d2
  **EN:** React unmounts the whole tree on an uncaught render error because a corrupted UI is worse than none.

- **Q:** 错误边界为什么必须是 class 组件?
  **A:** 因为它依赖两个只有类组件才有的生命周期:`static getDerivedStateFromError` 用来切换到降级 UI,`componentDidCatch` 用来上报错误。
  目前没有等价的官方 hook,所以实践中要么自己写一个薄薄的 class,要么用 react-error-boundary 这类封装。
  React 19 额外提供了 root 级的 onCaughtError / onUncaughtError 便于统一上报,但边界本身仍然是 class。
  **难度:** d1
  **EN:** Error boundaries need getDerivedStateFromError and componentDidCatch, which have no hook equivalent.

- **Q:** SSR 和 CSR 各自的取舍是什么?你的管理控制台为什么不用 SSR?
  **A:** SSR 首屏快、能被爬虫抓到内容,代价是需要一个 Node 服务、要处理 hydration 一致性、复杂度和运维成本都上升;
  CSR 部署简单(一份静态文件),代价是首屏白屏时间和 SEO。
  我的控制台是登录后才能访问的内部工具,不需要 SEO,首屏多几百毫秒无所谓,所以用 Vite 打纯 CSR 包是正确取舍。
  为了"听起来先进"上 SSR 是在给自己加运维负担。
  **难度:** d1
  **EN:** SSR buys first paint and SEO at the cost of a server and hydration complexity, which an internal console does not need.

- **Q:** hydration 是什么?什么情况下会 mismatch?
  **A:** hydration 是浏览器拿到服务端生成的 HTML 后,下载 JS 并把事件监听和组件状态"接"到已有 DOM 上,让静态 HTML 变成可交互页面。
  mismatch 指客户端首次渲染的结果和服务端 HTML 不一致,常见原因是渲染期用了 `Date.now()`、`Math.random()`、`window`、`localStorage`、或时区相关的格式化。
  修法是把只有客户端知道的信息推迟到 effect 里再渲染。
  **难度:** d2
  **EN:** Hydration attaches interactivity to server HTML, and it breaks when the client renders something different.

- **Q:** React Server Components 和 SSR 是一回事吗?
  **A:** 不是。SSR 是"在服务器上把组件渲染成 HTML 字符串"来解决首屏;
  RSC 是"某些组件只在服务器上运行",它们的代码不进客户端 bundle,产物以特殊格式传给客户端。
  RSC 解决的是 bundle 体积和数据获取贴近数据源,SSR 解决的是首屏 HTML,两者常一起用但目标不同。
  面试里把这两个说成同一个东西是常见减分点。
  **难度:** d3
  **EN:** SSR renders components to HTML per request; RSC keeps certain components off the client bundle entirely.

- **Q:** 代码分割通常按什么维度切?配什么 API?
  **A:** 通常按路由切:首屏只下载当前路由的 chunk,其余路由在导航时按需加载。
  API 是 `React.lazy(() => import('./Page'))` 配 `<Suspense fallback={...}>`,打包器据此自动分包。
  次要维度是把很重且不常用的组件(富文本编辑器、图表库、扫码)单独切出去。
  代价是首次进入某路由会有一次加载等待,所以要配 fallback 骨架屏,必要时做预加载。
  **难度:** d1
  **EN:** Split by route with React.lazy and Suspense so the first load ships only the current page.

- **Q:** 路由切换时有哪两件容易被忽略但面试加分的事?
  **A:** 滚动位置和焦点管理。默认情况下切页后滚动位置可能停在上一页的位置,需要显式滚到顶部或恢复上次位置;
  焦点则应该移到新页面的主标题或主内容区,否则键盘和读屏用户会"卡在"旧页面的 DOM 位置。
  这两点是真的做过完整项目才会提到的细节,也是无障碍的基本要求。
  **难度:** d1
  **EN:** After a route change, reset scroll position and move focus to the new page's heading.

---

## 快速自测:能否不看文档讲清这十条

1. re-render 的三个触发来源,以及"props 变了所以子渲染"错在哪。
2. 为什么必须不可变更新(答到并发渲染那一层)。
3. 依赖数组的真实语义,以及为什么内联对象放进去等于没写。
4. cleanup 的两个执行时机,以及 StrictMode 双跑该怎么应对。
5. 三个"不该用 useEffect"的场景,以及各自的替代方案。
6. key 是身份不是性能,以及 index as key 什么时候会出错。
7. memo / useMemo / useCallback 各保护什么,以及反优化的两个例子。
8. context 的重渲染代价,以及按变化频率拆分和 state/dispatch 拆分。
9. 判别联合给你的三个好处,以及为什么持久化模型可以用可选字段包。
10. SPA fallback、错误边界抓不到什么、SSR 和 RSC 的区别。
