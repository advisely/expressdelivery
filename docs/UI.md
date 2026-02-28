# ExpressDelivery UI Design System

Complete reference for visual effects, animations, themes, layouts, and design patterns used across the application.

## Typography

**Primary Font:** Outfit (self-hosted TTF, 5 weights)

| Weight | Name       | Usage                                 |
| ------ | ---------- | ------------------------------------- |
| 300    | Light      | Subtle labels, helper text            |
| 400    | Regular    | Body text, descriptions               |
| 500    | Medium     | Form labels, secondary buttons        |
| 600    | SemiBold   | Headings, provider names, primary UI  |
| 700    | Bold       | Page titles, welcome heading          |

**Font Stack:** `'Outfit', system-ui, -apple-system, sans-serif`

**Rendering:** `font-synthesis: none`, `text-rendering: optimizeLegibility`, `-webkit-font-smoothing: antialiased`

---

## Theme System

4 themes implemented via CSS custom properties using RGB triplet values (e.g. `79 70 229`) for flexible alpha composition with `rgba()`.

### Light (Default)

| Variable               | RGB Value       | Usage                    |
| ---------------------- | --------------- | ------------------------ |
| `--color-bg-primary`   | `255 255 255`   | Main background          |
| `--color-bg-secondary` | `249 250 251`   | Page/app background      |
| `--color-bg-tertiary`  | `243 244 246`   | Inset surfaces           |
| `--color-bg-elevated`  | `255 255 255`   | Cards, modals            |
| `--color-border`       | `229 231 235`   | Default borders          |
| `--color-border-strong`| `209 213 219`   | Emphasized borders       |
| `--color-text-primary` | `17 24 39`      | Headings, body           |
| `--color-text-secondary`| `75 85 99`     | Descriptions, labels     |
| `--color-text-muted`   | `156 163 175`   | Placeholders, hints      |
| `--color-accent`       | `79 70 229`     | Indigo -- buttons, links |
| `--color-accent-hover` | `67 56 202`     | Darker indigo on hover   |
| `--color-danger`       | `239 68 68`     | Error states             |

### Cream (Solarized)

| Key Difference        | Value            |
| --------------------- | ---------------- |
| `--color-bg-primary`  | `253 246 227`    |
| `--color-text-primary`| `101 123 131`    |
| `--color-accent`      | `181 137 0` (gold) |
| `color-scheme`        | `light`          |

### Midnight (Dark Navy)

| Key Difference        | Value            |
| --------------------- | ---------------- |
| `--color-bg-primary`  | `17 24 39`       |
| `--color-text-primary`| `249 250 251`    |
| `--color-accent`      | `99 102 241` (purple) |
| `color-scheme`        | `dark`           |

### Forest (Dark Green)

| Key Difference        | Value            |
| --------------------- | ---------------- |
| `--color-bg-primary`  | `24 32 28`       |
| `--color-text-primary`| `236 253 245`    |
| `--color-accent`      | `52 211 153` (emerald) |
| `color-scheme`        | `dark`           |

### Alias Variables

Computed from RGB triplets for direct use in component styles:

```css
--bg-primary:     rgb(var(--color-bg-primary));
--glass-bg:       rgba(var(--color-bg-primary), 0.85);
--glass-border:   rgba(var(--color-border), 0.5);
--hover-bg:       rgba(var(--color-text-primary), 0.06);
--surface-overlay: rgba(var(--color-text-primary), 0.04);
--surface-inset:  rgba(var(--color-text-primary), 0.08);
```

### Theme Application

Themes are applied as CSS class on `<html>`:
- Light: no class (`:root` defaults)
- Cream: `.theme-cream`
- Midnight: `.theme-midnight`
- Forest: `.theme-forest`

Managed by `themeStore` (Zustand, persisted to localStorage). Applied in `ThemeContext.tsx` via `useEffect` on `document.documentElement.className`.

---

## Layout System

2 layout modes, persisted via Zustand `themeStore`:

### Vertical (Default 3-Pane)

