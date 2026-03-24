# RecallSmith 抽卡游戏化系统设计文档

> 版本: 1.0  
> 最后更新: 2026-03-24  
> 状态: 设计完成，待实施

---

## 📌 设计原则

### 核心定位
**学习激励系统**，不是氪金赌博系统。抽卡 = 解锁新知识点，稀有度 = 知识点难度可视化。

### 关键决策
| 决策 | 选择 | 理由 |
|------|------|------|
| 稀有度映射 | Difficulty 1→Common, 2→Rare, 3→Epic | 简单直接，无需额外配置 |
| 重复卡片 | ❌ 不存在 | 从剩余池抽，保证每次都有新内容 |
| 抽卡券 | 通用（所有卡组共享） | 用户体验简单，策略灵活 |
| 限时卡池 | ❌ 暂不实现 | 保持系统简单，MVP后考虑 |
| 抽卡冷却 | ❌ 无冷却 | 有券就能抽，减少摩擦 |
| 卡片升级 | ❌ 不实现 | 简化系统，专注学习 |

---

## 🎮 核心机制

### 1. 稀有度系统

```
⭐ Common (普通)     Difficulty 1    70% 掉率    灰/白色调
⭐⭐ Rare (稀有)     Difficulty 2    25% 掉率    蓝/青色调  
⭐⭐⭐ Epic (史诗)    Difficulty 3    5% 掉率     金/紫色调
```

**150张卡组分布参考：**
- Common: ~105张 (70%)
- Rare: ~38张 (25%)
- Epic: ~7张 (5%)

### 2. 双券系统

```
🎫 单抽券 (x1)
├── 每日登录：3张（免费用户）/ 5张（Premium）
├── 连续7天登录：额外获得1张十连券
├── 新卡组安装：10张（免费）/ 20张（Premium）
├── 代码币购买：100💎/张
└── 合成：10张单抽券 → 1张十连券

🎫🎫 十连券 (x10)
├── 合成获得：10张单抽券兑换
├── 连续7天登录奖励
├── 代码币购买：900💎（9折优惠）
└── 保底机制：第10张必出 Rare+（免费第10张，Premium第8张）
```

### 3. 代码币经济系统

**💎 获得途径（全部与学习行为挂钩）：**

| 行为 | 奖励 | 每日上限 | 备注 |
|------|------|---------|------|
| 完成每日复习（所有due卡片）| +50💎 | 1次 | 主要来源 |
| 单张卡片首次学习完成 | +5💎 | 无上限 | 鼓励解锁新卡 |
| 连续学习7天 | +100💎 | 每周1次 | 留存激励 |
| 首次分享卡组 | +30💎 | 一次性 | 社交传播 |
| 成就：收集10张 | +50💎 | 一次性 | 早期成就感 |
| 成就：收集50张 | +200💎 | 一次性 | 中期目标 |
| 成就：收集100张 | +500💎 | 一次性 | 长期目标 |
| 集齐卡组150张 | +1000💎 | 一次性 | 大师成就 |

**💎 消费途径：**

| 项目 | 价格 | 说明 |
|------|------|------|
| 单抽券 | 100💎 | 基础消费 |
| 十连券 | 900💎 | 9折优惠，鼓励攒券 |
| 重新激活卡片 | 200💎 | Premium专属，见下文 |

### 4. Premium 特权（非万能）

**设计原则：Premium 是"加速器"，不是"万能钥匙"**

| 特权 | 免费用户 | Premium | 说明 |
|------|---------|---------|------|
| 每日免费抽 | 3张 | 5张 | 多一点，但不是碾压 |
| 新卡组初始 | 10张 | 20张 | 起步更快 |
| 十连保底 | 第10张必Rare+ | 第8张必Rare+ | 体验更好 |
| **重新激活** | ❌ | ✅ | 可解锁"已抽到过但跳过"的卡片 |
| 硬保底计数 | 30抽 | 25抽 | 更快获得Epic |

**关键限制：重新激活只能解锁"已抽到过"的卡片！**

