// screens-intro.jsx — Screens 01-05 (cold start → draw → dose)

// ─── 01 · Cold Start Home ────────────────────────────────────────
function S01_ColdStartHome() {
  return (
    <div data-screen-label="01 Cold Start Home" style={{
      width: '100%', height: '100%',
      background: RS.bg.parchment,
      fontFamily: RS.font.sans, color: RS.ink.primary,
      display: 'flex', flexDirection: 'column',
      padding: '12px 24px 90px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.6 }}>
          📖 常规模式 · C#/.NET · Day 0
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, lineHeight: 1.3, color: RS.ink.primary, textWrap: 'pretty' }}>
          欢迎来到 RecallSmith
        </div>
        <div style={{ fontSize: 13, color: RS.ink.secondary, marginTop: 4 }}>
          先抽卡收集你的第一批卡 ↓
        </div>
      </div>

      {/* Hero CTA — the only visual weight */}
      <div style={{
        marginTop: 16,
        background: `linear-gradient(160deg, ${RS.accent.amber} 0%, ${RS.accent.gold} 60%, ${RS.accent.goldDeep} 100%)`,
        borderRadius: 18,
        padding: '22px 20px',
        boxShadow: '0 10px 24px rgba(200,136,58,0.35), 0 2px 4px rgba(200,136,58,0.2)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* shine */}
        <div style={{
          position: 'absolute', top: -30, right: -30, width: 120, height: 120,
          background: 'radial-gradient(circle, rgba(255,255,255,0.35), transparent 60%)',
        }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 20 }}>🎁</span>
          <span style={{
            fontFamily: RS.font.mono, fontSize: 11, fontWeight: 700, letterSpacing: 1.2,
            color: 'rgba(58,38,8,0.85)', background: 'rgba(255,255,255,0.4)',
            padding: '3px 7px', borderRadius: 4,
          }}>NEW USER</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#3A2608', lineHeight: 1.2 }}>
          新人礼包 · 免费 10 连
        </div>
        <div style={{ fontSize: 12, color: 'rgba(58,38,8,0.72)', marginTop: 6, fontFamily: RS.font.mono }}>
          保底 1 张 🔷 RAR+ · ⚡ LEG 3%
        </div>
        <div style={{
          marginTop: 14, height: 44,
          background: '#2A2218', color: RS.ink.onGold, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 600, gap: 8,
          boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        }}>
          立即抽卡 <span style={{ fontFamily: RS.font.mono }}>→</span>
        </div>
      </div>

      {/* Virtual route card — dimmed */}
      <div style={{
        marginTop: 14, padding: 14,
        background: RS.bg.parchmentDeep, borderRadius: 14,
        border: `1px dashed ${RS.ink.tertiary}`,
        opacity: 0.55,
      }}>
        <div style={{ fontFamily: RS.font.mono, fontSize: 11, color: RS.ink.tertiary, letterSpacing: 0.6 }}>
          ── 关 0 / 0 ──
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: RS.ink.secondary }}>
          ──── 0 分钟 ────
        </div>
        <div style={{ fontSize: 11, color: RS.ink.tertiary, marginTop: 8 }}>
          抽卡后解锁你的第一条路线
        </div>
      </div>

      {/* Pool selector */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.8, marginBottom: 6 }}>
          POOL
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{
            flex: 1, padding: '8px 10px', borderRadius: 10,
            border: `1.5px solid ${RS.accent.gold}`,
            background: 'rgba(200,136,58,0.08)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ color: RS.accent.gold }}>●</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>C#/.NET</span>
            <span style={{ fontSize: 10, fontFamily: RS.font.mono, color: RS.state.ok, marginLeft: 'auto' }}>active</span>
          </div>
          <div style={{
            flex: 1, padding: '8px 10px', borderRadius: 10,
            border: `1px dashed ${RS.ink.tertiary}`,
            display: 'flex', alignItems: 'center', gap: 6,
            opacity: 0.5,
          }}>
            <span style={{ color: RS.ink.tertiary }}>○</span>
            <span style={{ fontSize: 12, color: RS.ink.secondary }}>AWS 证书</span>
            <span style={{ fontSize: 9, color: RS.ink.tertiary, marginLeft: 'auto', fontFamily: RS.font.mono }}>soon</span>
          </div>
        </div>
      </div>

      {/* Relearn empty */}
      <div style={{
        marginTop: 'auto', marginBottom: 4, padding: '14px 16px',
        background: RS.bg.parchmentSoft, borderRadius: 12,
        border: `1px solid rgba(90,75,56,0.1)`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 18 }}>☕</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>还没有需要重学的卡</div>
          <div style={{ fontSize: 10, color: RS.ink.tertiary, marginTop: 2 }}>抽卡后开始累积</div>
        </div>
      </div>

      <TabNav active="home"/>
    </div>
  );
}