```
+----------+------------------+---------------------+
| Sidebar  | Thread List      | Reading Pane        |
| 260px    | 360px            | flex: 1             |
|          |                  |                     |
+----------+------------------+---------------------+
```

CSS: `:root.layout-vertical .main-content { flex-direction: row; }`

### Horizontal (Top/Bottom)

```
+----------+-------------------------------------+
| Sidebar  | Thread List (100% width, 45% height)|
| 260px    |------------------------------------|
|          | Reading Pane (flex: 1)              |
+----------+-------------------------------------+
```

CSS: `:root.layout-horizontal .main-content { flex-direction: column; }`

Layout class applied on `<html>` alongside theme class.

---

## Density Modes

3 density modes control the vertical rhythm and type scale of the interface. Applied as a CSS class on `<html>` alongside the theme and layout classes.

| Mode | Class | `--density-padding` | `--density-font-size` | `--density-line-height` |
| ----------- | ---------------------- | ------------------- | --------------------- | ----------------------- |
| Compact | `.density-compact` | `4px 8px` | `13px` | `18px` |
| Comfortable | `.density-comfortable` | `8px 12px` | `14px` | `22px` |
| Relaxed | `.density-relaxed` | `12px 16px` | `15px` | `26px` |

**Comfortable** is the default. Managed by `themeStore` (Zustand, persisted to localStorage). Applied in `ThemeContext.tsx` via `useEffect` on `document.documentElement.className`.

Components consume the CSS custom properties directly:
```css
padding: var(--density-padding);
font-size: var(--density-font-size);
line-height: var(--density-line-height);
```

---

## Reading Pane Zoom

Adjustable zoom level for the email reading pane.

- **Range:** 80% – 150% (default 100%)
- **Step:** 10% per click
- **Mechanism:** Inline `transform: scale()` applied to the reading pane content container
- **Controls:** `ZoomIn` / `ZoomOut` icon buttons in the ReadingPane toolbar
- **Persistence:** Stored in `themeStore` (Zustand, persisted to localStorage)

```css
/* Applied inline on the content wrapper */
transform: scale(var(--reading-zoom));
transform-origin: top left;
```

---

## Folder Colors

8 preset colors selectable per folder via the folder context menu in the Sidebar.

| Swatch | Hex |
| ------ | ------- |
| Red | `#EF4444` |
| Orange | `#F97316` |
| Amber | `#F59E0B` |
| Green | `#22C55E` |
| Teal | `#14B8A6` |
| Blue | `#3B82F6` |
| Violet | `#8B5CF6` |
| Pink | `#EC4899` |

**Display:** 3px colored left-border on the folder row in the Sidebar (`border-left: 3px solid <hex>`).

**Storage:** Hex value stored in `folders.color` column (nullable). No color set = no left-border rendered.

---

## Loading Skeletons

Shimmer placeholder blocks displayed in ThreadList while emails are loading.

```css
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position:  400px 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    rgba(var(--color-bg-tertiary), 1)   0%,
    rgba(var(--color-border), 0.8)      50%,
    rgba(var(--color-bg-tertiary), 1)   100%
  );
  background-size: 800px 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
```

Each skeleton row mimics the ThreadList item layout: a circular avatar placeholder, two lines of text (subject + sender), and a timestamp stub. `prefers-reduced-motion` disables the animation and shows a static muted block instead.

---

## Glassmorphism

Used on: Sidebar, onboarding card, provider cards, server setting cards, modals.

```css
.glass {
    background: var(--glass-bg);           /* rgba(bg-primary, 0.85) */
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-right: 1px solid var(--glass-border);
}
```

Onboarding card uses enhanced glassmorphism:
```css
backdrop-filter: blur(24px);
box-shadow: 0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.05),
            inset 0 1px 0 rgba(255,255,255,0.06);
```

---

## Animations & Effects

### Global Animations (index.css)

| Animation   | Duration | Easing       | Usage                |
| ----------- | -------- | ------------ | -------------------- |
| `fadeIn`    | 0.3s     | ease-out     | `.animate-fade-in` class, general entrances |

