# DeveloperCards Design System

Quick reference for the tokens, primitives, and conventions that make DeveloperCards feel like one product across 30+ screens. When in doubt, reach for these — don't hand-roll a new color, padding, or button shape.

---

## 1. Color tokens

Lives at `src/theme/colors.ts`. Three tonal families:

**Parchment surfaces** (default light theme — warm cream, never pure white)

- `parchmentBg` `#FAF3E0` — page background
- `parchmentBgDeep` `#F3E8C8` — gradient stop, headers
- `softCream` `#FCF5EA` — panel surfaces, "lifted" cards
- `softMist` `#F5F2FA`, `softPeach` `#FCE4D2`, `softLavender` `#ECE0F2` — alt panel tones for variety

**Inks** (text)

- `ink` `#2A2218` — body text on parchment
- `inkSoft` `#3A2C1F` — slightly lighter, softer on the eye
- `inkSecondary` `#5A4B38` — sub-titles
- `inkMuted` `#8A7B6A` — captions, hints

**Brand accents**

- `pokeBlue` `#3FB7DB` — primary CTA. Use when the user should "do the thing".
- `pokeBlueDeep` `#2C9CC0` — pressed state of primary CTA.
- `pokeBlueFaint` `#BFE6F1` — hint pills, info banners.
- `glowGold` `#E8B85A`, `gold` `#C8883A` — celebration, eyebrows, rarity stars, milestones.
- `mint` `#7E9D5E` — learning state, "in progress" indicators.
- `danger` `#AA3636` — destructive actions only.

**Rarity tier accents**

- `rarityCommon` `#C9A56C` — COM tier
- `rarityRare` `#A78BD8` — RAR tier
- `rarityLegendary` `#F5C95E` — LEG tier

Use these for halos, borders, accent stripes — never as text color (insufficient contrast).

**Cosmic surface** (the optional dark companion theme — used by AppInfo cosmic mode)

- `cosmicBg` `#0B1030`, `cosmicBgDeep` `#070A1F`, `cosmicInk` `#F5ECC4`

---

## 2. Spacing tokens

Lives at `src/theme/spacing.ts`. Loose 4 → 8 → 12 → 16 → 24 → 32 ladder.

- `xs: 8` — tight gap (within a chip, within a row of icons)
- `sm: 12` — standard gap (between fields, button rows)
- `md: 16` — section gap, panel inner padding
- `lg: 24` — between major content blocks
- `xl: 32` — page-level breathing room
- `screenPadding: 18` — page horizontal margin (every screen, no exceptions)
- `cardRadius: 16` — panel corner radius
- `buttonRadius: 12` — button corner radius

Don't invent new values. If you need `20`, you almost certainly want `md` or `lg`. The product feels more coherent when surfaces share a vertical rhythm.

---

## 3. Typography tokens

Lives at `src/theme/typography.ts`. Size only — weight/letterSpacing live in component styles.

- `title1: 28` — splash, hero headlines
- `title2: 22` — section titles, modal titles
- `title3: 17` — panel titles, card titles
- `body: 15` — paragraph text
- `bodySmall: 13` — secondary paragraph, hints
- `caption: 11` — eyebrows, tiny meta text
- `button: 15` — button labels (PrimaryButton bumps to 16 for emphasis)

Weights: `'900'` for headlines and CTAs, `'800'` for eyebrows, `'700'` for ghost buttons, `'600'` for emphasis within body, `'500'` for body, `'400'` for fine print.

---

## 4. Motion tokens

Lives at `src/theme/motion.ts`. Roles + raw durations + easings.

**Use roles first** (`motion.tap`, `motion.transition`, `motion.hero`, `motion.ceremony`, `motion.idle`). They pair a duration with an easing for a named purpose. Fall through to raw `durations` only when no role fits.

- `tap` 80ms — pressed state changes
- `fast` 160ms — toggles, chip selection
- `transition` 240ms — opacity/position/color shifts, modal in/out
- `pageEnter` / `pageExit` 360ms — screen transitions
- `hero` 480ms — featured pack slide-in, big reveals
- `ceremony` 1200ms — gacha pull animation phases
- `idle` 2400ms — pack bobbing, glow pulses

Easings: `enter`, `exit`, `inOut`, `brand` (subtle overshoot), `emphasized` (fast in, gentle settle), `linear` (only for progress arcs).

Pattern of use:

```ts
Animated.timing(opacity, {
  toValue: 1,
  ...motion.transition,
  useNativeDriver: true,
});
```

---

## 5. UI primitives

Lives at `src/components/ui/`. Cross-screen building blocks. **Reach for these before hand-rolling.** Brand chrome (button radius, eyebrow position, panel shadow) is centralized so retunes happen in one place.

### `PrimaryButton`

