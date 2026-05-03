// atoms.jsx — v5.0 card primitives and UI atoms
// §4.4 hard rules: no Q Snippet, no Audience Badge, no code decoration on card face

// ─── Card · Full (Stage D hero / Library) ───────────────────────
// Strict §4.4: Primary Tag (top + 2pt color bar) / Topic Keyword / Stars / corners
function RSCard({
  rarity = 'com',          // com | rar | leg
  tag = 'PERFORMANCE',     // Primary Tag text
  keyword = 'yield return',
  stars = 3,               // 3 | 4 | 5
  badge = 'NEW',           // NEW | '🎓 N/5' | '💎 N/5' | '🪙 0/5' | null
  w = 240, h = 340,
  pool = 'C#/.NET',
  locked = false,          // draw unpulled
  faded = false,           // library "not yet drawn" (30% alpha)
  scale = 1,
}) {
  const rCfg = {
    com: { border: RS.rarity.com, bw: 2, bg: '#FFFBF0', rIcon: '⚪' },
    rar: { border: RS.rarity.rar, bw: 3, bg: `linear-gradient(160deg, #FBF5E5 0%, ${RS.rarity.rarBg} 100%)`, rIcon: '🔷' },
    leg: { border: RS.rarity.leg, bw: 4, bg: `linear-gradient(160deg, #FBF5E5 0%, ${RS.rarity.legBg} 100%)`, rIcon: '⚡' },
  }[rarity];
  const rLabel = { com: 'COM', rar: 'RAR', leg: 'LEG' }[rarity];
  const tagColor = RS.tag[tag] || RS.ink.tertiary;
  const glow = rarity === 'leg'
    ? `0 0 20px ${RS.rarity.legGlow}, 0 4px 14px rgba(42,34,24,0.10)`
    : rarity === 'rar'
      ? `0 0 12px ${RS.rarity.rarGlow}, 0 4px 14px rgba(42,34,24,0.08)`
      : RS.shadow.card;

  if (locked) {
    return (
      <div style={{
        width: w, height: h, borderRadius: RS.radius.xl,
        background: RS.bg.parchmentDeep,
        border: `${rCfg.bw}px dashed ${rCfg.border}`,
        opacity: 0.35,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: RS.font.mono, color: RS.ink.tertiary,
        padding: 20, textAlign: 'center',
      }}>
        <div style={{ fontSize: 48 * scale, marginBottom: 16, color: RS.ink.tertiary }}>⟨ ? ⟩</div>
        <div style={{ fontSize: 11 * scale, letterSpacing: 0.6 }}>From {pool} pool</div>
      </div>
    );
  }

  return (
    <div style={{
      width: w, height: h,
      background: rCfg.bg,
      border: `${rCfg.bw}px solid ${rCfg.border}`,
      borderRadius: RS.radius.xl,
      boxShadow: faded ? 'none' : glow,
      opacity: faded ? 0.45 : 1,
      padding: 18 * scale,
      display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
      fontFamily: RS.font.sans,
    }}>
      {/* Top row: rarity label + badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          fontFamily: RS.font.mono, fontSize: 11 * scale, fontWeight: 700,
          color: rCfg.border, letterSpacing: 0.8,
        }}>{rCfg.rIcon} {rLabel}</span>
        {badge && (
          <span style={{
            fontSize: 10 * scale, fontWeight: 700,
            fontFamily: RS.font.mono, letterSpacing: 0.6,
            padding: '3px 7px', borderRadius: 4,
            background: badge === 'NEW' ? RS.accent.amber : 'transparent',
            color: badge === 'NEW' ? '#3A2608' : RS.ink.secondary,
            border: badge !== 'NEW' ? `1px solid ${RS.ink.tertiary}` : 'none',
          }}>{badge}</span>
        )}
      </div>

      {/* Primary Tag with 2pt color bar */}
      <div style={{ marginTop: 14 * scale, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 32, height: 2, background: tagColor }}/>
        <div style={{
          fontFamily: RS.font.mono, fontSize: 10 * scale, fontWeight: 500,
          letterSpacing: 1.2, color: RS.ink.secondary,
        }}>{tag}</div>
        <div style={{ flex: 1, height: 2, background: tagColor, opacity: 0.35 }}/>
      </div>

      {/* Center: Topic Keyword */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '8px 4px',
      }}>
        <div style={{
          fontFamily: RS.font.mono, fontWeight: 700,
          fontSize: (keyword.length > 14 ? 22 : 28) * scale,
          color: RS.ink.primary, textAlign: 'center',
          lineHeight: 1.15, letterSpacing: -0.2,
        }}>{keyword}</div>
        <div style={{
          marginTop: 16 * scale, fontSize: 18 * scale,
          color: RS.accent.amber, letterSpacing: 2,
        }}>{'⭐'.repeat(stars)}</div>
      </div>

      {/* Bottom row: pool + rarity icon */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          fontFamily: RS.font.mono, fontSize: 10 * scale,
          color: RS.ink.tertiary, letterSpacing: 0.4,
        }}>{pool}</span>
        <span style={{ fontSize: 14 * scale }}>{rCfg.rIcon}</span>
      </div>
    </div>
  );
}