### Onboarding Animations (OnboardingScreen.tsx)

9 keyframe animations, all prefixed with `ob-` to avoid global conflicts:

#### `ob-float` -- Organic Drift
```
0%, 100%: translateY(0) rotate(0deg)
33%:      translateY(-18px) rotate(3deg)
66%:      translateY(-10px) rotate(-2deg)
```
**Duration:** 12-14s | **Usage:** Background blob shapes

#### `ob-float-slow` -- Slow Drift
```
0%, 100%: translateY(0) rotate(0deg)
50%:      translateY(-24px) rotate(-4deg)
```
**Duration:** 18-20s | **Usage:** Larger background blobs

#### `ob-shimmer` -- Button Sweep
```
0%:   translateX(-120%)
100%: translateX(220%)
```
**Duration:** 3.2s (1.4s delay) | **Usage:** `::after` pseudo-element on primary buttons, white highlight sweep

#### `ob-jiggle` -- Hover Wobble
```
0%:   rotate(0deg) scale(1)
20%:  rotate(-2deg) scale(1.03)
40%:  rotate(2deg) scale(1.03)
60%:  rotate(-1deg) scale(1.02)
80%:  rotate(1deg) scale(1.02)
100%: rotate(0deg) scale(1)
```
**Duration:** 0.42-0.45s | **Trigger:** `:hover` on provider cards, primary buttons, secondary buttons

#### `ob-pulse-glow` -- Icon Pulse
```
0%, 100%: box-shadow at 0.4 alpha, scale(1)
50%:      box-shadow expanding to 14px ring (fading), scale(1.04)
```
**Duration:** 3s | **Usage:** Mail icon on welcome screen

#### `ob-gradient-shift` -- Background Motion
```
0%:   background-position: 0% 50%
50%:  background-position: 100% 50%
100%: background-position: 0% 50%
```
**Duration:** 14s (background), 6s (title text) | **Usage:** Container animated gradient, title gradient text

#### `ob-shake` -- Error Feedback
```
7-step horizontal shake: 0 -> -6px -> 6px -> -4px -> 4px -> -2px -> 2px -> 0
```
**Duration:** 0.42s | **Trigger:** Error message appearance (re-triggered via React `key` state)

#### `ob-stagger-in` -- Card Entrance
```
from: opacity 0, translateY(14px)
to:   opacity 1, translateY(0)
```
**Duration:** 0.45s | **Delay:** `calc(var(--stagger) * 75ms + 50ms)` per card index

#### `ob-glow-ring` -- Aura Pulse
```
0%, 100%: opacity 0.6, scale(1)
50%:      opacity 0, scale(1.85)
```
**Duration:** 2.4s | **Usage:** Mail icon aura ring

---

## Elevation System

Layered box-shadows for depth perception:

### Level 0 -- Flat
No shadow. Used for inline elements.

### Level 1 -- Resting Cards
```css
box-shadow: 0 4px 20px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06);
```
Used on: Provider cards, server cards at rest.

### Level 2 -- Elevated Cards (Hover)
```css
box-shadow: 0 12px 40px rgba(0,0,0,0.15), 0 4px 12px rgba(0,0,0,0.10);
```
Used on: Provider cards on hover.

### Level 3 -- Main Container
```css
box-shadow: 0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.05),
            inset 0 1px 0 rgba(255,255,255,0.06);
```
Used on: Onboarding card, modal overlays.

### Level 4 -- Primary Buttons
```css
box-shadow: 0 4px 14px rgba(var(--color-accent), 0.35), 0 1px 3px rgba(0,0,0,0.10);
/* Hover: */
box-shadow: 0 6px 20px rgba(var(--color-accent), 0.45), 0 2px 6px rgba(0,0,0,0.12);
```
Colored accent shadows for action buttons.

---

## Background Effects

### Floating Organic Shapes

4 absolutely-positioned divs behind the onboarding card:

