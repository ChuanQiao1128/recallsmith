// screens-wrap.jsx — Screens 10-12 (settlement, library, home Day-1 done)

// ─── 10 · Settlement ────────────────────────────────────────────
function S10_Settlement() {
  return (
    <div data-screen-label="10 Settlement" style={{
      width: '100%', height: '100%',
      background: RS.bg.parchment,
      fontFamily: RS.font.sans, color: RS.ink.primary,
      padding: '12px 22px 24px', overflow: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* terminal header */}
      <div style={{ fontFamily: RS.font.mono, fontSize: 10, color: RS.ink.tertiary, letterSpacing: 0.5 }}>
        ▸ session #2847 · <span style={{ color: RS.state.ok }}>closed</span> · Today's wrap-up
      </div>

      {/* big celebration */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2, fontFamily: RS.font.mono, color: RS.ink.primary }}>
          3/3 cleared <span style={{ color: RS.state.ok }}>✓</span>
        </div>
        <div style={{ fontSize: 13, color: RS.ink.secondary, marginTop: 4 }}>
          8m 14s · Right on pace 🎉
        </div>
      </div>

      {/* 3 big stats */}
      <div style={{
        marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
      }}>
        {[
          { n: '100%', l: 'clear rate', c: RS.state.ok },
          { n: '3',    l: 'learned',    c: RS.rarity.rar },
          { n: '+1',   l: 'mastered',   c: RS.accent.gold },
        ].map((s, i) => (
          <div key={i} style={{
            padding: 12, background: RS.bg.parchmentSoft,
            borderRadius: 10, textAlign: 'center',
            border: `1px solid ${s.c}33`,
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: RS.font.mono, color: s.c }}>{s.n}</div>
            <div style={{ fontSize: 10, color: RS.ink.tertiary, marginTop: 2, fontFamily: RS.font.mono, letterSpacing: 0.4 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* GradeMixBar */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.8, marginBottom: 6 }}>
          GRADE MIX · SUM = 3
        </div>
        <div style={{
          display: 'flex', height: 28, borderRadius: 6, overflow: 'hidden',
          background: RS.bg.parchmentDeep,
        }}>
          <div style={{ width: '33.3%', background: RS.grade.hard, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>Hard 1</div>
          <div style={{ width: '66.7%', background: RS.grade.good, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>Good 2</div>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary }}>
          <span>Again 0</span><span>Hard 1</span><span>Good 2</span><span>Easy 0</span>
        </div>
      </div>

      {/* Mental ledger */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.8, marginBottom: 8 }}>
          MENTAL LEDGER
        </div>
        {[
          { i: '🎓', l: 'Learned:', v: 'N+1 Query · yield return', d: '+2', c: RS.rarity.rar },
          { i: '💎', l: 'Mastered:', v: 'Task.Result Deadlock', d: '+1', c: RS.accent.gold, hi: true },
          { i: '🪙', l: 'Newly drawn:', v: "Today's pull", d: '+10 (3 learned · 7 tomorrow)', c: RS.ink.secondary },
          { i: '🌫', l: 'Faded:', v: '—', d: '0 cards', c: RS.ink.tertiary },
        ].map((r, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: r.hi ? '10px 12px' : '8px 2px',
            background: r.hi ? `linear-gradient(90deg, rgba(232,184,90,0.18), transparent)` : 'transparent',
            border: r.hi ? `1.5px solid ${RS.accent.gold}` : 'none',
            borderRadius: 10, marginBottom: 4,
          }}>
            <div style={{ fontSize: 18 }}>{r.i}</div>
            <div style={{ fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: r.c }}>{r.l}</span>{' '}
              <span style={{ color: RS.ink.primary }}>{r.v}</span>
            </div>
            <div style={{ marginLeft: 'auto', fontFamily: RS.font.mono, fontSize: 11, color: r.c, fontWeight: 700 }}>{r.d}</div>
          </div>
        ))}
      </div>

      {/* Day-1 reward banner */}
      <div style={{
        marginTop: 10,
        background: `linear-gradient(135deg, ${RS.accent.amber} 0%, ${RS.accent.gold} 100%)`,
        borderRadius: 14, padding: 14,
        boxShadow: '0 6px 18px rgba(200,136,58,0.4)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, background: 'radial-gradient(circle, rgba(255,255,255,0.35), transparent 60%)' }}/>
        <div style={{ fontSize: 11, fontFamily: RS.font.mono, fontWeight: 700, color: 'rgba(58,38,8,0.75)', letterSpacing: 0.8 }}>
          🎁 DAY-1 BONUS
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#3A2608', marginTop: 4, lineHeight: 1.3 }}>
          You earned 3 free single-pulls!
        </div>
        <div style={{ fontSize: 11, color: 'rgba(58,38,8,0.75)', marginTop: 2 }}>
          Use now or keep for tomorrow?
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <div style={{ flex: 1, height: 38, borderRadius: 8, border: '1.5px solid #3A2608', color: '#3A2608', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>Pull Now</div>
          <div style={{ flex: 1.3, height: 38, borderRadius: 8, background: '#2A2218', color: RS.ink.onGold, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>Save for tomorrow</div>
        </div>
      </div>

      {/* Tomorrow preview */}
      <div style={{
        marginTop: 10, padding: 12,
        background: RS.bg.parchmentSoft, borderRadius: 10,
        border: `1px dashed ${RS.ink.tertiary}`,
      }}>
        <div style={{ fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.8 }}>TOMORROW</div>
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: RS.ink.primary }}>
          7 cards · ~15 min · mix of RAR & COM
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <RSButton variant="outline" size="sm" full>Home</RSButton>
        <RSButton variant="outline" size="sm" full>Draw again</RSButton>
      </div>
    </div>
  );
}

// ─── 11 · Library · 10/115 ─────────────────────────────────────
function S11_Library() {
  const learned = [
    { rarity: 'leg', tag: 'ASYNC / AWAIT', keyword: 'Task.Result Deadlock', stars: 5, badge: '💎 1/5' },
    { rarity: 'rar', tag: 'EF CORE',       keyword: 'N+1 Query',            stars: 4, badge: '🎓 1/5' },
    { rarity: 'com', tag: 'PERFORMANCE',   keyword: 'yield return',         stars: 3, badge: '🎓 1/5' },
  ];
  const drawn = [
    { rarity: 'rar', tag: 'ASP.NET CORE', keyword: 'DI Lifetimes', stars: 4, badge: '🪙 0/5' },
    { rarity: 'rar', tag: 'ASP.NET CORE', keyword: 'JWT Auth',     stars: 4, badge: '🪙 0/5' },
    { rarity: 'com', tag: 'LINQ',         keyword: 'IEnumerable',  stars: 3, badge: '🪙 0/5' },
    { rarity: 'com', tag: 'LINQ',         keyword: 'Dictionary',   stars: 3, badge: '🪙 0/5' },
    { rarity: 'com', tag: 'OOP',          keyword: 'Delegate',     stars: 3, badge: '🪙 0/5' },
    { rarity: 'com', tag: 'OOP',          keyword: 'record',       stars: 3, badge: '🪙 0/5' },
    { rarity: 'com', tag: 'OOP',          keyword: 'Interface',    stars: 3, badge: '🪙 0/5' },
  ];
  return (
    <div data-screen-label="11 Library" style={{
      width: '100%', height: '100%',
      background: RS.bg.parchment,
      fontFamily: RS.font.sans, color: RS.ink.primary,
      padding: '12px 18px 90px', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 11, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.5 }}>
          Library · <b style={{ color: RS.ink.primary }}>C#/.NET</b> ▾
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 24, fontWeight: 700, fontFamily: RS.font.mono }}>10 / 115</div>
          <div style={{ fontSize: 12, color: RS.state.ok, fontFamily: RS.font.mono, fontWeight: 600 }}>collected · 8.7%</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <ProgressBar value={10} total={115}/>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ marginTop: 12, display: 'flex', gap: 6, overflowX: 'auto' }}>
        {[
          { k: 'all', l: 'All', active: true },
          { k: 'com', l: '⚪ COM' },
          { k: 'rar', l: '🔷 RAR' },
          { k: 'leg', l: '⚡ LEG' },
          { k: 'un',  l: '🌫 Unpulled' },
        ].map(c => (
          <div key={c.k} style={{
            padding: '6px 12px', borderRadius: 9999,
            background: c.active ? RS.rarity.rar : 'transparent',
            border: c.active ? 'none' : `1px solid ${RS.ink.tertiary}`,
            color: c.active ? '#fff' : RS.ink.secondary,
            fontSize: 11, fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>{c.l}</div>
        ))}
      </div>

      {/* Sort row */}
      <div style={{ marginTop: 8, display: 'flex', gap: 10, fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary }}>
        <span>Sort: <b style={{ color: RS.ink.secondary }}>Rarity ▾</b></span>
        <span>View: <b style={{ color: RS.ink.secondary }}>Grid ▾</b></span>
      </div>

      {/* Grid */}
      <div style={{
        marginTop: 10, flex: 1, overflowY: 'auto',
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8, alignContent: 'start',
      }}>
        {learned.map((c, i) => <RSCard key={'l'+i} {...c} w={'100%'} h={148} scale={0.62}/>)}
        {drawn.map((c, i) => <RSCard key={'d'+i} {...c} w={'100%'} h={148} scale={0.62}/>)}
        {/* Unpulled row */}
        {[0,1,2,3,4,5].map(i => (
          <div key={'u'+i} style={{ opacity: 0.45 }}>
            <RSCard rarity={i === 0 ? 'leg' : i === 1 ? 'rar' : 'com'} locked w={'100%'} h={148} scale={0.62}/>
          </div>
        ))}
      </div>

      <div style={{
        textAlign: 'center', fontSize: 10, color: RS.ink.tertiary, fontFamily: RS.font.mono,
        marginTop: 6, marginBottom: 2,
      }}>↓ 35 more rows · scroll to explore</div>

      <TabNav active="library"/>
    </div>
  );
}

// ─── 12 · Home · Day 1 完成 ────────────────────────────────────
function S12_HomeDay1Done() {
  return (
    <div data-screen-label="12 Home · Day 1 done" style={{
      width: '100%', height: '100%',
      background: RS.bg.parchment,
      fontFamily: RS.font.sans, color: RS.ink.primary,
      padding: '12px 22px 90px', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div>
        <div style={{ fontSize: 11, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.5 }}>
          📖 常规模式 · C#/.NET · <span style={{ color: RS.state.ok }}>Day 1 ✓</span>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8, lineHeight: 1.3, textWrap: 'pretty' }}>
          Well done, see you tomorrow
        </div>
        <div style={{ fontSize: 12, color: RS.ink.secondary, marginTop: 4 }}>
          明日 7 关等你 · 12:43 · 13 min total
        </div>
      </div>

      {/* Route card · completed */}
      <div style={{
        marginTop: 14,
        background: `linear-gradient(160deg, ${RS.bg.parchmentSoft} 0%, rgba(126,157,94,0.12) 100%)`,
        border: `1.5px solid ${RS.state.ok}`,
        borderRadius: 16, padding: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 14,
            background: RS.state.ok, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, fontWeight: 700,
          }}>✓</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: RS.font.mono }}>
            3 / 3 · 8m 14s
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: RS.state.ok, fontFamily: RS.font.mono, fontWeight: 600 }}>DONE</div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: RS.ink.tertiary, fontFamily: RS.font.mono, letterSpacing: 0.4 }}>
          NEXT UP
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: RS.ink.secondary, lineHeight: 1.5 }}>
          DI Lifetimes · JWT Auth · IEnumerable · Dictionary · +3 more
        </div>
      </div>

      {/* Reward recap */}
      <div style={{
        marginTop: 12, padding: '10px 14px',
        background: `linear-gradient(90deg, rgba(232,184,90,0.2), rgba(232,184,90,0.08))`,
        border: `1px solid ${RS.accent.gold}`,
        borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 18 }}>🎁</span>
        <div style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>
          3 free pulls earned · <span style={{ color: RS.accent.goldDeep, fontFamily: RS.font.mono }}>saved for tomorrow</span>
        </div>
        <span style={{ fontSize: 16, color: RS.accent.gold }}>✓</span>
      </div>

      {/* Pool pill */}
      <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <div style={{
          padding: '5px 10px', borderRadius: 9999,
          background: 'rgba(110,76,159,0.1)',
          border: `1px solid ${RS.rarity.rar}`,
          fontSize: 10, fontFamily: RS.font.mono, color: RS.rarity.rar, fontWeight: 600,
        }}>C#/.NET</div>
        <div style={{
          padding: '5px 10px', borderRadius: 9999,
          background: RS.bg.parchmentDeep, fontSize: 10,
          fontFamily: RS.font.mono, color: RS.ink.secondary, fontWeight: 500,
        }}>Pity 0/10</div>
        <div style={{
          padding: '5px 10px', borderRadius: 9999,
          background: RS.bg.parchmentDeep, fontSize: 10,
          fontFamily: RS.font.mono, color: RS.ink.secondary, fontWeight: 500,
        }}>Collected 10/115</div>
      </div>

      {/* Week heatmap */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.8, marginBottom: 6 }}>
          THIS WEEK
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 56 }}>
          {[0,0,0,0,0,1,0].map((v, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: '100%', maxWidth: 26,
                height: Math.max(6, v * 44),
                borderRadius: 3,
                background: v > 0 ? RS.state.ok : RS.bg.parchmentDeep,
                position: 'relative',
              }}/>
              <div style={{ fontSize: 9, fontFamily: RS.font.mono, color: i === 5 ? RS.state.ok : RS.ink.tertiary, fontWeight: i === 5 ? 700 : 500 }}>
                {['M','T','W','T','F','S','S'][i]}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 4, fontSize: 10, fontFamily: RS.font.mono, color: RS.state.ok, textAlign: 'center' }}>
          ● 3 cards learned today
        </div>
      </div>

      {/* Tomorrow preview card */}
      <div style={{
        marginTop: 'auto', marginBottom: 10,
        padding: 14,
        background: RS.bg.parchmentSoft,
        border: `1px dashed ${RS.ink.tertiary}`,
        borderRadius: 14,
      }}>
        <div style={{ fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.8 }}>
          🌙 TOMORROW
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, fontFamily: RS.font.mono }}>
          7 cards · ~15 min
        </div>
        <div style={{ fontSize: 11, color: RS.ink.secondary, marginTop: 2 }}>
          <span style={{ color: RS.rarity.rar, fontWeight: 600 }}>3 RAR</span> + <span style={{ color: RS.rarity.com, fontWeight: 600 }}>4 COM</span>
        </div>
      </div>

      <div style={{ marginBottom: 4 }}>
        <RSButton variant="outline" full size="sm">Draw again</RSButton>
      </div>

      <TabNav active="home"/>
    </div>
  );
}

Object.assign(window, { S10_Settlement, S11_Library, S12_HomeDay1Done });