// ─── Card Back (Draw ceremony · purple C#/.NET) ─────────────────
function RSCardBack({ w = 100, h = 140, hint = false, rotate = 0 }) {
  return (
    <div style={{
      width: w, height: h,
      background: `linear-gradient(160deg, #6E4C9F 0%, #5A3E85 60%, #3F2B5E 100%)`,
      borderRadius: RS.radius.xl,
      boxShadow: '0 6px 20px rgba(11,16,48,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
      transform: `rotate(${rotate}deg)`,
      border: `1px solid rgba(232,184,90,${hint ? 0.6 : 0.15})`,
    }}>
      {/* corner decorations */}
      {[[6,6],[6,null,null,6],[null,6,6,null],[null,6,null,6]].map((p, i) => (
        <span key={i} style={{
          position: 'absolute',
          top: p[0], left: p[1], bottom: p[2], right: p[3],
          fontSize: w * 0.12, color: hint ? RS.accent.amber : 'rgba(245,236,196,0.25)',
          fontFamily: RS.font.mono,
        }}>⚡</span>
      ))}
      {/* floating syntax decoration */}
      <div style={{
        position: 'absolute', inset: 0,
        color: 'rgba(245,236,196,0.07)',
        fontFamily: RS.font.mono, fontSize: w * 0.18, lineHeight: 1.2,
        display: 'flex', flexWrap: 'wrap', padding: 4, overflow: 'hidden',
      }}>{'< { } ; < > { '.repeat(8)}</div>
      {/* center C# badge */}
      <div style={{
        fontFamily: RS.font.mono, fontWeight: 700,
        fontSize: w * 0.42, color: '#F5ECC4',
        letterSpacing: -1, textShadow: '0 2px 8px rgba(0,0,0,0.4)',
        position: 'relative', zIndex: 2,
      }}>C#</div>
    </div>
  );
}

// ─── Button ────────────────────────────────────────────────────
function RSButton({ variant = 'primary', children, full = false, size = 'md', onClick }) {
  const sizes = {
    sm: { h: 36, fs: 13, px: 14, r: 10 },
    md: { h: 52, fs: 15, px: 22, r: 12 },
    lg: { h: 60, fs: 16, px: 26, r: 14 },
  }[size];
  const base = {
    height: sizes.h, padding: `0 ${sizes.px}px`,
    fontSize: sizes.fs, fontWeight: 600,
    fontFamily: RS.font.sans, borderRadius: sizes.r,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    cursor: 'pointer', width: full ? '100%' : undefined, border: 'none',
    letterSpacing: 0.1,
  };
  const variants = {
    primary: { background: RS.accent.gold, color: RS.ink.onGold, boxShadow: '0 2px 8px rgba(200,136,58,0.35)' },
    outline: { background: 'transparent', color: RS.ink.primary, border: `1.5px solid ${RS.ink.primary}` },
    ghost:   { background: 'rgba(42,34,24,0.04)', color: RS.ink.primary },
    cosmic:  { background: 'rgba(245,236,196,0.12)', color: RS.ink.onCosmic, border: '1px solid rgba(245,236,196,0.3)' },
  };
  return <button onClick={onClick} style={{ ...base, ...variants[variant] }}>{children}</button>;
}