```
场景示例：
1. 用户抽到了 "闭包" 卡片（Epic）
2. 觉得太难，选择"暂时跳过"
3. 之后想学了，花200💎重新激活
4. ❌ 不能花💎直接解锁没抽过的 "原型链" 卡片
```

### 5. 保底机制

```
软保底（十连）：
├── 免费用户：第10张必出 Rare 或 Epic
└── Premium用户：第8张必出 Rare 或 Epic

硬保底（史诗）：
├── 阈值：30抽（Premium 25抽）
├── 计数器：距离上次 Epic 的抽数
└── 触发：如果计数≥阈值，下次必出 Epic

动态概率（接近保底时）：
├── 20抽未出Epic：Epic概率提升至10%
├── 25抽未出Epic：Epic概率提升至20%
└── 30抽未出Epic：Epic概率100%
```

### 6. 无重复抽卡机制

```
核心规则：
1. 抽卡池 = 卡组总卡片 - 已解锁卡片
2. 每次抽取从剩余池中按稀有度概率选择
3. 卡组全部解锁后，抽卡按钮消失，显示"卡组已完成 🎉"

概率计算公式：
- 根据剩余各稀有度卡片数量动态调整
- 保持总体感觉：Common 70%, Rare 25%, Epic 5%
- 某稀有度抽完后，概率重新分配到其他稀有度

示例：
初始：150张（105C + 38R + 7E）
抽了50张后：剩余100张（假设 60C + 32R + 8E 已抽完）
实际概率：Common 60%, Rare 32%, Epic 8%
```

---

## 🗄️ 数据模型

### 1. Card 表（现有，新增字段）

```typescript
// 在 deck.json 中，无需后端存储
interface CardExport {
  StableUid: string;
  Difficulty: 1 | 2 | 3;           // 现有
  Rarity: 'common' | 'rare' | 'epic';  // 🆕 可由 Difficulty 映射，也可显式设置
  OrderInDeck: number;
  Question: string;
  Explanation?: string;
  CodeSnippet?: string;
  // ... 其他现有字段
}

// 映射规则（后端/移动端实现）
const difficultyToRarity = {
  1: 'common',
  2: 'rare', 
  3: 'epic'
} as const;
```

### 2. UserCardUnlock 表（🆕 新增）

**PostgreSQL 方案：**

```sql
CREATE TABLE user_card_unlocks (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    deck_slug VARCHAR(100) NOT NULL,
    stable_uid VARCHAR(100) NOT NULL,
    
    -- 解锁信息
    unlocked_at TIMESTAMP DEFAULT NOW(),
    unlock_source VARCHAR(50) DEFAULT 'draw',  -- 'draw', 'reactivate', 'initial', 'event'
    
    -- 跳过/重新激活相关
    skipped_at TIMESTAMP NULL,                 -- 用户选择跳过的时间
    reactivated_at TIMESTAMP NULL,             -- Premium用户重新激活时间
    reactivate_cost INT NULL,                  -- 重新激活花费的代码币
    
    -- 元数据
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- 唯一约束：用户+卡组+卡片唯一
    UNIQUE(user_id, deck_slug, stable_uid)
);

-- 索引
CREATE INDEX idx_user_deck ON user_card_unlocks(user_id, deck_slug);
CREATE INDEX idx_unlocked_at ON user_card_unlocks(user_id, deck_slug, unlocked_at);
```

**DynamoDB 方案：**

```yaml
TableName: UserCardUnlocks

主键设计：
  PK: USER#{userId}
  SK: DECK#{deckSlug}#CARD#{stableUid}

属性：
  - unlockedAt: Number (timestamp)
  - unlockSource: String
  - skippedAt: Number (optional)
  - reactivatedAt: Number (optional)

GSI（反向查询）：
  GSI1PK: DECK#{deckSlug}
  GSI1SK: USER#{userId}#CARD#{stableUid}
```

### 3. UserGachaStats 表（🆕 新增）

**PostgreSQL：**

