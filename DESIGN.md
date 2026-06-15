# Hobe — Premium Feed Redesign & Design System

A redesign of the watch/feed experience for a short-form video app with same-day Mobile Money payouts. The aim: make the product feel finished and trustworthy, push more of the screen toward the video, and make tipping the easiest action on the page (it is the revenue engine).

The accompanying mockup shows the mobile feed and the adaptive desktop layout side by side.

---

## 1. UX critique of the current build

The current feed works, but reads as a prototype for specific reasons:

- **The video is letterboxed inside black bars.** `object-fit: contain` preserves the whole frame, so portrait clips that aren't a perfect 9:16 leave dead black on the sides. On desktop the whole app is a single phone-width column, so most of the screen is empty. This is the single biggest "unfinished" signal.
- **Weak hierarchy.** Caption, handle and the language pill all sit at a similar size and weight with only a text-shadow separating them from the video. Nothing tells the eye where to land first.
- **The action rail floats.** The buttons are translucent circles with no grouping, so they read as five separate controls hovering over the video rather than one coherent toolset tied to this clip.
- **Creator info is detached.** The avatar, handle and caption are loose text on the video. There's no card, no follow affordance, no verification, no link between "who made this" and "what it is".
- **Tipping is under-sold.** Tip is the business model, but it's a small pill that looks like every other control. The action users should take most is not the most prominent.
- **The bottom nav is flat.** Five equal items, the create button has a gold tile but the bar itself has no depth or clear active state beyond a colour change.
- **No music surface.** A song can be attached now, but nothing on the card shows it, so the feature is invisible.

Business cost of the above: lower tip conversion (the money action is buried), weaker creator trust (no verification or follow), and a first impression that undercuts the "real product" pitch to creators and partners.

---

## 2. Information architecture

Three layers, consistent across breakpoints:

1. **Content layer** — the video, full-bleed, always the focal point.
2. **Context layer** — who made it and what it is: creator card, caption, hashtags, sound. On mobile this overlays the video as a glass card; on desktop it moves into a dedicated right panel.
3. **Action layer** — tip, like, save, repost, share, mute. A grouped vertical rail on both breakpoints.

Primary navigation stays five destinations: Watch, Learn, Create, Market, Wallet. Create is the centre, raised, because uploading is the act that grows supply. Wallet sits last because it's the payoff users return to.

The key IA change for desktop: the single column splits into three (nav rail / video stage / context panel) so horizontal space carries real content instead of black.

---

## 3. Wireframe description

Mobile (single screen, video fills it):

- Top: gradient `hobe.` wordmark left, search right, over a soft top scrim.
- Right rail, vertically centred low: creator avatar with a follow plus, then Tip (largest, gold), Like, Save, Repost, Share, then a smaller Mute set slightly apart.
- Bottom-left: a glass creator card — avatar, name + verification tick, @handle, Follow button, caption, gold hashtags, and a sound row (music icon + track name).
- A thin gold progress bar spans the width above the nav.
- Bottom: five-item nav with a raised gold Create button breaking the bar's top edge.

Desktop (three columns):

- Left 72px icon rail: wordmark, then Watch / Learn / Create / Market / Wallet stacked, active item gold.
- Centre stage: the vertical video at natural aspect, elevated with a shadow on a faintly warm backdrop, the action rail immediately to its right.
- Right 240px panel: creator card with avatar, name, verification, follower and tips-earned stats, a full-width Follow button, caption and hashtags, then an "Up next" list.

---

## 4. High-fidelity visual design

The look keeps the existing near-black canvas and gold accent, but formalises both and adds depth.

- **Background** is not flat black. A very low-intensity warm radial glow in the top corners lifts it off pure `#000` and reads as intentional. The video sits on `#08090d`, not `#000`.
- **Video framing** switches to `object-fit: cover` with a blurred, darkened copy of the same frame behind it to fill any letterbox gap, so there are no hard black bars while the full frame is still reachable. On desktop the clip is a rounded, shadowed card on a warm stage.
- **Glassmorphism** is used once, deliberately: the creator card and the rail buttons use a dark translucent fill with backdrop blur, so they sit on the video without hiding it.
- **Gold** is the single accent. It marks the brand mark, the Tip action, the active nav item, hashtags, verification, and progress. Used sparingly it signals "money / primary", which is exactly the hierarchy the business wants.
- **Type** is tightened: the caption is the second-loudest element after the video, the handle is quiet, metadata is quietest.

---

## 5. Component specifications

Creator card (mobile overlay / desktop panel)
- Fill `rgba(16,18,26,.42)` with `backdrop-filter: blur(14px)`, 1px border `rgba(255,255,255,.08)`, radius 18px, padding 12–13px.
- Row: 34–42px avatar, name 14px/500 + 15px verification tick in gold, @handle 11px muted, Follow pill right-aligned.
- Caption 12.5px at 1.45 line-height; hashtags 12px in gold; sound row 11px muted with a 14px music icon.
- Follow: gold gradient fill, `#221a00` text, 999px radius. After following it becomes a quiet outline "Following".

Action rail
- Buttons are 46px circles (Tip 50px), `rgba(12,14,19,.45)` fill, 1px border `rgba(255,255,255,.1)`, label 11px muted beneath.
- Tip is the gold gradient circle with a coin glyph and a gold glow shadow — visually the loudest control.
- Active states: Like turns `#ff4060`, Save and Repost adopt a gold border and gold glyph when on.
- Icons are one outline set at a consistent 21–24px, fixing the current mixed-weight look.

