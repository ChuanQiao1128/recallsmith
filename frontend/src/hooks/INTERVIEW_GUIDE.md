# 自定义 Hooks 面试指南

## 快速索引

| Hook | 核心亮点 | 面试关键词 |
|------|----------|-----------|
| `useLocalStorage` | 跨标签页同步、SSR 兼容 | useSyncExternalStore |
| `useDebounce` | 竞态处理、leading/trailing | 闭包、定时器清理 |
| `useAsync` | 完整状态机、自动重试 | AbortController、竞态 |
| `usePrevious` | ref vs state 时序 | 生命周期理解 |
| `useIntersectionObserver` | 性能优化、懒加载 | Observer API、rootMargin |

---

## 1. useLocalStorage

### 面试问题：怎么实现 localStorage 的跨标签页同步？

**回答要点：**
```typescript
// 使用 useSyncExternalStore 监听 storage 事件
const subscribe = (callback) => {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
};
```

**加分点：**
- SSR 兼容：服务端返回默认值，不报错
- 错误处理：隐私模式下 localStorage 可能不可用
- 自定义序列化：支持 Date、Map 等复杂类型

---

## 2. useDebounce

### 面试问题：防抖和节流的区别？手写防抖？

**回答要点：**
- **防抖（Debounce）**：事件停止触发后，延迟执行（搜索框）
- **节流（Throttle）**：固定时间间隔执行（滚动事件）

**实现亮点：**
```typescript
// 使用 useRef 保存定时器，避免闭包问题
const timeoutRef = useRef<NodeJS.Timeout | null>(null);

// 组件卸载时清理
useEffect(() => {
  return () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };
}, []);
```

---

## 3. useAsync

### 面试问题：怎么处理多个并发请求的竞争问题？

**回答要点：**
```typescript
// 使用执行 ID 追踪最新请求
const executionIdRef = useRef(0);

const execute = async (...params) => {
  executionIdRef.current += 1;
  const currentExecutionId = executionIdRef.current;
  
  try {
    const result = await asyncFunction(...params);
    
    // 检查是否是最新请求
    if (currentExecutionId !== executionIdRef.current) {
      throw new Error('Request superseded');
    }
    
    return result;
  } catch (error) {
    // 处理错误...
  }
};
```

**加分点：**
- AbortController 取消请求
- 自动重试 + 指数退避
- 完整的状态机（idle/loading/success/error）

---

## 4. usePrevious

### 面试问题：useRef 和 useState 的区别？

**回答要点：**
| 特性 | useState | useRef |
|------|----------|--------|
| 触发重渲染 | ✅ 会 | ❌ 不会 |
| 使用场景 | UI 相关数据 | DOM 引用、缓存值 |
| 更新时机 | 异步批量更新 | 同步立即更新 |

**usePrevious 的实现原理：**
```typescript
// 渲染时读取，渲染后更新（useEffect）
const prevValue = ref.current;  // 读上一次的值
useEffect(() => {
  ref.current = value;  // 保存当前值供下次使用
}, [value]);
return prevValue;
```

---

## 5. useIntersectionObserver

### 面试问题：图片懒加载怎么实现？

**回答要点：**
```typescript
// 传统方式：scroll 事件 + getBoundingClientRect
// 问题：频繁触发，强制重排，性能差

// 现代方式：IntersectionObserver
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      // 加载图片
      entry.target.src = realSrc;
      observer.unobserve(entry.target);
    }
  });
}, { rootMargin: '100px' });  // 提前 100px 开始加载
```

**加分点：**
- rootMargin 实现预加载
- triggerOnce 只触发一次
- 配合 requestAnimationFrame 做动画

---

## 面试话术模板

### 开场白
> "我在项目中封装了一套自定义 Hooks 来解决常见的状态管理问题。比如..."

### 展示复杂度
> "这个 Hook 不只处理了基础功能，还考虑了边界情况："
> - "SSR 环境下不会报错"
> - "组件卸载时自动清理，防止内存泄漏"
> - "支持竞态请求的处理"

### 结合实际场景
> "在 XX 项目中，我们有一个搜索框，用户输入时会产生大量请求。使用防抖后，API 调用减少了 80%，服务器压力大大降低。"

---

## 可能的追问

### Q: 这些 Hooks 怎么测试？
**A:** 
```typescript
// 使用 React Testing Library
const { result } = renderHook(() => useDebounce('test', 500));

// 等待防抖时间
await waitFor(() => expect(result.current).toBe('test'), { timeout: 600 });
```

### Q: 和第三方库（ahooks、react-use）有什么区别？
**A:** 
> "业务初期我们评估过这些库，但为了更好的可控性和定制化，选择自行封装。比如我们的 useLocalStorage 加入了业务特定的加密逻辑，第三方库无法直接满足。"

### Q: 怎么保证这些 Hooks 的性能？
**A:** 
> "使用 useMemo/useCallback 缓存函数和值，避免不必要的重渲染。对于复杂计算，使用 useMemo 缓存结果。"