```sql
CREATE TABLE user_gacha_stats (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    
    -- 全局统计（跨所有卡组）
    total_draws INT DEFAULT 0,
    total_coins_earned INT DEFAULT 0,
    total_coins_spent INT DEFAULT 0,
    
    -- 硬保底计数（全局）
    pity_counter INT DEFAULT 0,           -- 距离上次Epic的抽数
    last_epic_at TIMESTAMP NULL,
    
    -- 每日记录
    last_daily_claim_date DATE NULL,      -- 上次领取每日奖励的日期
    daily_streak INT DEFAULT 0,           -- 连续登录天数
    
    -- 时间戳
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id)
);
```

**DynamoDB：**

```yaml
TableName: UserGachaStats

主键：
  PK: USER#{userId}
  SK: STATS#gacha

属性：
  - totalDraws: Number
  - totalCoinsEarned: Number
  - totalCoinsSpent: Number
  - pityCounter: Number
  - lastEpicAt: Number (timestamp)
  - lastDailyClaimDate: String (YYYY-MM-DD)
  - dailyStreak: Number
```

### 4. 移动端本地存储（AsyncStorage）

```typescript
// 键名设计（带用户隔离）
const KEYS = {
  // 抽卡券（本地，不同步）
  TICKETS: (userSub: string) => `gacha:${userSub}:tickets`,
  
  // 代码币（本地缓存，服务端为准）
  COINS: (userSub: string) => `gacha:${userSub}:coins`,
  
  // 抽卡历史（本地缓存，最近50条）
  HISTORY: (userSub: string) => `gacha:${userSub}:history`,
  
  // 每日领取记录
  DAILY_CLAIM: (userSub: string) => `gacha:${userSub}:daily_claim`,
  
  // 已解锁卡片（服务端同步下来的缓存）
  UNLOCKED_CARDS: (userSub: string, deckSlug: string) => 
    `gacha:${userSub}:unlocked:${deckSlug}`,
};

// 数据结构
interface LocalGachaState {
  tickets: {
    single: number;
    ten: number;
  };
  coins: number;  // 本地缓存，启动时从服务端同步
  lastSyncAt: number;
}
```

---

## 🔌 API 设计

### 1. 抽卡 API

```http
POST /api/v1/gacha/draw
Authorization: Bearer {token}
Content-Type: application/json

Request:
{
  "deckSlug": "js-core-basics",
  "drawType": "single" | "ten",  // 单抽或十连
  "ticketType": "single" | "ten" // 使用什么券
}

Response:
{
  "success": true,
  "data": {
    "results": [
      {
        "stableUid": "js-core-basics-42",
        "rarity": "epic",
        "isNew": true,
        "card": { /* 完整卡片数据 */ }
      }
      // ... 十连时有10个
    ],
    "stats": {
      "pityCounter": 0,      // 本次抽卡后的保底计数
      "remainingCoins": 1250
    },
    "bonuses": {
      "pityTriggered": false,  // 是否触发了硬保底
      "guaranteeTriggered": true  // 是否触发了十连保底
    }
  }
}

Error Cases:
- 400: 券不足
- 400: 卡组已全部解锁
- 404: 卡组不存在
```

### 2. 获取用户解锁列表

```http
GET /api/v1/gacha/unlocks/{deckSlug}
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": {
    "deckSlug": "js-core-basics",
    "totalCards": 150,
    "unlockedCount": 45,
    "unlockedCards": [
      {
        "stableUid": "js-core-basics-1",
        "rarity": "common",
        "unlockedAt": "2026-03-24T10:30:00Z",
        "unlockSource": "draw",
        "skippedAt": null,
        "reactivatedAt": null
      }
      // ... 可能分页，但150张不多，可以全量
    ],
    "skippedCards": [  // 被跳过但可重新激活的（Premium）
      {
        "stableUid": "js-core-basics-42",
        "rarity": "epic",
        "unlockedAt": "2026-03-20T08:00:00Z",
        "skippedAt": "2026-03-20T08:05:00Z",
        "reactivateCost": 200
      }
    ]
  }
}
```

### 3. 重新激活卡片（Premium）