// ─── Rating pills (4-grade) ───────────────────────────────────
function RatingPills({ picked = null }) {
  const pills = [
    { k: 'again', label: 'Again', kbd: '¹', color: RS.grade.again },
    { k: 'hard',  label: 'Hard',  kbd: '²', color: RS.grade.hard  },
    { k: 'good',  label: 'Good',  kbd: '³', color: RS.grade.good  },
    { k: 'easy',  label: 'Easy',  kbd: '⁴', color: RS.grade.easy  },
  ];
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {pills.map(p => {
        const active = picked === p.k;
        return (
          <div key={p.k} style={{
            flex: 1, height: 56,
            borderRadius: RS.radius.lg,
            background: active ? p.color : 'transparent',
            border: `1.5px solid ${p.color}`,
            color: active ? '#fff' : p.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            fontSize: 14, fontWeight: 600, fontFamily: RS.font.sans,
            boxShadow: active ? `0 4px 12px ${p.color}44` : 'none',
          }}>
            {p.label}<sup style={{ fontFamily: RS.font.mono, opacity: 0.7 }}>{p.kbd}</sup>
          </div>
        );
      })}
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────
function ProgressBar({ value = 0, total = 1, color = RS.state.ok }) {
  const pct = Math.min(100, (value / total) * 100);
  return (
    <div style={{ height: 6, background: RS.bg.parchmentDeep, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }}/>
    </div>
  );
}

// ─── Bottom Tab Nav (5-tab) ───────────────────────────────────
function TabNav({ active = 'home' }) {
  const tabs = [
    { k: 'home',    label: 'Home',    icon: '⌂' },
    { k: 'draw',    label: 'Draw',    icon: '✦' },
    { k: 'review',  label: 'Review',  icon: '↻' },
    { k: 'library', label: 'Library', icon: '▦' },
    { k: 'me',      label: 'Me',      icon: '◉' },
  ];
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, height: 78,
      background: 'rgba(250,243,224,0.92)',
      backdropFilter: 'blur(12px)',
      borderTop: `1px solid rgba(90,75,56,0.12)`,
      display: 'flex', paddingTop: 8, paddingBottom: 22,
    }}>
      {tabs.map(t => {
        const is = active === t.k;
        return (
          <div key={t.k} style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 3,
          }}>
            <div style={{ fontSize: 20, color: is ? RS.accent.gold : RS.ink.secondary, lineHeight: 1 }}>{t.icon}</div>
            <div style={{ fontSize: 10, fontWeight: is ? 600 : 500, fontFamily: RS.font.mono, color: is ? RS.accent.gold : RS.ink.secondary, letterSpacing: 0.4 }}>{t.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Primary Tag color bar utility ────────────────────────────
function TagLabel({ tag, size = 10 }) {
  const color = RS.tag[tag] || RS.ink.tertiary;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: RS.font.mono, fontSize: size, fontWeight: 500,
      letterSpacing: 1, color: RS.ink.secondary,
    }}>
      <span style={{ display: 'inline-block', width: 18, height: 2, background: color }}/>
      {tag}
    </span>
  );
}

// ─── Status Bar (iOS) wraps content ───────────────────────────
// ios-frame already provides this; atoms just exports above.

Object.assign(window, { RSCard, RSCardBack, RSButton, RatingPills, ProgressBar, TabNav, TagLabel });
