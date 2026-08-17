// UI primitives — opinionated, brand-aligned building blocks.
//
// These are used cross-screen to keep brand voice consistent. When
// brand chrome (button radius, eyebrow color, panel shadow) shifts,
// edit one place and let it cascade.
//
// Components currently exposed:
//   • PrimaryButton — pokeBlue 56pt CTA (with gold + danger tones).
//   • GhostButton   — transparent secondary action.
//   • RarityStars   — canonical COM/RAR/LEG indicator.
//   • StatePanel    — soft-cream eyebrow + title + body card.

export { PrimaryButton } from './PrimaryButton';
export { GhostButton } from './GhostButton';
export { RarityStars } from './RarityStars';
export { StatePanel } from './StatePanel';