```http
POST /api/v1/gacha/reactivate
Authorization: Bearer {token}
Content-Type: application/json

Request:
{
  "deckSlug": "js-core-basics",
  "stableUid": "js-core-basics-42"
}

Response:
{
  "success": true,
  "data": {
    "stableUid": "js-core-basics-42",
    "reactivatedAt": "2026-03-24T14:00:00Z",
    "cost": 200,
    "remainingCoins": 1050
  }
}

Error Cases:
- 403: 非Premium用户
- 400: 卡片未被跳过
- 400: 卡片从未解锁过（不能直接解锁新卡）
- 400: 代码币不足
```

### 4. 跳过卡片（在移动端操作时同步）

```http
POST /api/v1/gacha/skip
Authorization: Bearer {token}
Content-Type: application/json

Request:
{
  "deckSlug": "js-core-basics",
  "stableUid": "js-core-basics-42"
}

Response:
{
  "success": true,
  "data": {
    "skippedAt": "2026-03-24T14:00:00Z",
    "canReactivate": true,  // 是否可以重新激活（Premium）
    "reactivateCost": 200
  }
}
```

### 5. 领取每日奖励

```http
POST /api/v1/gacha/daily-claim
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": {
    "singleTickets": 3,  // 或5（Premium）
    "streak": 6,         // 当前连续天数
    "bonus": {
      "type": "ten_ticket",  // 或null
      "count": 1
    },
    "nextClaimAt": "2026-03-25T00:00:00Z"
  }
}

Error Cases:
- 400: 今日已领取
```

### 6. 获取抽卡统计

```http
GET /api/v1/gacha/stats
Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": {
    "totalDraws": 150,
    "totalCoins": 1250,
    "pityCounter": 12,        // 距离上次Epic已抽12次
    "hardPityThreshold": 30,  // 免费30，Premium 25
    "dailyStatus": {
      "claimed": true,
      "streak": 6,
      "nextClaimAt": "2026-03-25T00:00:00Z"
    },
    "perDeck": [
      {
        "deckSlug": "js-core-basics",
        "unlockedCount": 45,
        "totalCards": 150,
        "completed": false
      }
    ]
  }
}
```

---

## 📱 移动端实现指南

### 1. 目录结构

```
mobile/src/
├── gacha/
│   ├── types.ts           # 类型定义
│   ├── store.ts           # Zustand store（券、代码币、历史）
│   ├── drawEngine.ts      # 抽卡逻辑（调用API）
│   ├── animation.ts       # 动画配置
│   ├── DailyClaim.tsx     # 每日领取组件
│   ├── DrawButton.tsx     # 抽卡按钮
│   ├── DrawAnimation.tsx  # 抽卡动画
│   ├── GachaScreen.tsx    # 抽卡主界面
│   ├── CardReveal.tsx     # 卡片揭示
│   └── CollectionView.tsx # 收集册
├── review/
│   └── model.ts           # 修改：复习时只选已解锁卡片
└── sync/
    └── progressSync.ts    # 修改：同步解锁状态
```

### 2. 核心状态管理

```typescript
// gacha/types.ts
export interface GachaState {
  // 资源（本地）
  tickets: {
    single: number;
    ten: number;
  };
  coins: number;
  
  // 每日状态
  dailyClaimed: boolean;
  dailyStreak: number;
  
  // 云同步数据（缓存）
  unlockedCards: Record<string, Set<string>>;  // deckSlug -> Set<stableUid>
  skippedCards: Record<string, Set<string>>;
  pityCounter: number;
  
  // 动作
  claimDaily: () => Promise<void>;
  draw: (deckSlug: string, type: 'single' | 'ten') => Promise<DrawResult[]>;
  skipCard: (deckSlug: string, uid: string) => Promise<void>;
  reactivateCard: (deckSlug: string, uid: string) => Promise<void>;
  syncWithCloud: () => Promise<void>;
}
```

### 3. 抽卡流程

