// RecallSmith v5.0 — Design tokens
// §2 of gacha-v5.md · Parchment Gold (daily) + Cosmic Ceremony (Draw only) + VS Code Dark+ (code blocks)
const RS = {
  // §2.1 Theme A · Parchment Gold (Home/Level/Settlement/Library/Daily Dose)
  bg: {
    parchment:     '#FAF3E0',   // screen底
    parchmentDeep: '#F3E8C8',   // 卡片底 / progress bar 底
    parchmentSoft: '#FBF5E5',   // elevated 卡
    // Cosmic (Draw ceremony only)
    cosmic:        '#0B1030',
    cosmicDeep:    '#070A1F',
    // IRL card (Stage A expanded)
    irl:           '#D9E4F0',
    // Code block
    codeBg:        '#1E1E1E',
  },
  ink: {
    primary:   '#2A2218',   // 正文
    secondary: '#5A4B38',   // 次要
    tertiary:  '#8C7A5B',   // 更次
    disabled:  '#B8A985',
    onGold:    '#FAF3E0',   // 金按钮白字
    onCosmic:  '#F5ECC4',   // 宇宙上的米色文字
  },
  accent: {
    gold:   '#C8883A',      // 主 CTA + 金边 LEG
    amber:  '#E8B85A',      // 金光 / 奖励
    goldDeep: '#A66F26',
  },
  // §2.2 稀有度
  rarity: {
    com:     '#8C7A5B',     // 灰金
    rar:     '#6E4C9F',     // 深紫
    leg:     '#C8883A',     // 金
    comBg:   '#EFE6CC',
    rarBg:   '#E8E0F0',
    legBg:   '#F9E8C4',
    legGlow: 'rgba(232,184,90,0.55)',
    rarGlow: 'rgba(110,76,159,0.40)',
  },
  // §3.4 GradeMixBar & §3.1 Rating buttons
  grade: {
    again: '#A7503B',       // 橙红琥珀
    hard:  '#C8883A',       // 琥珀
    good:  '#7E9D5E',       // 薄荷 / 完成绿
    easy:  '#D9A541',       // 金
  },
  state: {
    ok:     '#7E9D5E',      // 完成绿
    warn:   '#C8883A',      // 琥珀警告
    danger: '#A7503B',      // 橙红
    info:   '#4A7BA6',
  },
  // §2.3 14 类 Tag 色（Primary Tag 左侧 2pt 色条）
  tag: {
    'ASYNC / AWAIT':      '#7CB5D9',
    'ASP.NET CORE':       '#6E4C9F',
    'TESTING':            '#7EC9A8',
    'OOP':                '#C8883A',
    'SOLID / PATTERNS':   '#9D4B4B',
    'EF CORE':            '#4A7BA6',
    'LINQ':               '#B5965D',
    'ERRORS / LOGGING':   '#A7503B',
    'PERFORMANCE':        '#D9A541',
    'DEVOPS':             '#5C7C3E',
    'MESSAGING':          '#8B5A9F',
    'SECURITY':           '#AA3636',
    'CLOUD':              '#5F8DC9',
    'DOCKER':             '#3F8BB5',
  },
  // §2.5 圆角
  radius: { none: 0, sm: 6, md: 10, lg: 12, xl: 16, xxl: 20, pill: 9999 },
  // Fonts (§2.4)
  font: {
    sans: '-apple-system, "SF Pro Display", "Inter", system-ui, "PingFang SC", sans-serif',
    mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
  },
  // Shadows — warm
  shadow: {
    subtle: '0 1px 2px rgba(42,34,24,0.06)',
    card:   '0 4px 14px rgba(42,34,24,0.10), 0 1px 2px rgba(42,34,24,0.05)',
    lift:   '0 10px 28px rgba(42,34,24,0.14), 0 2px 4px rgba(42,34,24,0.07)',
    legGlow: '0 0 0 4px #C8883A, 0 0 28px rgba(232,184,90,0.45), 0 6px 20px rgba(42,34,24,0.15)',
    rarGlow: '0 0 0 3px #6E4C9F, 0 0 18px rgba(110,76,159,0.30)',
    comGlow: '0 0 0 2px #8C7A5B',
  },
  // VS Code Dark+ syntax
  code: {
    bg:      '#1E1E1E',
    comment: '#6A9955',
    keyword: '#569CD6',
    string:  '#CE9178',
    ident:   '#9CDCFE',
    type:    '#4EC9B0',
    fn:      '#DCDCAA',
    number:  '#B5CEA8',
    op:      '#D4D4D4',
  },
};
window.RS = RS;
