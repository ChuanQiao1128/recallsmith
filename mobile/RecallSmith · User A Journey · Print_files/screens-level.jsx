// screens-level.jsx — Screens 06-09 (home activated → level Q/A → stages 2+3)

// ─── 06 · Home · 3 关路线已激活 ────────────────────────────────
function S06_HomeActivated() {
  return (
    <div data-screen-label="06 Home · Route Activated" style={{
      width: '100%', height: '100%',
      background: RS.bg.parchment,
      fontFamily: RS.font.sans, color: RS.ink.primary,
      padding: '12px 24px 90px', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 11, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.6 }}>
          📖 常规模式 · C#/.NET · route #8f2c
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, lineHeight: 1.3 }}>
          Good afternoon, 小张
        </div>
        <div style={{ fontSize: 12, color: RS.ink.secondary, marginTop: 2, fontFamily: RS.font.mono }}>
          12:32 · 3 关等你
        </div>
      </div>

      {/* Activated Route Card */}
      <div style={{
        marginTop: 14,
        background: `linear-gradient(160deg, #FBF5E5 0%, ${RS.bg.parchmentDeep} 100%)`,
        border: `2px solid ${RS.accent.gold}`,
        borderRadius: 18, padding: 16,
        boxShadow: '0 4px 18px rgba(200,136,58,0.22)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 10, right: 12,
          fontSize: 10, fontWeight: 700, fontFamily: RS.font.mono,
          background: RS.accent.amber, color: '#3A2608',
          padding: '3px 8px', borderRadius: 4, letterSpacing: 0.5,
        }}>+5 free pulls 🎁</div>

        <div style={{ fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 1 }}>
          TODAY'S ROUTE
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, lineHeight: 1.1, fontFamily: RS.font.mono, color: RS.ink.primary }}>
          3 关 / ~8 分钟
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <span style={{ fontSize: 12, color: RS.accent.gold, fontWeight: 600 }}>⚔ 1 Boss</span>
          <span style={{ color: RS.ink.tertiary }}>·</span>
          <span style={{ fontSize: 12, color: RS.ink.secondary }}>2 regular</span>
        </div>
        <div style={{ marginTop: 12 }}>
          <ProgressBar value={0} total={3}/>
          <div style={{ marginTop: 4, fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary }}>0 / 3</div>
        </div>
        <div style={{
          marginTop: 10, padding: '8px 10px',
          background: 'rgba(200,136,58,0.1)',
          borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>⚡</span>
          <div style={{ fontSize: 11, color: RS.ink.secondary }}>
            Boss: <b style={{ color: RS.ink.primary, fontFamily: RS.font.mono }}>Task.Result Deadlock</b>
          </div>
        </div>
      </div>

      {/* CTAs */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <RSButton variant="primary" full>开始今日挑战 →</RSButton>
        <div style={{
          height: 42, borderRadius: 10,
          border: `1px solid ${RS.ink.tertiary}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, fontSize: 12, color: RS.ink.secondary,
        }}>
          <span>🎰</span> 10 连抽 · 保底 <span style={{ fontFamily: RS.font.mono, color: RS.ink.primary }}>0/10</span>
        </div>
      </div>

      {/* Pool pill */}
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <div style={{
          padding: '6px 10px', borderRadius: 9999,
          background: 'rgba(110,76,159,0.1)',
          border: `1px solid ${RS.rarity.rar}`,
          fontSize: 11, fontFamily: RS.font.mono, color: RS.rarity.rar, fontWeight: 600,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: RS.rarity.rar }}/>
          C#/.NET · Day 1 · 10 cards
        </div>
      </div>

      {/* Week heatmap */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.8, marginBottom: 6 }}>
          THIS WEEK
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 44 }}>
          {[0,0,0,0,0,0.7,0].map((v, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: '100%', maxWidth: 26,
                height: Math.max(6, v * 36),
                borderRadius: 3,
                background: v > 0 ? RS.accent.gold : RS.bg.parchmentDeep,
                border: i === 5 ? `1.5px solid ${RS.accent.goldDeep}` : 'none',
              }}/>
              <div style={{ fontSize: 9, fontFamily: RS.font.mono, color: i === 5 ? RS.accent.gold : RS.ink.tertiary, fontWeight: i === 5 ? 700 : 500 }}>
                {['M','T','W','T','F','S','S'][i]}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Relearn */}
      <div style={{
        marginTop: 'auto', padding: '12px 14px',
        background: RS.bg.parchmentSoft, borderRadius: 12,
        border: `1px solid rgba(90,75,56,0.1)`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 16 }}>☕</span>
        <div style={{ fontSize: 12, fontWeight: 500 }}>No cards to relearn</div>
      </div>

      <TabNav active="home"/>
    </div>
  );
}

// ─── 07 · Stage 1/3 Boss Q (题干首次显示) ───────────────────────
function S07_LevelQ() {
  return (
    <div data-screen-label="07 Stage 1/3 Boss Q" style={{
      width: '100%', height: '100%',
      background: RS.bg.parchment,
      fontFamily: RS.font.sans, color: RS.ink.primary,
      padding: '12px 24px 28px', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      position: 'relative',
    }}>
      {/* Boss amber stripe */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 4,
        background: `linear-gradient(90deg, ${RS.accent.gold}, ${RS.accent.amber}, ${RS.accent.gold})`,
      }}/>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div style={{ fontFamily: RS.font.mono, fontSize: 11, color: RS.ink.secondary, letterSpacing: 0.5 }}>
          Stage <b style={{ color: RS.ink.primary }}>1/3</b> · C#/.NET
        </div>
        <div style={{
          fontFamily: RS.font.mono, fontSize: 10, fontWeight: 700, letterSpacing: 1,
          background: RS.accent.gold, color: RS.ink.onGold,
          padding: '4px 10px', borderRadius: 4,
        }}>⚔ BOSS</div>
      </div>

      {/* Rarity + stage indicator row */}
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 8,
          background: 'rgba(200,136,58,0.12)',
          border: `1.5px solid ${RS.accent.gold}`,
        }}>
          <span style={{ fontSize: 12 }}>⚡</span>
          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: RS.font.mono, color: RS.accent.goldDeep, letterSpacing: 0.5 }}>LEG</span>
        </div>
        <div style={{ fontSize: 14, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 2 }}>
          ○○○○○
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, fontFamily: RS.font.mono, color: RS.ink.tertiary }}>
          Q1 · Audience: <b style={{ color: RS.ink.secondary }}>MID</b>
        </div>
      </div>

      {/* Tag */}
      <div style={{ marginTop: 12 }}>
        <TagLabel tag="ASYNC / AWAIT" size={11}/>
      </div>

      {/* Topic Keyword reminder (not a question) */}
      <div style={{
        marginTop: 8,
        fontFamily: RS.font.mono, fontSize: 15, fontWeight: 600,
        color: RS.ink.secondary,
      }}>Task.Result Deadlock</div>

      {/* Q text */}
      <div style={{
        marginTop: 14, padding: '18px 18px',
        background: RS.bg.parchmentSoft,
        borderLeft: `4px solid ${RS.accent.gold}`,
        borderRadius: '8px 14px 14px 8px',
        fontSize: 17, lineHeight: 1.55, color: RS.ink.primary,
        fontStyle: 'italic', textWrap: 'pretty',
      }}>
        "You see <b style={{ fontFamily: RS.font.mono, fontStyle: 'normal', color: RS.accent.goldDeep }}>.Result</b> on a Task in a controller. What can go wrong, and how do you fix it?"
      </div>

      <div style={{
        marginTop: 12, textAlign: 'center',
        fontSize: 12, color: RS.ink.tertiary, fontStyle: 'italic',
      }}>Think first. Tap to reveal.</div>

      {/* Reveal buttons */}
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{
          padding: '14px 16px', borderRadius: 12,
          background: 'transparent',
          border: `1.5px solid ${RS.ink.primary}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 14, fontWeight: 600, color: RS.ink.primary,
        }}>
          Show Answer <span style={{ fontFamily: RS.font.mono }}>↓</span>
        </div>
        <div style={{
          padding: '14px 16px', borderRadius: 12,
          background: 'transparent',
          border: `1.5px solid ${RS.ink.secondary}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 13, fontWeight: 500, color: RS.ink.secondary,
        }}>
          🌍 How it shows up in real code <span style={{ fontFamily: RS.font.mono }}>↓</span>
        </div>
      </div>

      {/* Boss tip */}
      <div style={{
        marginTop: 14, padding: '8px 12px',
        background: 'rgba(232,184,90,0.15)', borderRadius: 10,
        fontSize: 11, color: RS.ink.secondary, textAlign: 'center',
        border: `1px solid rgba(200,136,58,0.3)`,
      }}>
        Boss stage · Mastering earns <b style={{ color: RS.accent.goldDeep }}>+2 progress</b>
      </div>

      {/* Rating pills (grey/inactive) */}
      <div style={{ marginTop: 'auto', paddingTop: 18 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {['Again', 'Hard', 'Good', 'Easy'].map((l, i) => (
            <div key={l} style={{
              flex: 1, height: 48, borderRadius: 10,
              border: `1.5px solid ${RS.ink.tertiary}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              fontSize: 13, fontWeight: 600, color: RS.ink.tertiary,
              opacity: 0.55,
            }}>
              {l}<sup style={{ fontFamily: RS.font.mono, fontSize: 9 }}>{['¹','²','³','⁴'][i]}</sup>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 08 · Stage 1/3 · A + IRL + Code 线性披露 ──────────────────
function S08_LevelA() {
  return (
    <div data-screen-label="08 Stage 1/3 Answer" style={{
      width: '100%', height: '100%',
      background: RS.bg.parchment,
      fontFamily: RS.font.sans, color: RS.ink.primary,
      padding: '12px 20px 24px', overflow: 'auto',
      display: 'flex', flexDirection: 'column',
      position: 'relative',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: `linear-gradient(90deg, ${RS.accent.gold}, ${RS.accent.amber}, ${RS.accent.gold})` }}/>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div style={{ fontFamily: RS.font.mono, fontSize: 11, color: RS.ink.secondary }}>
          Stage <b style={{ color: RS.ink.primary }}>1/3</b> · ⚡ LEG · ASYNC / AWAIT
        </div>
        <div style={{ fontSize: 12, fontFamily: RS.font.mono, color: RS.accent.gold, letterSpacing: 1 }}>●○○○○</div>
      </div>

      {/* Q collapsed */}
      <div style={{
        marginTop: 10, padding: '8px 12px',
        background: RS.bg.parchmentDeep, borderRadius: 8,
        fontSize: 11, color: RS.ink.secondary, fontStyle: 'italic',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>"What can go wrong with .Result?"</span>
        <span style={{ fontFamily: RS.font.mono, color: RS.ink.tertiary }}>↑</span>
      </div>

      {/* A section */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 1, marginBottom: 6 }}>
          ── ANSWER ──
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.55, color: RS.ink.primary, textWrap: 'pretty' }}>
          Calling <Mono>.Result</Mono> <Hi>blocks</Hi> the calling thread. In ASP.NET sync context, this can cause a <Hi>deadlock</Hi> because the awaited continuation tries to resume on the same captured context.
        </div>
      </div>

      {/* Code block — VS Code Dark+ */}
      <div style={{
        marginTop: 12,
        background: RS.code.bg, borderRadius: 12,
        padding: '12px 14px',
        fontFamily: RS.font.mono, fontSize: 11.5, lineHeight: 1.55,
        color: '#D4D4D4',
        boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
      }}>
        <div style={{ color: RS.code.comment }}>{'// ❌ Bad — blocks thread, risks deadlock'}</div>
        <div><span style={{color:RS.code.keyword}}>public</span> <span style={{color:RS.code.type}}>IActionResult</span> <span style={{color:RS.code.fn}}>Get</span>()</div>
        <div>{'{'}</div>
        <div style={{ paddingLeft: 16 }}>
          <span style={{color:RS.code.keyword}}>var</span> <span style={{color:RS.code.ident}}>user</span> = <span style={{color:RS.code.ident}}>_svc</span>.<span style={{color:RS.code.fn}}>GetUserAsync</span>().<span style={{color:RS.code.ident}}>Result</span>;  <span style={{color:RS.code.comment}}>{'// ← deadlock risk'}</span>
        </div>
        <div style={{ paddingLeft: 16 }}>
          <span style={{color:RS.code.keyword}}>return</span> <span style={{color:RS.code.fn}}>Ok</span>(<span style={{color:RS.code.ident}}>user</span>);
        </div>
        <div>{'}'}</div>
        <div style={{ height: 8 }}/>
        <div style={{ color: RS.code.comment }}>{'// ✅ Good — async all the way'}</div>
        <div>
          <span style={{color:RS.code.keyword}}>public</span> <span style={{color:RS.code.keyword}}>async</span> <span style={{color:RS.code.type}}>Task</span>{'<'}<span style={{color:RS.code.type}}>IActionResult</span>{'>'} <span style={{color:RS.code.fn}}>Get</span>()
        </div>
        <div>{'{'}</div>
        <div style={{ paddingLeft: 16 }}>
          <span style={{color:RS.code.keyword}}>var</span> <span style={{color:RS.code.ident}}>user</span> = <span style={{color:RS.code.keyword}}>await</span> <span style={{color:RS.code.ident}}>_svc</span>.<span style={{color:RS.code.fn}}>GetUserAsync</span>();
        </div>
        <div style={{ paddingLeft: 16 }}>
          <span style={{color:RS.code.keyword}}>return</span> <span style={{color:RS.code.fn}}>Ok</span>(<span style={{color:RS.code.ident}}>user</span>);
        </div>
        <div>{'}'}</div>
      </div>

      {/* IRL card */}
      <div style={{
        marginTop: 12,
        background: RS.bg.irl, borderRadius: 12,
        padding: 14, borderLeft: `3px solid ${RS.state.info}`,
      }}>
        <div style={{ fontSize: 11, fontFamily: RS.font.mono, color: RS.state.info, letterSpacing: 0.6, fontWeight: 600 }}>
          🌍 HOW IT SHOWS UP IN REAL CODE
        </div>
        <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: RS.ink.primary, textWrap: 'pretty' }}>
          Legacy ASP.NET controllers calling <Mono>.Result</Mono> or <Mono>.Wait()</Mono> on async methods. Symptoms: slow endpoints, thread pool exhaustion, mysterious hangs under load.
        </div>
      </div>

      {/* Rating pills — active · Hard picked */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary, letterSpacing: 0.8, marginBottom: 6 }}>
          HOW DID YOU DO?
        </div>
        <RatingPills picked="hard"/>
        <div style={{ marginTop: 6, fontSize: 10, fontFamily: RS.font.mono, color: RS.grade.hard, textAlign: 'right' }}>
          Next review in ~2d · difficulty +0.15
        </div>
      </div>
    </div>
  );
}