```typescript
// gacha/drawEngine.ts

async function performDraw(
  deckSlug: string, 
  type: 'single' | 'ten'
): Promise<DrawResult[]> {
  
  // 1. 检查券
  const requiredTickets = type === 'single' ? 1 : 1;
  const ticketType = type === 'single' ? 'single' : 'ten';
  
  if (!hasEnoughTickets(ticketType, requiredTickets)) {
    // 检查是否可以合成
    if (type === 'ten' && canConvertSingleToTen()) {
      await convertSingleToTen();
    } else {
      throw new Error('INSUFFICIENT_TICKETS');
    }
  }
  
  // 2. 调用API
  const response = await api.post('/gacha/draw', {
    deckSlug,
    drawType: type,
    ticketType
  });
  
  // 3. 扣除本地券（API成功后才扣）
  deductTickets(ticketType, requiredTickets);
  
  // 4. 更新解锁列表
  for (const result of response.data.results) {
    addUnlockedCard(deckSlug, result.stableUid);
  }
  
  // 5. 更新保底计数
  updatePityCounter(response.data.stats.pityCounter);
  
  // 6. 记录历史
  addToHistory({
    timestamp: Date.now(),
    type,
    results: response.data.results,
    deckSlug
  });
  
  return response.data.results;
}
```

### 4. 复习流程修改

```typescript
// review/model.ts - 修改 pickNextCard

function pickNextCard(
  deck: DeckExport,
  progress: CardProgress[],
  unlockedSet: Set<string>,  // 🆕 新增参数
  mode: 'review-due' | 'learn-new' | 'mixed',
  now: Date
): CurrentCard | null {
  
  // 只从已解锁卡片中选择
  const unlockedCards = deck.Cards.filter(c => unlockedSet.has(c.StableUid));
  
  // ... 原有逻辑，但操作的是 unlockedCards
}
```

### 5. 抽卡动画规格

**单抽动画（3秒）：**

```
0.0s - 用户点击，按钮反馈（缩放0.95）
0.1s - 显示卡片背面，背景渐暗
0.2s - 根据稀有度开始光效（Common白，Rare蓝，Epic金紫）
0.5s - 光芒旋转加速
1.0s - 光芒爆发，卡片开始翻转
1.5s - 翻转90度，显示卡片内容
2.0s - 翻转完成，光效绽放
2.5s - 显示"新卡解锁！"或"已获得"
3.0s - 可点击继续
```

**十连动画（8秒）：**

```
0.0s - 进入十连界面，10个卡背排列成2行
0.5s - 第一张翻转（0.3秒/张）
0.8s - 第二张
1.1s - 第三张
...（每张间隔0.3秒）
3.2s - 第十张（保底Rare+，动画更华丽，停顿0.5秒）
4.0s - 所有卡片展开显示
5.0s - 统计：获得 X Common, Y Rare, Z Epic
6.0s - 新卡高亮闪烁
8.0s - 可点击"收入囊中"
```

### 6. 界面布局

**GachaScreen.tsx 布局：**

```
┌─────────────────────────────────────┐
│  🔙  抽卡中心              💎 1,250 │
├─────────────────────────────────────┤
│                                     │
│    ┌─────────────────────────┐     │
│    │                         │     │
│    │    [卡池展示]            │     │
│    │    📦 JS Core Basics     │     │
│    │    已收集: 45/150 ⭐⭐⭐   │     │
│    │    [稀有度分布小图]       │     │
│    │                         │     │
│    └─────────────────────────┘     │
│                                     │
│  ┌─────────────┐  ┌─────────────┐  │
│  │  🎫 x7      │  │ 🎫🎫 x1     │  │
│  │   单抽券    │  │   十连券    │  │
│  └─────────────┘  └─────────────┘  │
│                                     │
│  ┌─────────────────────────────────┐│
│  │         🎲  单抽  (🎫 x1)        ││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │      ✨  十连抽  (🎫🎫 x1)        ││
│  │        保底必出稀有+             ││
│  └─────────────────────────────────┘│
│                                     │
│  [收集册] [抽卡记录] [概率公示]      │
│                                     │
│  💡 提示：10张单抽券可合成1张十连券   │
└─────────────────────────────────────┘
```

