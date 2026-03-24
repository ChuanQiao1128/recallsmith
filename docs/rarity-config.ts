// ============================================
// RecallSmith 稀有度配置 - 共享常量
// ============================================
// 使用方式：
// Web: import { RARITY_MAP, mapDifficultyToRarity } from './rarity-config';
// Mobile: 复制此文件到 mobile/src/gacha/rarityConfig.ts
// ============================================

export const RARITY_MAP = {
  1: {
    key: 'common' as const,
    label: '普通',
    labelEn: 'Common',
    stars: '⭐',
    starCount: 1,
    // 蓝色系
    color: '#3B82F6',           // 主色：明亮蓝
    colorLight: '#60A5FA',      // 浅色
    colorDark: '#2563EB',       // 深色
    gradient: ['#DBEAFE', '#3B82F6'],  // 渐变：浅蓝到蓝
    glowColor: 'rgba(59, 130, 246, 0.4)',
    dropRate: 0.70,             // 70% 掉率
    borderWidth: 1,
  },
  2: {
    key: 'rare' as const,
    label: '稀有',
    labelEn: 'Rare',
    stars: '⭐⭐',
    starCount: 2,
    // 紫色系
    color: '#8B5CF6',           // 主色：紫罗兰
    colorLight: '#A78BFA',      // 浅色
    colorDark: '#7C3AED',       // 深色
    gradient: ['#EDE9FE', '#8B5CF6'],  // 渐变：浅紫到紫
    glowColor: 'rgba(139, 92, 246, 0.5)',
    dropRate: 0.25,             // 25% 掉率
    borderWidth: 2,
  },
  3: {
    key: 'epic' as const,
    label: '史诗',
    labelEn: 'Epic',
    stars: '⭐⭐⭐',
    starCount: 3,
    // 金色系
    color: '#F59E0B',           // 主色：琥珀金
    colorLight: '#FBBF24',      // 浅色
    colorDark: '#D97706',       // 深色
    gradient: ['#FEF3C7', '#F59E0B'],  // 渐变：浅金到金
    glowColor: 'rgba(245, 158, 11, 0.6)',
    dropRate: 0.05,             // 5% 掉率
    borderWidth: 3,
    specialEffect: 'shimmer',   // 特殊效果标识
  },
} as const;

// 类型导出
export type CardRarityKey = typeof RARITY_MAP[1 | 2 | 3]['key'];
export type CardRarityConfig = typeof RARITY_MAP[1 | 2 | 3];

// ============================================
// 工具函数
// ============================================

/**
 * Difficulty (1/2/3) → Rarity 配置
 */
export function mapDifficultyToRarity(difficulty: number): CardRarityConfig {
  return RARITY_MAP[(difficulty as 1 | 2 | 3) || 1];
}

/**
 * Rarity key → 配置
 */
export function getRarityByKey(key: CardRarityKey): CardRarityConfig {
  const entry = Object.values(RARITY_MAP).find(r => r.key === key);
  return entry || RARITY_MAP[1];
}

/**
 * 获取卡片显示样式（Web/CSS）
 */
export function getRarityStyle(difficulty: number) {
  const config = mapDifficultyToRarity(difficulty);
  return {
    borderColor: config.color,
    background: `linear-gradient(135deg, ${config.gradient[0]} 0%, ${config.gradient[1]} 100%)`,
    boxShadow: `0 0 20px ${config.glowColor}`,
    color: config.colorDark,
  };
}

/**
 * 获取卡片显示样式（React Native）
 */
export function getRarityStyleRN(difficulty: number) {
  const config = mapDifficultyToRarity(difficulty);
  return {
    borderColor: config.color,
    borderWidth: config.borderWidth,
    // RN 渐变需要用 expo-linear-gradient
    gradientColors: config.gradient,
    shadowColor: config.color,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    color: config.colorDark,
  };
}

/**
 * 计算抽卡权重（用于抽卡算法）
 */
export function calculateRarityWeights(remainingCards: { difficulty: number }[]) {
  const groups = {
    1: remainingCards.filter(c => c.difficulty === 1).length,
    2: remainingCards.filter(c => c.difficulty === 2).length,
    3: remainingCards.filter(c => c.difficulty === 3).length,
  };

  // 权重 = 剩余数量 × 基础掉率
  const weights = {
    1: groups[1] * RARITY_MAP[1].dropRate,
    2: groups[2] * RARITY_MAP[2].dropRate,
    3: groups[3] * RARITY_MAP[3].dropRate,
  };

  const total = weights[1] + weights[2] + weights[3];

  return {
    weights,
    probabilities: {
      1: total > 0 ? weights[1] / total : 0,
      2: total > 0 ? weights[2] / total : 0,
      3: total > 0 ? weights[3] / total : 0,
    },
    counts: groups,
  };
}

/**
 * 加权随机选择稀有度
 */
export function randomRarityWithWeights(
  probabilities: { 1: number; 2: number; 3: number }
): 1 | 2 | 3 {
  const rand = Math.random();
  if (rand < probabilities[1]) return 1;
  if (rand < probabilities[1] + probabilities[2]) return 2;
  return 3;
}

// ============================================
// 组件/样式快捷方法
// ============================================

/**
 * 获取徽章文字（短）
 * 用于卡片角落小徽章
 */
export function getRarityBadgeShort(difficulty: number): string {
  return mapDifficultyToRarity(difficulty).stars;
}

/**
 * 获取徽章文字（长）
 * 用于详情展示
 */
export function getRarityLabel(difficulty: number): string {
  const config = mapDifficultyToRarity(difficulty);
  return `${config.stars} ${config.label}`;
}

/**
 * 获取动画时长（根据稀有度）
 * 越稀有动画越长，增加仪式感
 */
export function getRevealAnimationMs(difficulty: number): number {
  const base = 2000;
  const bonus = (difficulty - 1) * 500; // Epic 多1秒
  return base + bonus;
}

/**
 * 是否显示特殊光效
 */
export function hasSpecialEffect(difficulty: number): boolean {
  return difficulty === 3; // 只有 Epic 有特殊效果
}

// ============================================
// 示例使用
// ============================================

/*
// Web 前端示例：
import { mapDifficultyToRarity, getRarityStyle } from './rarity-config';

function CardComponent({ card }) {
  const rarity = mapDifficultyToRarity(card.difficulty);
  const style = getRarityStyle(card.difficulty);
  
  return (
    <div style={{
      border: `2px solid ${rarity.color}`,
      background: style.background,
      boxShadow: style.boxShadow,
    }}>
      <span>{rarity.stars}</span>
      <span>{rarity.label}</span>
    </div>
  );
}

// Mobile 示例：
import { mapDifficultyToRarity, getRarityStyleRN } from './rarityConfig';
import { LinearGradient } from 'expo-linear-gradient';

function CardComponent({ card }) {
  const rarity = mapDifficultyToRarity(card.difficulty);
  const style = getRarityStyleRN(card.difficulty);
  
  return (
    <LinearGradient
      colors={style.gradientColors}
      style={{
        borderWidth: style.borderWidth,
        borderColor: style.borderColor,
      }}
    >
      <Text>{rarity.stars}</Text>
      <Text>{rarity.label}</Text>
    </LinearGradient>
  );
}

// 抽卡算法示例：
import { calculateRarityWeights, randomRarityWithWeights } from './rarity-config';

function drawCard(remainingCards) {
  const { probabilities } = calculateRarityWeights(remainingCards);
  const selectedRarity = randomRarityWithWeights(probabilities);
  
  // 从该稀有度中随机选一张...
}
*/