// ─── 02 · Free Pull CTA Sheet ───────────────────────────────────
function S02_PullSheet() {
  return (
    <div data-screen-label="02 Pull CTA Sheet" style={{
      width: '100%', height: '100%',
      background: 'rgba(42,34,24,0.55)',
      position: 'relative', overflow: 'hidden',
      fontFamily: RS.font.sans,
    }}>
      {/* background peek of home */}
      <div style={{
        position: 'absolute', inset: 0, background: RS.bg.parchment, opacity: 0.3,
      }}/>
      {/* sheet */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: RS.bg.parchment,
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        padding: '16px 24px 32px',
        boxShadow: '0 -10px 30px rgba(0,0,0,0.25)',
        height: '68%',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* handle */}
        <div style={{ width: 36, height: 4, background: RS.ink.tertiary, opacity: 0.35, borderRadius: 2, margin: '0 auto 16px' }}/>

        <div style={{ fontSize: 11, fontFamily: RS.font.mono, letterSpacing: 1, color: RS.ink.tertiary }}>
          ── NEW USER PACK ──
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>🎁</span> 新人礼包
        </div>
        <div style={{ fontSize: 13, color: RS.ink.secondary, marginTop: 4 }}>
          从 <b style={{ color: RS.rarity.rar }}>C#/.NET</b> 池抽 10 张
        </div>

        {/* Probability table */}
        <div style={{
          marginTop: 16, padding: 14,
          background: RS.bg.parchmentDeep, borderRadius: 12,
        }}>
          <div style={{ fontSize: 10, fontFamily: RS.font.mono, letterSpacing: 0.8, color: RS.ink.tertiary, marginBottom: 10 }}>
            DROP RATES
          </div>
          {[
            { l: '⚡ LEG', p: '3%',  c: RS.rarity.leg, w: '3%' },
            { l: '🔷 RAR', p: '17%', c: RS.rarity.rar, w: '17%' },
            { l: '⚪ COM', p: '80%', c: RS.rarity.com, w: '80%' },
          ].map(r => (
            <div key={r.l} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 64, fontSize: 11, fontFamily: RS.font.mono, fontWeight: 700, color: r.c }}>{r.l}</div>
              <div style={{ flex: 1, height: 6, background: 'rgba(90,75,56,0.12)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: r.w, height: '100%', background: r.c, borderRadius: 3 }}/>
              </div>
              <div style={{ width: 36, textAlign: 'right', fontSize: 11, fontFamily: RS.font.mono, color: RS.ink.secondary }}>{r.p}</div>
            </div>
          ))}
        </div>

        {/* Pity notice */}
        <div style={{
          marginTop: 12, padding: '10px 12px',
          background: 'rgba(232,184,90,0.15)',
          border: `1px solid ${RS.accent.amber}`,
          borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>🔒</span>
          <div style={{ fontSize: 12, color: RS.ink.primary }}>
            第 10 抽保底至少 <b>1 张 🔷 RAR+</b>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ marginTop: 'auto', display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><RSButton variant="outline" full>再看看</RSButton></div>
          <div style={{ flex: 2 }}><RSButton variant="primary" full>开始抽卡 →</RSButton></div>
        </div>
      </div>
    </div>
  );
}

// ─── 03 · Draw Ceremony (Cosmic) ───────────────────────────────
function S03_DrawCeremony() {
  // 40 particles, at least 4 gold
  const particles = Array.from({ length: 40 }, (_, i) => ({
    x: 10 + Math.random() * 80,
    y: 10 + Math.random() * 80,
    size: 2 + Math.random() * 4,
    gold: i < 6,
    delay: Math.random() * 2,
  }));
  return (
    <div data-screen-label="03 Draw Ceremony" style={{
      width: '100%', height: '100%',
      background: `radial-gradient(ellipse at 50% 40%, ${RS.bg.cosmic} 0%, ${RS.bg.cosmicDeep} 100%)`,
      position: 'relative', overflow: 'hidden',
      fontFamily: RS.font.sans,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* starfield */}
      {Array.from({length: 60}).map((_, i) => {
        const x = (i * 37) % 100;
        const y = (i * 53) % 100;
        const s = 1 + (i % 3);
        return (
          <div key={'s'+i} style={{
            position: 'absolute', left: `${x}%`, top: `${y}%`,
            width: s, height: s, borderRadius: s,
            background: i % 7 === 0 ? RS.accent.amber : 'rgba(245,236,196,0.6)',
            opacity: 0.3 + (i % 5) * 0.15,
          }}/>
        );
      })}

      {/* Terminal header */}
      <div style={{
        marginTop: 20, padding: '10px 20px',
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ color: RS.accent.amber, fontFamily: RS.font.mono, fontSize: 12 }}>▸</span>
        <span style={{
          fontFamily: RS.font.mono, fontSize: 11, color: RS.ink.onCosmic, letterSpacing: 0.4,
        }}>recall.draw(n=10)</span>
        <span style={{ color: 'rgba(245,236,196,0.4)', fontFamily: RS.font.mono, fontSize: 11 }}>·</span>
        <span style={{ fontFamily: RS.font.mono, fontSize: 11, color: 'rgba(245,236,196,0.6)' }}>seed #2847a</span>
        <span style={{ color: 'rgba(245,236,196,0.4)', fontFamily: RS.font.mono, fontSize: 11 }}>·</span>
        <span style={{ fontFamily: RS.font.mono, fontSize: 11, color: RS.rarity.rar === '#6E4C9F' ? '#C9ADF7' : RS.ink.onCosmic }}>C#/.NET</span>
      </div>

      {/* Particle convergence */}
      {particles.map((p, i) => (
        <div key={'p'+i} style={{
          position: 'absolute', left: `${p.x}%`, top: `${p.y}%`,
          width: p.size, height: p.size, borderRadius: p.size,
          background: p.gold ? RS.accent.amber : '#C9ADF7',
          boxShadow: p.gold ? `0 0 ${p.size*3}px ${RS.accent.amber}` : `0 0 ${p.size*2}px #C9ADF7`,
          opacity: 0.85,
        }}/>
      ))}

      {/* golden beam from center */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 260, height: 260, borderRadius: 260,
        background: `radial-gradient(circle, ${RS.accent.amber}30 0%, transparent 60%)`,
      }}/>

      {/* card stack in center */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        {[-14, -7, 0, 7, 14].map((r, i) => (
          <div key={i} style={{
            position: 'absolute',
            transform: `translateY(${Math.abs(r)*0.4}px) rotate(${r}deg)`,
            zIndex: 10 - Math.abs(r),
            filter: i === 2 ? 'drop-shadow(0 0 24px rgba(232,184,90,0.5))' : 'none',
          }}>
            <RSCardBack w={156} h={220} hint={i === 2}/>
          </div>
        ))}
      </div>

      {/* Status line */}
      <div style={{ textAlign: 'center', padding: '0 24px 48px' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', borderRadius: 20,
          background: 'rgba(245,236,196,0.08)',
          border: '1px solid rgba(245,236,196,0.15)',
          fontFamily: RS.font.mono, fontSize: 12, color: RS.ink.onCosmic,
          letterSpacing: 0.6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: RS.accent.amber, boxShadow: `0 0 8px ${RS.accent.amber}` }}/>
          drawing_cards... <span style={{ color: RS.accent.amber }}>7/10</span>
        </div>
      </div>
    </div>
  );
}

// ─── 04 · Draw Stage D · 10 Results ─────────────────────────────
function S04_StageD() {
  const hero = { rarity: 'leg', tag: 'ASYNC / AWAIT', keyword: 'Task.Result\nDeadlock', stars: 5 };
  const minis = [
    { rarity: 'rar', tag: 'EF CORE',      keyword: 'N+1 Query',       stars: 4 },
    { rarity: 'rar', tag: 'ASP.NET CORE', keyword: 'DI Lifetimes',    stars: 4 },
    { rarity: 'rar', tag: 'ASP.NET CORE', keyword: 'JWT Auth',        stars: 4 },
    { rarity: 'com', tag: 'PERFORMANCE',  keyword: 'yield return',    stars: 3 },
    { rarity: 'com', tag: 'LINQ',         keyword: 'IEnumerable',     stars: 3 },
    { rarity: 'com', tag: 'LINQ',         keyword: 'Dictionary',      stars: 3 },
    { rarity: 'com', tag: 'OOP',          keyword: 'Delegate',        stars: 3 },
    { rarity: 'com', tag: 'OOP',          keyword: 'record vs class', stars: 3 },
    { rarity: 'com', tag: 'OOP',          keyword: 'Interface',       stars: 3 },
  ];
  return (
    <div data-screen-label="04 Stage D" style={{
      width: '100%', height: '100%',
      background: `linear-gradient(180deg, ${RS.bg.cosmic} 0%, ${RS.bg.cosmicDeep} 100%)`,
      fontFamily: RS.font.sans, color: RS.ink.onCosmic,
      padding: '12px 20px 20px', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      position: 'relative',
    }}>
      {/* starfield subtle */}
      {Array.from({length: 30}).map((_, i) => {
        const x = (i * 41) % 100, y = (i * 59) % 100;
        return <div key={i} style={{
          position: 'absolute', left: `${x}%`, top: `${y}%`,
          width: 1.5, height: 1.5, borderRadius: 1,
          background: 'rgba(245,236,196,0.5)',
        }}/>;
      })}

      {/* Header */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center',
          fontFamily: RS.font.mono, fontSize: 12,
        }}>
          <span style={{ color: RS.accent.amber, fontWeight: 700 }}>1⚡</span>
          <span style={{ color: '#C9ADF7', fontWeight: 700 }}>3🔷</span>
          <span style={{ color: 'rgba(245,236,196,0.75)' }}>6⚪</span>
          <span style={{ opacity: 0.35 }}>·</span>
          <span style={{ opacity: 0.8 }}>C#/.NET</span>
          <span style={{ opacity: 0.35 }}>·</span>
          <span style={{ color: RS.accent.amber }}>Pity hit ⚡</span>
        </div>
      </div>

      {/* Hero card */}
      <div style={{
        marginTop: 12, display: 'flex', justifyContent: 'center',
        position: 'relative', zIndex: 2,
      }}>
        <RSCard rarity="leg" tag="ASYNC / AWAIT" keyword="Task.Result Deadlock" stars={5} badge="NEW" w={240} h={324}/>
      </div>

      {/* Mini grid 3×3 */}
      <div style={{
        marginTop: 12, position: 'relative', zIndex: 2,
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8,
      }}>
        {minis.map((c, i) => (
          <div key={i} style={{ transform: 'scale(1)' }}>
            <RSCard {...c} badge="NEW" w={'100%'} h={128} scale={0.55}/>
          </div>
        ))}
      </div>

      {/* Microcopy + CTAs */}
      <div style={{ marginTop: 'auto', paddingTop: 12, position: 'relative', zIndex: 2 }}>
        <div style={{
          textAlign: 'center', fontSize: 12, color: 'rgba(245,236,196,0.7)',
          marginBottom: 10, fontStyle: 'italic',
        }}>10 cards collected. How much to learn today?</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button style={{
            height: 48, borderRadius: 12,
            background: RS.accent.gold, color: RS.ink.onGold,
            border: 'none', fontWeight: 600, fontSize: 14,
            boxShadow: '0 4px 14px rgba(200,136,58,0.5)',
            fontFamily: RS.font.sans,
          }}>Pick Today's Dose →</button>
          <button style={{
            height: 40, borderRadius: 10,
            background: 'rgba(245,236,196,0.08)',
            border: '1px solid rgba(245,236,196,0.25)',
            color: RS.ink.onCosmic, fontSize: 13, fontWeight: 500,
            fontFamily: RS.font.sans,
          }}>Collect All for Tomorrow</button>
        </div>
      </div>
    </div>
  );
}

// ─── 05 · Daily Dose Selector ───────────────────────────────────
function S05_DailyDose() {
  const doses = [
    { n: '1',   icon: '☕', label: 'Just a taste', time: '~2m',  sel: false },
    { n: '3',   icon: '📖', label: 'Cozy (rec)',  time: '~8m',  sel: true  },
    { n: '5',   icon: '🚀', label: 'Focus',       time: '~13m', sel: false },
    { n: 'All', icon: '🔥', label: 'Full send',   time: '~25m', sel: false },
  ];
  return (
    <div data-screen-label="05 Daily Dose" style={{
      width: '100%', height: '100%',
      background: RS.bg.parchment,
      fontFamily: RS.font.sans, color: RS.ink.primary,
      padding: '16px 24px 28px', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ fontSize: 11, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.8 }}>
        ── TODAY'S DOSE ──
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8, lineHeight: 1.25 }}>
        How much to learn today?
      </div>
      <div style={{ fontSize: 13, color: RS.ink.secondary, marginTop: 4 }}>
        你想今天学几张？
      </div>

      {/* 4-way segmented */}
      <div style={{
        marginTop: 18,
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6,
      }}>
        {doses.map(d => (
          <div key={d.n} style={{
            height: 118,
            borderRadius: 14,
            background: d.sel ? RS.rarity.rar : 'transparent',
            border: d.sel ? 'none' : `1.5px solid ${RS.ink.secondary}`,
            color: d.sel ? '#fff' : RS.ink.primary,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: 6, textAlign: 'center',
            boxShadow: d.sel ? '0 6px 16px rgba(110,76,159,0.4)' : 'none',
            transform: d.sel ? 'scale(1.04)' : 'none',
            transition: 'all .2s',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: RS.font.mono, lineHeight: 1 }}>{d.n}</div>
            <div style={{ fontSize: 20, marginTop: 4 }}>{d.icon}</div>
            <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600, opacity: d.sel ? 1 : 0.85 }}>{d.label}</div>
            <div style={{ fontSize: 10, marginTop: 2, fontFamily: RS.font.mono, opacity: d.sel ? 0.8 : 0.5 }}>{d.time}</div>
          </div>
        ))}
      </div>

      {/* Selected info */}
      <div style={{
        marginTop: 14,
        background: RS.bg.parchmentSoft,
        border: `1px solid ${RS.accent.amber}`,
        borderRadius: 14, padding: 14,
      }}>
        <div style={{ fontSize: 11, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.8 }}>
          SELECTED
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
          3 cards
          <span style={{ color: RS.ink.tertiary, fontWeight: 400 }}>·</span>
          <span style={{ color: RS.ink.secondary, fontWeight: 500 }}>~8 min</span>
          <span style={{ color: RS.ink.tertiary, fontWeight: 400 }}>·</span>
          <span style={{ color: RS.accent.gold, fontWeight: 600 }}>1 Boss ⚔</span>
        </div>
        <div style={{ fontSize: 11, color: RS.ink.tertiary, marginTop: 4, fontFamily: RS.font.mono }}>
          Remaining 7 → tomorrow's queue
        </div>

        {/* 3 mini thumbs */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          {[
            { r:'leg', t:'ASYNC / AWAIT', k:'Task.Result Deadlock', s:5, boss:true },
            { r:'rar', t:'EF CORE',       k:'N+1 Query',            s:4 },
            { r:'com', t:'PERFORMANCE',   k:'yield return',         s:3 },
          ].map((m, i) => (
            <div key={i} style={{ flex: 1, position: 'relative' }}>
              {m.boss && (
                <div style={{
                  position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
                  fontFamily: RS.font.mono, fontSize: 9, fontWeight: 700,
                  background: RS.accent.gold, color: RS.ink.onGold,
                  padding: '2px 6px', borderRadius: 3, zIndex: 2, letterSpacing: 0.5,
                }}>BOSS</div>
              )}
              <RSCard rarity={m.r} tag={m.t} keyword={m.k} stars={m.s} badge={null} w={'100%'} h={128} scale={0.55}/>
            </div>
          ))}
        </div>
      </div>

      {/* CTAs */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <RSButton variant="primary" full>Start Today's Challenge →</RSButton>
        <RSButton variant="outline" full size="sm">Collect all for tomorrow</RSButton>
      </div>
    </div>
  );
}

Object.assign(window, { S01_ColdStartHome, S02_PullSheet, S03_DrawCeremony, S04_StageD, S05_DailyDose });