---

## 🌐 Web 前端实现指南

### 1. Deck 编辑页修改

**CardListPage.tsx 新增列：**

```
卡片列表表格：
| Order | Question | Difficulty | Rarity | Actions |
|-------|----------|------------|--------|---------|
| 1     | var/let  | 1 (Easy)   | ⭐     | [Edit]  |
| 2     | Hoisting | 2 (Medium) | ⭐⭐   | [Edit]  |
| 3     | Closure  | 3 (Hard)   | ⭐⭐⭐  | [Edit]  |
```

**添加操作按钮：**
- "根据 Difficulty 自动分配 Rarity"
- 卡片预览显示稀有度边框

### 2. 用户管理页新增

**AdminUsersPage.tsx 新增 Tab：**

```
用户详情弹窗：
├── Tab 1: 基本信息
├── Tab 2: 学习进度
└── Tab 3: 抽卡数据 🆕
    ├── 总抽卡次数: 150
    ├── 当前代码币: 1250
    ├── 连续登录: 6天
    ├── 硬保底计数: 12/30
    └── 操作按钮：
        - [赠送单抽券 x10]
        - [赠送十连券 x1]
        - [重置保底计数]
        - [直接解锁某张卡]（客服功能）
```

### 3. deck.json 导出修改

```typescript
// 导出时自动添加 Rarity
function exportDeck(deck: Deck): DeckExport {
  return {
    ...deck,
    Cards: deck.Cards.map(card => ({
      ...card,
      Rarity: difficultyToRarity[card.Difficulty]
    }))
  };
}
```

---

## 🗓️ 分阶段实施计划

### Phase 1: 数据准备（Week 1）

**Day 1-2: 后端数据库**
- [ ] 创建 `user_card_unlocks` 表
- [ ] 创建 `user_gacha_stats` 表
- [ ] 编写数据库迁移脚本
- [ ] 更新实体模型

**Day 3-4: 后端 API 骨架**
- [ ] 创建 GachaController
- [ ] 定义 DTOs
- [ ] 实现基础中间件（Premium检查）

**Day 5: Web 前端数据准备**
- [ ] CardListPage 显示 Rarity 列
- [ ] deck.json 导出包含 Rarity
- [ ] 验证现有卡组数据

### Phase 2: 后端 API 实现（Week 2）

**Day 1-2: 核心抽卡 API**
- [ ] POST /gacha/draw
- [ ] 实现抽卡算法（含保底）
- [ ] 单元测试

**Day 3: 用户数据 API**
- [ ] GET /gacha/unlocks/:deckSlug
- [ ] POST /gacha/skip
- [ ] POST /gacha/reactivate（Premium）

**Day 4: 每日奖励 API**
- [ ] POST /gacha/daily-claim
- [ ] 连续登录逻辑
- [ ] 时区处理

**Day 5: API 联调测试**
- [ ] Postman 集合
- [ ] 边界情况测试

### Phase 3: 移动端核心（Week 3）

**Day 1-2: 基础架构**
- [ ] 创建 gacha/ 目录结构
- [ ] 实现 gacha/store.ts
- [ ] 类型定义

**Day 3-4: 抽卡界面**
- [ ] GachaScreen.tsx
- [ ] 券显示组件
- [ ] 抽卡按钮逻辑

**Day 5: 每日领取**
- [ ] DailyClaim.tsx
- [ ] 启动时检查
- [ ] 推送提醒（可选）

### Phase 4: 移动端动画（Week 4）

**Day 1-2: 单推动画**
- [ ] DrawAnimation.tsx
- [ ] CardReveal.tsx
- [ ] 光效实现

**Day 3-4: 十连动画**
- [ ] 十连布局
- [ ] 连续翻转动画
- [ ] 结果统计展示

**Day 5: 收集册**
- [ ] CollectionView.tsx
- [ ] 卡片网格
- [ ] 稀有度筛选

### Phase 5: 集成与同步（Week 5）

**Day 1-2: 复习流程集成**
- [ ] 修改 pickNextCard
- [ ] 只选已解锁卡片
- [ ] 未解锁时提示去抽卡