The brand pokeBlue 56pt CTA.

- **When to use:** every "do the thing" surface — Home study link, Welcome continue, SessionSummary rewards CTA, Draw open-pack, PermissionPrompt allow.
- **Props:** `label`, `onPress`, `disabled`, `tone` (`primary` | `gold` | `danger`), optional `eyebrow` and `hint`.
- **Why:** before this component existed, the same button shape was duplicated across 12+ screens. Even small changes (a tighter radius, a different disabled tone) used to require a 12-screen sweep.

### `GhostButton`

Transparent secondary action with hairline border.

- **When to use:** brand language for "I'm here if you need me, but I'm not the path the product wants you to take" — Skip, Cancel, Sign in instead, Open 1 vs Open 10.
- **Props:** `label`, `onPress`, `disabled`.

### `RarityStars`

Canonical COM/RAR/LEG indicator — three stars for Legendary, one for Rare, none for Common.

- **When to use:** anywhere card rarity is shown — Library tiles, DrawResult mini-strip, DrawResult featured card, CardDetail rarity chip.
- **Props:** `rarity`, optional `color`, `size`, `letterSpacing`.
- **Why:** one source of truth means a future switch from stars to gem icons is a one-line change.

### `StatePanel`

The "soft cream surface with eyebrow + title + body + action area" panel pattern.

- **When to use:** Home account card, Library banner, SessionSummary reward block, DrawResult featured card frame — anywhere the same chrome would otherwise be hand-rolled per screen.
- **Props:** `eyebrow`, `title`, `body`, `children` (action slot), `tone` (`cream` | `mist` | `peach`).

---

## 6. Per-card emoji identity

Lives at `src/theme/cardIcon.ts`. Maps a card's `Tag` (preferred) or `CodeLanguage` (fallback) to a single emoji.

- **Why:** without it, every card looks like a text-only rectangle. With it, each card carries a small visual signature so the collection feels like collecting *things*, not text snippets.
- **Use:** call `cardIconFor(card)` in any view-model that renders card-tile data.

Tag examples: `closure → 🔗`, `async → ⏳`, `memory → 🧠`, `sql → 🗃️`. Language fallbacks: `cs → 🪟`, `ts → 📘`, `py → 🐍`. Unknown both → `✦`.

---

## 7. Pack art system

Lives at `src/theme/packArt.ts`. PNG covers (preferred) + procedural fallback.

- **PNG covers** are stored under `assets/pack-art/` and registered via `packImageForSlug(slug)`.
- **Slug fuzzy matching** (`normalizeSlugForPack`) lets the app resolve `cs-dotnet → csharp`, `ml-llm → ai`, etc.
- **Procedural fallback** (`packPaletteFromSlug`) returns a deterministic gradient palette derived from the slug, so brand-new decks without a PNG still look styled.

When adding a new pack:
1. Drop the cover PNG at `assets/pack-art/{slug}.png`.
2. Register it in `PACK_PNG` inside `packArt.ts`.
3. If the slug is non-canonical, add an alias to `SLUG_ALIASES`.
4. Confirm `packPaletteFromSlug(slug)` still returns a sensible procedural fallback.

---

## 8. Brand voice — what feels "right"

When designing a new surface, ask:

- **Is the page background parchment?** Always. Pure white feels cold and off-brand.
- **Is the primary action a pokeBlue 56pt button?** If the user should do exactly one thing on this screen, yes.
- **Is the secondary action a ghost button?** If there's a "Skip / Cancel / Other path", make it a GhostButton — never a second filled button competing with the primary.
- **Is gold reserved for celebration?** Eyebrows, rarity stars, milestone glows. Don't use gold as a CTA color (steal from pokeBlue's job).
- **Is motion role-named?** Reach for `motion.transition` before `Animated.timing(..., { duration: 320 })`.
- **Is rhythm hierarchical?** Hero gap > section gap > internal padding > tight chip gap. If everything is `md`, the page reads flat.

---

## 9. What lives where (file map)

```
src/
  theme/
    colors.ts        — color tokens
    spacing.ts       — spacing + radii
    typography.ts    — font sizes
    motion.ts        — durations, easings, motion roles
    animation.ts     — legacy duration map (kept for back-compat; prefer motion.ts)
    cardIcon.ts      — per-card emoji identity
    packArt.ts       — pack PNG registry + procedural fallback
    a11y.ts          — accessibility helpers
  components/
    ui/
      PrimaryButton.tsx
      GhostButton.tsx
      RarityStars.tsx
      StatePanel.tsx
      index.ts        — re-exports
    BottomTabBar.tsx
    ParchmentScaffold.tsx
    AppInfoScreen.tsx
    ...
```

When you find yourself hand-rolling something that smells reusable across screens, hoist it into `src/components/ui/` and update this doc.