| Shape | Size   | Position           | Border-Radius              | Animation     | Opacity |
| ----- | ------ | ------------------ | -------------------------- | ------------- | ------- |
| 1     | 400px  | top: -100, left: -120 | 40% 60% 55% 45% / 50% 45% 55% 50% | ob-float-slow 18s | 0.07 |
| 2     | 280px  | bottom: -70, right: -80 | 30% 70% 60% 40% / 45% 55% 45% 55% | ob-float 14s | 0.06 |
| 3     | 170px  | top: 14%, right: 10% | 60% 40% 50% 50% / 40% 60% 40% 60% | ob-float-slow 20s | 0.05 |
| 4     | 110px  | bottom: 18%, left: 7% | 50% (circle) | ob-float 12s | 0.055 |

All use `accent-color` for the fill, `pointer-events: none`, `z-index: 0`, `aria-hidden="true"`.

### Animated Gradient Container
```css
background: linear-gradient(135deg,
    var(--bg-secondary) 0%,
    var(--bg-tertiary) 40%,
    var(--bg-secondary) 70%,
    var(--bg-primary) 100%
);
background-size: 300% 300%;
animation: ob-gradient-shift 14s ease infinite;
```

---

## Provider Card Design

Each provider has a brand accent color:

| Provider        | Accent Color | Hex       |
| --------------- | ------------ | --------- |
| Gmail           | Red          | `#EA4335` |
| Outlook/Hotmail | Blue         | `#0078D4` |
| Yahoo Mail      | Purple       | `#6001D2` |
| iCloud Mail     | Blue         | `#007AFF` |
| Other/Custom    | Theme accent | `var(--accent-color)` |

Card structure:
```
+---+----------------------------------+---+
| A |  Provider Label (600 weight)     | > |
| c |  Notes (muted, 11px, 2-line)     |   |
| c |                                  |   |
+---+----------------------------------+---+
  ^                                      ^
  5px accent bar                    Chevron arrow
  (expands to 6px on hover)       (slides right on hover)
```

Interaction states:
- **Rest:** `border: 1px solid var(--glass-border)`, Level 1 shadow
- **Hover:** Border changes to provider accent, Level 2 shadow, `ob-jiggle` wobble, arrow slides 2px right

---

## Progress Indicator

Step dots bar at the top of the onboarding card:

```
  [o]  [ ]  [ ]  [ ]     -- Step 1 (welcome)
  [*]  [o]  [ ]  [ ]     -- Step 2 (provider)
  [*]  [*]  [o]  [ ]     -- Step 3 (credentials)
```

| State  | Style                                      |
| ------ | ------------------------------------------ |
| Future | 8x8px circle, `var(--glass-border)` fill   |
| Done   | 8x8px circle, accent at 45% opacity        |
| Active | 24px wide pill, accent fill, 8px glow ring |

Transition: `all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`

---

## Form Input Effects

**Focus glow ring:**
```css
.ob-input:focus {
    border-color: rgba(var(--color-accent), 0.8);
    box-shadow: 0 0 0 3px rgba(var(--color-accent), 0.14),
                0 1px 4px rgba(0,0,0,0.06);
}
```

**Label color shift on focus-within:**
```css
.ob-form-group:focus-within .ob-label {
    color: var(--accent-color);
}
```

**Error shake:** `ob-shake 0.42s` re-triggered per error via React `key={errorKey}` state increment.

---

## Button Effects

### Primary Button
- Background: `var(--accent-color)` with accent-colored shadow
- `::after` shimmer sweep (3.2s loop, 1.4s initial delay)
- Hover: `scale(1.03) rotate(-0.5deg)` via CSS transition (not animation, prevents lock-in)
- Disabled: 60% opacity, `cursor: not-allowed`

### Secondary Button
- Background: `var(--surface-inset)` with glass border
- Hover: `scale(1.02)` via CSS transition + subtle shadow lift

### Provider Card Hover
- Hover: `scale(1.02) rotate(-0.5deg)` via CSS transition (reverts cleanly on mouse-out)
- Border color shifts to provider accent
- Shadow elevates from Level 1 to Level 2
- All hover effects use `transition` (not `animation`) to prevent the card locking in a transformed state