**Day 3-4: 云同步**
- [ ] 同步解锁状态
- [ ] 离线队列
- [ ] 冲突处理

**Day 5: 代码币集成**
- [ ] 学习奖励发放
- [ ] 代码币消费
- [ ] 余额同步

### Phase 6: 测试与优化（Week 6）

**Day 1-2: 测试**
- [ ] 端到端测试
- [ ] 边界情况
- [ ] 性能测试

**Day 3-4: 优化**
- [ ] 动画性能
- [ ] 启动速度
- [ ] 内存占用

**Day 5: 文档与上线**
- [ ] 更新用户文档
- [ ] 准备上线检查清单

---

## ✅ 检查清单

### 上线前检查

**后端：**
- [ ] 数据库迁移已执行
- [ ] API 已部署
- [ ] 错误监控已配置
- [ ]  rate limiting 已设置

**移动端：**
- [ ] 抽卡动画流畅（60fps）
- [ ] 离线模式可用
- [ ] 崩溃率 < 0.1%
- [ ] 包体积增加 < 500KB

**数据：**
- [ ] 所有现有卡片已分配 Rarity
- [ ] 测试卡组已创建
- [ ] 客服工具已准备

**运营：**
- [ ] 每日奖励时间确定（建议 UTC 0点）
- [ ] 活动方案已准备
- [ ] 用户引导文案已确认

---

## 📎 附录

### A. 抽卡算法伪代码

```
function draw(deckSlug, drawType, userId):
  
  // 1. 获取数据
  deck = getDeck(deckSlug)
  unlocked = getUserUnlocks(userId, deckSlug)
  stats = getUserStats(userId)
  
  // 2. 计算剩余池
  remaining = deck.cards.filter(c => !unlocked.has(c.stableUid))
  if remaining.isEmpty():
    throw "ALL_CARDS_UNLOCKED"
  
  // 3. 确定抽卡次数
  count = drawType == 'single' ? 1 : 10
  
  // 4. 执行抽取
  results = []
  for i in 1..count:
    if remaining.isEmpty(): break
    
    // 保底检查
    card = null
    if stats.pityCounter >= HARD_PITY_THRESHOLD:
      card = randomPick(remaining.filter(c => c.rarity == 'epic'))
      stats.resetPity()
    else if drawType == 'ten' && i == 10 && !hasRareOrEpic(results):
      // 软保底
      card = randomPick(remaining.filter(c => c.rarity != 'common'))
    else:
      // 正常随机
      card = weightedRandom(remaining)
    
    results.push(card)
    remaining.remove(card)
    
    // 更新保底计数
    if card.rarity == 'epic':
      stats.resetPity()
    else:
      stats.incrementPity()
  
  // 5. 保存结果
  saveUnlocks(userId, deckSlug, results)
  saveStats(userId, stats)
  
  return results
```

### B. 错误码定义

| 错误码 | 说明 | 用户提示 |
|--------|------|---------|
| INSUFFICIENT_TICKETS | 券不足 | "抽卡券不足，去做任务获取吧！" |
| ALL_CARDS_UNLOCKED | 卡组已完成 | "恭喜！你已集齐所有卡片 🎉" |
| ALREADY_CLAIMED | 今日已领取 | "今天已经领过奖励了，明天再来吧" |
| NOT_PREMIUM | 需要Premium | "Premium用户专享功能" |
| CANNOT_REACTIVATE | 无法重新激活 | "这张卡片还未解锁，不能直接激活" |

### C. 参考数值

**掉率：**
- Common: 70%
- Rare: 25%
- Epic: 5%

**保底：**
- 十连保底：第10张（免费）/ 第8张（Premium）必Rare+
- 硬保底：30抽（免费）/ 25抽（Premium）必Epic

**经济：**
- 每日代码币收入（活跃用户）: ~100💎
- 单张抽卡成本: 100💎
- 集齐150张卡组（免费用户）: ~30天

---

**文档结束**

实施过程中遇到问题，随时更新此文档。