function Mono({ children }) {
  return <code style={{
    fontFamily: RS.font.mono, fontSize: '0.92em',
    background: 'rgba(42,34,24,0.07)', padding: '1px 5px',
    borderRadius: 3, color: RS.accent.goldDeep, fontWeight: 500,
  }}>{children}</code>;
}
function Hi({ children }) {
  return <span style={{ background: `${RS.grade.good}33`, padding: '1px 4px', borderRadius: 3, fontWeight: 600 }}>{children}</span>;
}

// ─── 09 · Stage 2/3 + 3/3 合屏快进 ─────────────────────────────
function S09_StageSplit() {
  return (
    <div data-screen-label="09 Stage 2+3 split" style={{
      width: '100%', height: '100%',
      background: RS.bg.parchment,
      fontFamily: RS.font.sans, color: RS.ink.primary,
      padding: '10px 18px 16px', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      position: 'relative',
    }}>
      {/* Toast stack · top-right */}
      <div style={{
        position: 'absolute', top: 8, right: 14, zIndex: 20,
        display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end',
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            padding: '6px 10px', borderRadius: 8,
            background: `linear-gradient(135deg, ${RS.accent.amber}, ${RS.accent.gold})`,
            color: '#3A2608', fontSize: 11, fontWeight: 700,
            fontFamily: RS.font.mono, letterSpacing: 0.3,
            boxShadow: '0 4px 10px rgba(200,136,58,0.4)',
            opacity: 0.6 + i * 0.2,
            transform: `translateX(${i * -2}px)`,
          }}>+1 free pull 🎁</div>
        ))}
        <div style={{
          marginTop: 2, fontSize: 10, fontFamily: RS.font.mono,
          color: RS.accent.goldDeep, fontWeight: 600,
        }}>3 pulls earned</div>
      </div>

      {/* Top half — Stage 2 */}
      <div style={{
        flex: 1, padding: '10px 4px',
        borderBottom: `1.5px dashed rgba(90,75,56,0.25)`,
      }}>
        <div style={{ fontFamily: RS.font.mono, fontSize: 10, color: RS.ink.tertiary, letterSpacing: 0.5 }}>
          Stage <b style={{ color: RS.ink.primary }}>2/3</b> · 🔷 RAR · <span style={{ color: RS.tag['EF CORE'] }}>EF CORE</span> · Q6 · MID
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: RS.font.mono, marginTop: 4, color: RS.ink.primary }}>
          N+1 Query
        </div>
        <div style={{
          marginTop: 6, fontSize: 12, fontStyle: 'italic', color: RS.ink.secondary,
          padding: '6px 10px', borderLeft: `3px solid ${RS.rarity.rar}`, background: RS.bg.parchmentSoft,
        }}>"How do you spot and fix N+1 in EF Core?"</div>
        <div style={{ marginTop: 6, fontSize: 11, color: RS.ink.primary, lineHeight: 1.4 }}>
          Use <Mono>.Include()</Mono> or projection to avoid lazy loading per row.
        </div>
        <div style={{
          marginTop: 6, padding: '8px 10px',
          background: RS.code.bg, borderRadius: 8,
          fontFamily: RS.font.mono, fontSize: 10.5, color: '#D4D4D4',
        }}>
          <span style={{color:RS.code.ident}}>context</span>.<span style={{color:RS.code.ident}}>Orders</span>.<span style={{color:RS.code.fn}}>Include</span>(<span style={{color:RS.code.ident}}>o</span> =&gt; <span style={{color:RS.code.ident}}>o</span>.<span style={{color:RS.code.ident}}>Items</span>).<span style={{color:RS.code.fn}}>ToList</span>();
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            padding: '7px 16px', borderRadius: 8,
            background: RS.grade.good, color: '#fff',
            fontSize: 12, fontWeight: 700, fontFamily: RS.font.sans,
            boxShadow: `0 3px 10px ${RS.grade.good}55`,
          }}>Good ³ ✓</div>
          <div style={{ fontSize: 11, fontFamily: RS.font.mono, color: RS.grade.good, letterSpacing: 1 }}>●○○○○</div>
          <div style={{ marginLeft: 'auto', fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary }}>next · 3d</div>
        </div>
      </div>

      {/* Bottom half — Stage 3 */}
      <div style={{ flex: 1, padding: '10px 4px 4px' }}>
        <div style={{ fontFamily: RS.font.mono, fontSize: 10, color: RS.ink.tertiary, letterSpacing: 0.5 }}>
          Stage <b style={{ color: RS.ink.primary }}>3/3</b> · ⚪ COM · <span style={{ color: RS.tag['PERFORMANCE'] }}>PERFORMANCE</span> · Q9 · JR
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: RS.font.mono, marginTop: 4, color: RS.ink.primary }}>
          yield return
        </div>
        <div style={{
          marginTop: 6, fontSize: 12, fontStyle: 'italic', color: RS.ink.secondary,
          padding: '6px 10px', borderLeft: `3px solid ${RS.rarity.com}`, background: RS.bg.parchmentSoft,
        }}>"Why use yield return for a million-row CSV?"</div>
        <div style={{ marginTop: 6, fontSize: 11, color: RS.ink.primary, lineHeight: 1.4 }}>
          <Mono>yield return</Mono> streams items lazily; no huge List in memory.
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            padding: '7px 16px', borderRadius: 8,
            background: RS.grade.good, color: '#fff',
            fontSize: 12, fontWeight: 700, fontFamily: RS.font.sans,
            boxShadow: `0 3px 10px ${RS.grade.good}55`,
          }}>Good ³ ✓</div>
          <div style={{ fontSize: 11, fontFamily: RS.font.mono, color: RS.grade.good, letterSpacing: 1 }}>●○○○○</div>
          <div style={{ marginLeft: 'auto', fontSize: 10, fontFamily: RS.font.mono, color: RS.ink.tertiary }}>next · 2d</div>
        </div>
      </div>

      {/* Final progress bar */}
      <div style={{
        marginTop: 10, padding: '10px 14px',
        background: `linear-gradient(135deg, ${RS.state.ok}, #9EBD7E)`,
        color: '#fff', borderRadius: 10,
        display: 'flex', alignItems: 'center', gap: 10,
        boxShadow: `0 4px 12px ${RS.state.ok}66`,
      }}>
        <span style={{ fontSize: 18 }}>✓</span>
        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: RS.font.mono }}>3 / 3 cleared</div>
        <div style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.9 }}>tap to wrap up →</div>
      </div>
    </div>
  );
}

Object.assign(window, { S06_HomeActivated, S07_LevelQ, S08_LevelA, S09_StageSplit, Mono, Hi });