---

## Scrollbar Theming

```css
::-webkit-scrollbar          { width: 8px; height: 8px; }
::-webkit-scrollbar-track    { background-color: transparent; }
::-webkit-scrollbar-thumb    { background: rgb(var(--color-border-strong)); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgb(var(--color-text-muted)); }
```

---

## Icon System

**Runtime icons:** Lucide React (tree-shakeable, SVG-based)

Used icons: `Mail`, `ChevronRight`, `ChevronLeft`, `Eye`, `EyeOff`, `Server`, `Sun`, `Moon`, `Palette`, `Trees`, `LayoutPanelLeft`, `LayoutPanelTop`, `Plus`, `Search`, `Settings`, `Star`, `Trash2`, `Send`, `X`, `Tag`, `Bookmark`, `GripVertical`, `ShieldAlert`, `Code`, `Volume2`, `VolumeX`, `ZoomIn`, `ZoomOut`, `Download`, `Upload`, `Copy`

**App Icon:** Custom SVG in `build/icon.svg`
- 256x256 rounded square
- Gradient: `#4F46E5` (indigo) to `#7C3AED` (purple)
- White envelope + speed-arrow badge
- Generated via `npm run generate:icons` -> PNG (256px, 512px), ICO (multi-size)

---

## Transition Standards

| Property          | Duration | Easing                            |
| ----------------- | -------- | --------------------------------- |
| Color / background| 0.2s     | `ease`                            |
| Box-shadow        | 0.25s    | `ease`                            |
| Border-color      | 0.22-0.28s | `ease`                          |
| Transform         | 0.2s     | `cubic-bezier(0.4, 0, 0.2, 1)`   |
| All (buttons)     | 0.2s     | `cubic-bezier(0.4, 0, 0.2, 1)`   |

---

## Accessibility

- All decorative elements: `aria-hidden="true"`
- Progress dots: `role="progressbar"` with `aria-valuemin` / `aria-valuenow` / `aria-valuemax` + `aria-label="Setup progress"`
- Error messages: `role="alert"` for screen reader announcement
- All form fields: `<label htmlFor>` / `<input id>` associations
- Password toggle: `aria-label="Show password"` / `"Hide password"`
- Color contrast: all themes designed for WCAG AA compliance
- `prefers-reduced-motion: reduce` media query disables all continuous animations (WCAG 2.1 SC 2.3.3):
  - Container gradient shift, background floating shapes, mail icon pulse/glow
  - Button shimmer sweep, provider card stagger-in entrance
  - Hover transforms, error shake
  - Users with vestibular disorders see a clean static UI

---

## CSS Architecture

**Approach:** CSS Modules — co-located `.module.css` files per component. Class names are hashed at build time.

**Module usage convention:** Bracket notation for hyphenated names (`styles['class-name']`). Imported as `import styles from './Component.module.css'`.

**Radix portals** (Dialog, DropdownMenu, Popover) render outside the component tree and cannot be targeted by scoped module selectors. Their classes use `:global(.className)` in the `.module.css` file and remain as plain strings in JSX.

**Namespace convention:** Onboarding uses `ob-` prefix for all classes to avoid collisions with global styles. These keyframes and class names are defined in `OnboardingScreen.module.css`.

**Global styles** live in `src/index.css`:
- Tailwind CSS v4 base (`@import "tailwindcss"`)
- Theme variables (`:root`, `.theme-*`)
- Layout classes (`.layout-vertical`, `.layout-horizontal`)
- Density classes (`.density-compact`, `.density-comfortable`, `.density-relaxed`)
- Utility classes (`.glass`, `.scrollable`, `.animate-fade-in`, `.bg-theme-*`, `.text-theme-*`)
- `@keyframes shimmer` for loading skeleton animation

**Co-located module files:** 10 `.module.css` files, one per major component (e.g. `Sidebar.module.css`, `ThreadList.module.css`, `ReadingPane.module.css`, `ComposeModal.module.css`, `SettingsModal.module.css`, `OnboardingScreen.module.css`, etc.).