Bottom nav (mobile)
- 74px bar, `rgba(8,9,13,.86)` with `blur(16px)`, 1px top border `rgba(255,255,255,.07)`.
- Items: 21px icon + 10px label; active item icon gold, label white; inactive muted.
- Create: 54×42 gold gradient tile, radius 16px, raised 12px above the bar with a gold glow.

Buttons
- Primary: gold gradient, `#221a00` text, radius 14px, gold glow, `active: scale(.99)`.
- Ghost: `#1c2029` fill, 1px border, radius 12px.

Inputs
- `#0c0e13` fill, 1px border, radius 12px; focus adds a 3px gold ring at 15% opacity.

---

## 6. Interaction & animation

Keep motion fast (120–220ms) and physical. Suggestions:

- **Tip**: tapping the coin triggers a brief scale-up and a few gold coin particles rising and fading; the sheet then slides up. This makes the money moment feel rewarding and is the one place to spend a little delight.
- **Like**: heart scales to 1.2 and springs back; a faint burst on first like. Double-tap on the video also likes, with the heart appearing where tapped.
- **Save / Repost**: icon fills to gold with a 120ms ease; a short toast confirms.
- **Buttons**: `:active { transform: scale(.92–.99) }` everywhere so every tap feels acknowledged.
- **Nav**: active icon lifts 2px on hover (desktop) and the colour crossfades rather than snapping.
- **Video**: tap to pause shows a centred play glyph that fades; the progress bar is draggable to scrub.
- **Card entrance**: feed cards and panels rise 8px and fade in over 280ms on load.

All of these degrade gracefully — none are required for the action to work, so low-end phones stay usable.

---

## 7. Responsive layouts

- **Mobile (≤640px)**: one video per screen, vertical snap scroll, all context and actions overlay the video. This is unchanged in structure but polished.
- **Tablet (641–1024px)**: video centred at a max width with the action rail moved just outside it, creator info below the video. Black side space becomes padded stage, not void.
- **Desktop (≥1025px)**: the three-column layout — icon nav, centred video stage with side rail, right context panel with creator card and "Up next". This is what removes the empty-sides problem and turns the desktop view into a real browsing surface.

The vertical video stays the hero at every size; only the surrounding furniture reflows.

---

## 8. Design system

Colour
| Token | Value | Use |
|---|---|---|
| bg | `#08090d` | app canvas |
| surface | `#15171f` | cards |
| surface-2 | `#1c2029` | raised / inputs base |
| line | `#2a2f3d` | borders |
| text | `#f4f5f7` | primary text |
| dim | `#8b92a5` | secondary text |
| gold | `#ffc62e` → `#ff9d2e` | brand, Tip, active, hashtags |
| like | `#ff4060` | liked state |
| ok / bad | `#22c55e` / `#f43f5e` | success / error |

Glass fills: `rgba(16,18,26,.42)` (cards), `rgba(12,14,19,.45)` (rail), both with `backdrop-filter: blur(14–16px)`.

Typography — system stack (`system-ui`), two weights only (400, 500/800 for emphasis).
| Role | Size | Weight |
|---|---|---|
| Display / balance | 30–32px | 800 |
| Screen title | 21px | 800 |
| Card name | 14–15px | 500 |
| Body / caption | 12.5–14px | 400 |
| Handle / meta | 11–12px | 400 |
| Section label | 10–11px | 500, uppercase, tracked |

Spacing — 8px grid: 4, 8, 12, 16, 24, 32. Component-internal gaps in px; vertical rhythm in those steps.

Radius: 8 (small), 12 (buttons/inputs), 16 (nav tiles), 18 (cards), 22 (sheet), 999 (pills/avatars).

Shadow:
- `sm` `0 2px 10px rgba(0,0,0,.5)` — avatars, small lifts.
- `md` `0 8px 30px rgba(0,0,0,.45)` — cards, sheets.
- `glow` `0 6px 22px rgba(255,176,46,.42)` — gold primary and Tip only.

Component rules: one accent (gold) reserved for brand and money; glass used only for controls over video; every interactive element has hover (desktop), focus ring, and active scale; icons are one outline set at consistent sizes; never pure black, never more than one gradient family.

---

## 9. Before vs after

| Area | Before | After | Why it matters |
|---|---|---|---|
| Video | letterboxed on black, tiny on desktop | cover-fit with blurred fill; desktop centre stage | removes the "empty / unfinished" read; video dominates |
| Desktop | one phone-width column | three columns (nav / video / context) | fills wasted space with useful content; feels like a product |
| Creator | loose text on video | glass card with avatar, verification, follow, caption, hashtags, sound | builds trust, enables following, ties identity to content |
| Actions | five floating circles | grouped rail, consistent icons, clear states | reads as one toolset; easier to find and use |
| Tip | small pill like the rest | largest control, gold, glow, coin animation | the revenue action becomes the obvious action |
| Nav | flat, equal items | depth, gold active state, raised Create | clearer wayfinding; pushes uploads |
| Sound | invisible | shown on the card with a music row | surfaces a feature users now have |
| Polish | static | tap/hover/active microinteractions | every interaction feels acknowledged and premium |

Each change serves both sides: a calmer, clearer screen for the viewer, and a measurable nudge toward the behaviours that grow the platform — following creators, uploading, and tipping.
