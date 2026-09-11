# ModelShelf App (Light) — implementable design spec

Source artboard: `/mnt/c/Users/Daniel/orca/ModelShelf/design/claude-design/ModelShelf App (Light).dc.html` (142,407 bytes, 785 lines). Renderer: `./support.js` (React 18.3, `createElement`; no Babel/JSX in the artboard).

## 0. Scope corrections to the brief

| Brief said | File actually contains |
|---|---|
| "single screen" | 11 screens in sibling `<sc-if>` blocks: `findings` (default), `dash`, `deliveries`, `runs`, `changes`, `models`, `packs`, `views`, `members`, `settings`, `isStub` (fallback). The shell (sidebar, header, footer) is shared and sits outside every `sc-if`. |
| "inline `<script data-dc-script>` JSX/Babel block" | Not JSX. A `class Component extends DCLogic` with `state`, `go()`, `navVals()`, `renderVals()`. The markup is plain HTML with `{{ expr }}` value bindings, `onClick="{{ handler }}"`, and `<sc-if value="{{ bool }}">` control flow resolved by `support.js`. |
| "center 3D viewer pane" | A static placeholder: `#ececeb` fill plus a 135° hatch and the mono caption `combined ifc model — canvas`. No canvas, no WebGL, no image. |
| "left sidebar, center viewer, right findings panel" | Correct for the `findings` screen. It is a **two**-column grid inside the main column, not a three-pane grid; the sidebar is a flex sibling of the whole main column, not a grid track. |

Preview frame: `data-props` = `{"$preview":{"width":1440,"height":900}}`.

`style-hover="..."` attributes appear 9 times. **`support.js` does not implement `style-hover`** (no occurrence of the string in the file). They never render. Treat them as authored hover intent, listed in §5.

---

## 1. Color tokens

57 distinct hex values + 3 rgba values + the `transparent` keyword = **60 color values**. Two are casing/shorthand duplicates of others and should be normalized: `#dedeDA` (line 125, one use) → `#dededa`; `#fff` (one use, nav count badge) → `#ffffff`.

Group counts: paper/background **4**, surface **9**, border **8**, text **6**, accent **6**, severity **19**, state/semantic **8**.

### 1.1 Paper / background (4)

| Hex | Proposed var | Where |
|---|---|---|
| `#f2f2f0` | `--ms-paper` | `body` background, app root background, sidebar-item hover fill, active language pill fill, neutral badge fill, neutral avatar fill (25 uses) |
| `#f7f7f6` | `--ms-paper-inset` | Background of every scrolling content pane (dash, runs right, packs right, views left, members, settings, stub) (11 uses) |
| `#ececeb` | `--ms-canvas` | Viewer placeholder, view-card thumbnails, changes diff overlay (6 uses) |
| `rgba(0,0,0,0.04)` | `--ms-hatch` | Stripe color in `repeating-linear-gradient(135deg, rgba(0,0,0,0.04) 0 1px, transparent 1px 10px)` (6 uses) |

### 1.2 Surface (9)

| Hex | Proposed var | Where |
|---|---|---|
| `#ffffff` | `--ms-surface` | Sidebar, header, footer, cards, right panels, buttons, inputs (86 uses; plus one `#fff`) |
| `#fafafa` | `--ms-surface-subtle` | Table header rows, stat tiles, project switcher, severity group headers, mini-table headers (21 uses) |
| `rgba(255,255,255,0.92)` | `--ms-glass` | Viewer floating panels: tool palette, isolate banner, view-mode switch, view-card thumb badge (7 uses) |
| `rgba(255,255,255,0.94)` | — | Severity legend panel only (1 use). **Inconsistent** with `--ms-glass`; standardize on `0.92`. |
| `#f4faf9` | `--ms-row-selected` | Selected-row tint (expanded finding, selected delivery, selected run, selected pack, selected change) (5 uses) |
| `#fef7f6` | `--ms-row-danger` | Parse-failure row tint (3 uses) |
| `#faf8ff` | `--ms-row-indeterminate` | 判定不能 scorecard row tint (1 use) |
| `#eff4ff` | `--ms-callout-info` | Move-distance callout fill (1 use) |
| `#fef2f2` | `--ms-danger-hover` | Declared hover fill of the delete-project button (1 use, inert) |

### 1.3 Border (8)

| Hex | Proposed var | Where | Weight |
|---|---|---|---|
| `#e3e3e0` | `--ms-border` | Card border, panel divider, header/footer rules, table header rule, sidebar right edge (115 uses) | 1px |
| `#eeeeec` | `--ms-border-subtle` | Row dividers inside lists and tables; also the neutral progress track and tag-pill fill (96 uses) | 1px |
| `#dededa` | `--ms-border-control` | Buttons, inputs, glass panels, mini toggles (30 uses + the `#dedeDA` typo) | 1px |
| `#cdcdc9` | `--ms-border-strong` | Scrollbar thumb; declared hover border of the project switcher (3 uses) | — |
| `#cfe6e2` | `--ms-border-accent-subtle` | Accent avatar ring (3 uses) | 1px |
| `#b8d9d4` | `--ms-border-accent` | Active mini toggle in the changes overlay (1 use) | 1px |
| `#f3d3d0` | `--ms-border-danger` | Failed-model card, delete-project card (2 uses) | 1px |
| `#d5e0f8` | `--ms-border-info` | Move-distance callout (1 use) | 1px |

`#e3e3e0` and `#eeeeec` are close but functionally split: `#e3e3e0` is a structural rule, `#eeeeec` is an in-list row rule. Keep both. `#dededa` vs `#e3e3e0` is the one pair worth questioning — both are 1px greys 8 units apart and both appear on box outlines. Recommendation: keep `#dededa` for interactive controls only (buttons, inputs, glass) and `#e3e3e0` for everything static, which is what the artboard already does in ~95% of cases.

### 1.4 Text (6, plus on-accent white)

| Hex | Proposed var | Role | Where |
|---|---|---|---|
| `#18181b` | `--ms-text` | primary | Titles, nav labels active state, table primary cells, wordmark (178 uses). Also used as a **fill**: deadline progress bar, active filter chip. |
| `#3f3f46` | `--ms-text-body` | body | Table body cells, legend rows, settings labels (149 uses) |
| `#5c5c62` | `--ms-text-muted` | muted | Requirement prose, idle nav foreground (`IDLE_FG`), tag pills, help/collapse rows (24 uses) |
| `#6b6b70` | `--ms-text-meta` | meta | Mono IDs and timestamps, table headers, counts, footer, sublabels (169 uses) |
| `#8f8f92` | `--ms-text-faint` | faint | Eyebrow labels, chevrons `▾` `›`, activity dot (19 uses) |
| `#9a9a9d` | `--ms-text-placeholder` | placeholder | Canvas caption text only (2 uses) |
| `#ffffff` | `--ms-text-on-accent` | inverse | Text on `#0b7c74`, `#dc2626`, `#18181b` fills |

`#5c5c62` and `#6b6b70` are 15 units apart and both read as "secondary". They are used differently (prose vs. mono metadata) but the distinction will not survive review. Recommendation: standardize on `#5c5c62` for prose and `#6b6b70` for mono/numeric metadata, and never mix them in one row. The artboard already violates this in the language toggle (idle 日本語 = `#5c5c62`, idle EN = `#6b6b70`).

### 1.5 Accent — teal (6)

| Hex | Proposed var | Where |
|---|---|---|
| `#0b7c74` | `--ms-accent` | Primary button fill+border, active nav rail (`BAR`), link color, focus-ring outline, checkbox `accent-color`, selected-row inset rail, active sparkline bar, current progress fill, declared hover border (47 uses) |
| `#095f59` | `--ms-accent-hover` | `a:hover`; declared hover fill of the primary header button (2 uses) |
| `#0a5c56` | `--ms-accent-text` | Teal used as **text** on tints: `ACTIVE_FG` for nav, discipline codes, status text 正常/一致, percentages, footer right slot, avatar initial (36 uses) |
| `#e8f3f1` | `--ms-accent-tint` | `ACTIVE_BG`: active nav fill, accent badge fill, avatar fill, active segment fills, selected view-card glow (15 uses) |
| `#dce7e5` | `--ms-accent-flat-2` | Inactive sparkline bars (7 uses) |
| `#a8bfbb` | `--ms-accent-flat` | Historic (non-current) progress-bar fill (5 uses) |

### 1.6 Severity scale — the 5 levels (19 values)

The 5 levels are 重大 / 高 / 中 / 参考 / 判定不能. Each level has up to 4 slots: a solid swatch (dots, bars, legend chips), a badge background, a badge foreground, and a standalone numeric text color. **参考 has no numeric variant in the file.**

| Level (JA) | Meaning | Swatch / bar | Badge bg | Badge fg | Numeric text |
|---|---|---|---|---|---|
| 重大 | critical | `#dc2626` | `#fee2e2` | `#991b1b` | `#b91c1c` |
| 高 | high | `#ea580c` | `#ffedd5` | `#9a3412` | `#c2410c` |
| 中 | medium | `#ca8a04` | `#fef3c7` | `#854d0e` | `#a16207` |
| 参考 | informational | `#0284c7` | `#e0f2fe` | `#075985` | — (none) |
| 判定不能 | indeterminate | `#7c3aed` | `#ede9fe` | `#5b21b6` | `#6d28d9` |

Proposed vars: `--ms-sev-{critical,high,medium,info,indeterminate}`, `--ms-sev-*-bg`, `--ms-sev-*-fg`, `--ms-sev-*-num`. Add `--ms-sev-info-num: #075985` to close the gap.

Row tints tied to severity: `#fef7f6` (danger row), `#faf8ff` (indeterminate row).

Inconsistency to flag: the 要件別の結果 table (runs screen) colors the **result** badge with the requirement's **severity** palette, not the result. `IR-S-007` shows result 不合格 in the 高 palette (`#ffedd5` / `#9a3412`) while `IR-A-014` shows result 不合格 in the 重大 palette (`#fee2e2` / `#991b1b`). Decide one rule: color result badges by result (fail = critical palette) and severity badges by severity.

### 1.7 State / semantic (8)

| Hex | Proposed var | Where |
|---|---|---|
| `#15803d` | `--ms-success` | 合格 counts, `▲ 4.1` delta (6 uses) |
| `#16a34a` | `--ms-change-added` | 追加 change swatch (3 uses) |
| `#b45309` | `--ms-warning` | `1 件パース失敗`, member open-finding counts (4 uses) |
| `#2563eb` | `--ms-change-moved` | 移動 change swatch (3 uses) |
| `#1e40af` | `--ms-info-text` | Move-distance callout text (1 use) |
| `#9333ea` | `--ms-change-geometry` | 形状変更 swatch (2 uses) |
| `#db2777` | `--ms-change-composite` | 複合 swatch (2 uses) |
| `#94a3b8` | `--ms-change-unchanged` | 変更なし swatch (1 use) |

`#94a3b8` is the only cool-slate value in an otherwise warm-grey file. It looks imported from a Tailwind default. Recommendation: replace with `#8f8f92` (`--ms-text-faint`) so the neutral family stays warm.

Note the change-kind palette reuses `#dc2626` (削除) and `#ca8a04` (属性変更) from the severity scale. On the changes screen a red swatch means "deleted", not "critical". Keep them as separate token names even though the values coincide, so the two scales can diverge later.

---

## 2. Typography

### 2.1 Families and where each is used

| Family | Loaded weights | Used weights | Where |
|---|---|---|---|
| IBM Plex Sans | 400, 500, 600 | 400, 500, 600 | `body` first stack entry. All UI text, titles, labels, buttons, table cells. |
| Noto Sans JP | 400, 500, 700 | inherited only | Second entry in the `body` stack: `"IBM Plex Sans","Noto Sans JP",ui-sans-serif,system-ui,sans-serif`. Carries every Japanese glyph, since IBM Plex Sans has no CJK coverage. **700 is loaded but unreachable** (max weight used anywhere is 600). |
| IBM Plex Mono | 400, 500 | 400, 500 | 261 explicit `font-family:'IBM Plex Mono',monospace` declarations: all IDs (`F-118`, `dlv_*`, `rev_*`, `IR-A-014`), all timestamps, all counts and percentages, discipline codes, eyebrow labels, KPI numbers, the footer, the `EN` toggle, the `DARK`/`LIGHT` segments. |
| Archivo | 500, 600 | 600 | Exactly one element: the `ModelShelf` wordmark. **500 is loaded but unused.** |

Font loading is a single Google Fonts `css2` request with `display=swap`, preceded by `preconnect` to `fonts.googleapis.com` and `fonts.gstatic.com` (the latter `crossorigin="anonymous"`).

Base: `body { font-size:13px; line-height:1.5 }`. `line-height` is set explicitly only twice, both `1.1` (wordmark, run hero number). Everything else inherits `1.5`.

### 2.2 Every distinct size / weight / tracking combination

13 distinct font sizes. Weight is 400 unless stated (29 uses of 600, 24 of 500, no other weights).

| Size | Family | Weight | Tracking | Labels | Proposed name |
|---|---|---|---|---|---|
| 30px | mono | 500 | — | Run 適合率 hero number (`86.4%`), `line-height:1.1` | `--ms-text-display` |
| 26px | mono | 500 | — | KPI card values (`86.4%`, `34`, `4`, `12`), pack current version (`v4`) | `--ms-text-kpi` |
| 17px | mono | 400 | — | Secondary run stats (合格 `1,842`, 不合格 `290`, 対象外 `418`, 判定不能 `63`); pack 要件数 / 重大 / 対象 IFC | `--ms-text-stat` |
| 16px | Archivo | 600 | `-0.015em` | Wordmark `ModelShelf`, `line-height:1.1` | `--ms-text-wordmark` |
| 16px | mono | 400 | — | Findings-panel severity tile counts (`6`, `12`, `11`, `5`) | `--ms-text-stat-sm` |
| 15px | sans | 600 | — | Header page title; right-panel `h3`; stub `h2` | `--ms-text-h1` |
| 15px | mono | 400 | — | Changes summary chip numbers (`412`, `96`, `183`, `74`, `521`, `38`, `39,904`) | `--ms-text-num-md` |
| 13px | sans | 600 | — | Every card / section `h2` (指摘事項, ソースモデルの状態, 要件一覧 …) | `--ms-text-h2` |
| 13px | sans | 500 | — | Expanded finding title; selected delivery name | `--ms-text-base-em` |
| 13px | sans | 400 | — | Sidebar nav labels; collapsed finding row titles; delivery names | `--ms-text-base` |
| 12.5px | sans | 600 | — | Severity group header labels (重大 / 高 / 判定不能) | `--ms-text-sm-strong` |
| 12.5px | sans | 500 | — | Selected list-item primary (run, pack, view card), scorecard severity labels, role names | `--ms-text-sm-em` |
| 12.5px | sans | 400 | — | Table primary cells, project switcher label, input values, settings row labels, stub body | `--ms-text-sm` |
| 12.5px | mono | 400 | — | Project ID value (`prj_88c1e4f20a`) | `--ms-text-mono-sm` |
| 12px | sans | 400 | — | Requirement prose, all `<button>` labels, mini-table cells, callout text, destructive card body | `--ms-text-ui` |
| 12px | mono | 400 | — | Numeric table cells, percentages in lists, settings values, property diff values | `--ms-text-mono-ui` |
| 11.5px | sans | 400 | — | Meta labels, filter chips, small buttons, sub-descriptions, KPI captions, isolate banner, view-mode segments, legend footnote (159 uses — the most common size in the file) | `--ms-text-meta` |
| 11.5px | mono | 400 | — | Discipline codes (`ARCH`, `STRUCT`, `MEP`, `OTHER`), revision ids, schema names, saved-view state values, `LIGHT`/`DARK` in settings, IFC type cells | `--ms-text-mono-meta` |
| 11px | sans | 400 | — | Badge text (all severity and status badges), table header cells, avatar initials, `badgeLocked` | `--ms-text-xs` |
| 11px | mono | 400 | — | All IDs and timestamps, group counts, footer, nav trailing count, nav count badge, header breadcrumb, `DARK`/`LIGHT` header segments, `EN` toggle (143 sans + mono uses combined) | `--ms-text-mono-xs` |
| 11px | mono | 400 | `0.1em` | Viewer canvas caption `combined ifc model — canvas`, `text-transform:uppercase` | `--ms-text-canvas-caption` |
| 10.5px | sans | 400 | — | Tag pills (プロパティ, 防火・避難), mini-table header cells | `--ms-text-2xs` |
| 10.5px | mono | 400 | — | `12 OBJ` pill, view-card thumb badges, delivery-panel discipline codes | `--ms-text-mono-2xs` |
| 10.5px | mono | 400 | `0.08em` | Changes diff-overlay caption `base / head overlay`, uppercase | `--ms-text-overlay-caption` |
| 10px | mono | 400 | `0.12em` | Panel eyebrow labels (ハイライト, 収録モデルリビジョン, 実行履歴, 保存された状態, 紐付く指摘, プロパティの差分), uppercase (6 uses) | `--ms-text-eyebrow` |
| 10px | mono | 400 | `0.14em` | Sidebar section labels (レビュー / モデル / 設定) and the stub eyebrow 未設計, uppercase (4 uses) | `--ms-text-eyebrow-wide` |
| 9.5px | mono | 400 | `0.13em` | Wordmark subtitle `BIM Delivery Checker`, uppercase (1 use) | `--ms-text-wordmark-sub` |

Three near-identical eyebrow treatments exist: `10px/0.14em` (sidebar sections), `10px/0.12em` (panel eyebrows), `9.5px/0.13em` (wordmark subtitle). Recommendation: collapse to one `10px mono uppercase 0.12em` token and keep `9.5px/0.13em` only for the wordmark lockup.

Half-pixel sizes (`9.5`, `10.5`, `11.5`, `12.5`) account for 383 of the 624 size declarations. They are deliberate, not typos, and Tailwind has no default utility for any of them. Plan on a custom `--text-*` set in `@theme` rather than the stock scale.

---

## 3. Spacing, radii, borders, shadows

### 3.1 Spacing (padding and gap)

Observed values, ranked by frequency.

| Value | Gap uses | Padding uses (as a component of any padding shorthand) |
|---|---|---|
| 1px | 7 | — |
| 3px | 2 | 1 |
| 4px | 2 | 1 |
| 5px | 3 | 2 |
| 6px | 18 | 12 |
| 7px | 21 | 34 |
| 8px | 46 | 15 |
| 9px | 10 | 20 |
| 10px | 91 | 33 |
| 11px | 4 | 41 |
| 12px | 19 | 33 |
| 13px | — | 4 |
| 14px | 4 | 3 |
| 15px | — | 3 |
| 16px | 1 | 61 |
| 18px | 2 | 27 |
| 22px | 2 | — |
| 26px | — | 1 |

Proposed scale (odd values retained, because ~half the layout depends on them):

```
--ms-space-1: 1px    --ms-space-6: 8px    --ms-space-11: 14px
--ms-space-2: 3px    --ms-space-7: 9px    --ms-space-12: 15px
--ms-space-3: 4px    --ms-space-8: 10px   --ms-space-13: 16px
--ms-space-4: 5px    --ms-space-9: 11px   --ms-space-14: 18px
--ms-space-5: 6px    --ms-space-10: 12px  --ms-space-15: 22px
--ms-space-7b: 7px   --ms-space-10b: 13px --ms-space-16: 26px
```

Repeated padding pairs worth turning into component tokens:

| Shorthand | Uses | Meaning |
|---|---|---|
| `11px 16px` | 26 | List-row padding (right panels, findings rows, members, packs) |
| `10px 16px` | 22 | Table-row padding (16px gutter tables) |
| `12px 16px` | 18 | Card header padding, dense table row |
| `0 7px` | 20 | Status badge inline padding (with `height:20px`) |
| `0 6px` | 20 | Severity badge inline padding (with `height:19px`) |
| `0 10px` | 16 | Small control inline padding |
| `7px 10px` | 12 | Sidebar nav item padding |
| `12px 18px` | 7 | Table-row padding (18px gutter tables) |
| `18px` | 7 | Scrolling page-body padding |
| `7px 16px` / `7px 18px` | 5 / 2 | Table header row padding |

Two gutter systems coexist: **16px** (findings panel, dash cards, runs, packs, members, models, views panel) and **18px** (page bodies, deliveries table, changes table, header). Recommendation: standardize page bodies and table rows on 18px and card interiors on 16px, which is close to the artboard's actual split, and drop the mixed cases (`padding:11px 18px` vs `padding:12px 16px` header rows).

### 3.2 Radii

| Value | Uses | Applied to | Proposed name |
|---|---|---|---|
| `1px` | 8 | Sparkline bars | `--ms-radius-hair` |
| `2px` | 36 | Severity/change swatches (8×8, 9×9), progress tracks (4px tall), focus-ring `border-radius` | `--ms-radius-xs` |
| `3px` | 58 | All badges, count badge, tag pills, progress tracks (5–6px tall), segmented-control items in the header, view-card thumb badge | `--ms-radius-sm` |
| `4px` | 14 | Scrollbar thumb, tool-palette items, in-card action buttons (28px tall), diff mini toggles | `--ms-radius` |
| `5px` | 66 | Every standard button, input, nav item, list card, filter chip, mini-table, callout, project switcher | `--ms-radius-md` |
| `6px` | 12 | Viewer glass panels, changes diff overlay, changes summary chips | `--ms-radius-lg` |
| `7px` | 27 | Every top-level card / panel | `--ms-radius-xl` |
| `8px` | 1 | Stub empty-state card | — (fold into 7px) |
| `50%` | 17 | Avatars, status dots, activity dots, source-model dots | `--ms-radius-full` |
| `0 2px 2px 0` | 10 | Sidebar active rail cap | — |

`8px` (one use) is a stray; standardize on `7px`. Tailwind's default `rounded-md`/`lg`/`xl` are 6/8/12px, so `5px` and `7px` both need `@theme` entries.

### 3.3 Borders

Only two widths exist. No border is thicker than 2px, anywhere.

| Spec | Uses | Meaning |
|---|---|---|
| `1px solid #eeeeec` (bottom) | 75 | In-list row divider |
| `1px solid #e3e3e0` (all) | 62 | Card / panel outline |
| `1px solid #e3e3e0` (bottom) | 42 | Structural rule (header, card header, table header) |
| `1px solid #dededa` (all) | 28 | Control outline (button, input, glass panel) |
| `border:0` | 15 | Reset on `<button>` for nav items and text-link buttons |
| `1px solid #0b7c74` (all) | 10 | Primary button, selected view card, active compare pill |
| `1px solid #eeeeec` (top) | 7 | Mini-table row divider |
| `1px solid #e3e3e0` (right) | 6 | Sidebar and left-pane edges |
| `1px solid #e3e3e0` (top) | 5 | Footer rule, sidebar footer rule, severity group header |
| `2px solid #0b7c74` (left) | 1 | Expanded finding card selection rail |
| `1px solid transparent` | 1 | Inactive theme segment in settings (placeholder to preserve height) |

Also: an inline `2px`-wide `<span>` positioned at `left:-12px` acts as the sidebar active-nav rail (10 instances, one per nav item), with `border-radius:0 2px 2px 0` and `top:6px; bottom:6px`.

### 3.4 Shadows

The design has **no elevation shadows at all**. Two `box-shadow` declarations exist and both are flat selection indicators.

| Spec | Uses | Meaning |
|---|---|---|
| `inset 2px 0 0 #0b7c74` | 4 | Selected-row left rail (deliveries, runs, packs, changes) |
| `0 0 0 2px #e8f3f1` | 1 | Selected view-card outer glow, paired with `border:1px solid #0b7c74` |

Propose `--ms-ring-selected: inset 2px 0 0 var(--ms-accent)` and `--ms-ring-card-selected: 0 0 0 2px var(--ms-accent-tint)`.

**Flag:** the expanded finding on the findings screen uses `border-left:2px solid #0b7c74` for the same affordance the other four screens express as `box-shadow:inset 2px 0 0 #0b7c74`. Two mechanisms, one meaning, and the border version shifts content 2px. Standardize on the inset shadow.

### 3.5 Global chrome

```css
* { scrollbar-width:thin; scrollbar-color:#cdcdc9 transparent; }
*::-webkit-scrollbar { width:8px; height:8px; }
*::-webkit-scrollbar-thumb { background:#cdcdc9; border-radius:4px; }
*::-webkit-scrollbar-track { background:transparent; }
:focus-visible { outline:2px solid #0b7c74; outline-offset:1px; border-radius:2px; }
a { color:#0b7c74; text-decoration:none; }
a:hover { color:#095f59; }
html, body { margin:0; height:100%; }
```

`text-wrap:pretty` is applied to 11 prose elements (requirement text, activity messages, role descriptions, callouts, stub body).

---

## 4. Layout

### 4.1 Outer shell

```
div  display:flex; height:100vh; min-height:700px; overflow:hidden; background:#f2f2f0
├── nav    width:238px; flex-shrink:0; flex-column; background:#ffffff;
│          border-right:1px solid #e3e3e0; overflow-y:auto
└── div    flex:1; min-width:0; flex-column
    ├── header  height:54px; flex-shrink:0; padding:0 18px; gap:14px;
    │           border-bottom:1px solid #e3e3e0; background:#ffffff
    ├── <sc-if>  x11   flex:1; min-height:0   ← exactly one renders
    └── footer  height:30px; flex-shrink:0; padding:0 16px; gap:16px;
                border-top:1px solid #e3e3e0; background:#ffffff
```

Usable body height = `100vh − 84px`, floored at `700px − 84px = 616px`.

**There is no collapsed sidebar.** Width `238px` is the only value in the file. A `サイドバーを閉じる` / `Collapse sidebar` button exists in the sidebar footer with a `‹` chevron icon and **no `onClick`**, so the collapsed state was never designed. Build the expanded state; treat collapse as unspecified.

Sidebar vertical structure, top to bottom:

| Block | Metrics |
|---|---|
| Logo lockup | `padding:15px 18px 14px`, `gap:9px`; `<img src="logo-mark.png">` at `27×27`, `object-fit:contain`, `flex-shrink:0` |
| Project switcher | wrapper `padding:0 12px 12px`; button full-width (see §5) |
| Section label ×3 | first `padding:4px 12px 0`, second and third `padding:16px 12px 0` |
| Nav group ×3 | `padding:6px 12px 0`, `flex-column`, `gap:1px` (4 items, then 3, then 3) |
| Footer block | `margin-top:auto`, `padding:12px`, `gap:1px`, `border-top:1px solid #e3e3e0`; contains the language pair (`gap:4px`, `padding-bottom:8px`) then Collapse and Help rows |

### 4.2 Findings screen body

```
div   flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,1fr) 384px
├── div (viewer)  position:relative; border-right:1px solid #e3e3e0;
│                 background:#ececeb; overflow:hidden
│                 └─ 6 position:absolute children (hatch, caption, 4 overlay panels)
└── aside (findings)  display:flex; flex-direction:column; min-height:0; background:#ffffff
    ├── header row   padding:14px 16px 12px; gap:8px
    ├── stat row     display:flex; gap:6px; padding:0 16px 12px
    └── list         flex:1; min-height:0; overflow-y:auto;
                     border-top:1px solid #e3e3e0
```

The right panel is **384px fixed**. Its header and stat row do not scroll; only the list does. The viewer pane never scrolls (`overflow:hidden`).

Viewer overlay anchors (all `position:absolute` on the viewer pane, 14px inset):

| Overlay | Anchor |
|---|---|
| Hatch layer | `inset:0` |
| Canvas caption | `inset:0`, flex-centered |
| Tool palette | `left:14px; top:14px` |
| Isolate banner | `left:60px; right:14px; top:14px; width:fit-content; max-width:calc(100% - 74px); box-sizing:border-box` |
| Severity legend | `left:14px; bottom:14px` |
| View-mode switch | `right:14px; bottom:14px` |

### 4.3 Fixed / sticky behavior

**None.** The file contains zero `position:sticky` and zero `position:fixed`. Every "sticky-looking" element (table header rows, severity group headers, panel headers) is a non-scrolling sibling of a scroll container, not a sticky child. If you make them sticky in the rebuild, that is an intentional deviation.

`position:absolute` appears 27 times (10 nav rails, 6 viewer overlays, view-card thumb badges, changes diff overlay controls), `position:relative` 16 times.

### 4.4 Scroll and overflow containers

| Container | Declaration | Screens |
|---|---|---|
| Sidebar | `overflow-y:auto` | all |
| Page body (single-column screens) | `flex:1; min-height:0; overflow-y:auto; padding:18px` | dash, models, members, settings |
| Findings list | `flex:1; min-height:0; overflow-y:auto` | findings |
| Left rail list | `flex:1; min-height:0; overflow-y:auto` | deliveries, runs, changes |
| Right detail panel | `overflow-y:auto` | deliveries, changes, views |
| Card wrapping a wide table | `overflow-x:auto; overflow-y:hidden` (10 uses) | dash, runs, models, packs, changes, deliveries, members |
| Viewer pane, view-card thumbs, diff overlay | `overflow:hidden` | — |

Every wide table declares a `min-width` on its rows so the wrapping card scrolls horizontally: `530px`, `560px`, `620px`, `640px` (16 uses), `660px`, `830px`. `min-width:0` appears 25 times on flex children to enable text ellipsis.

### 4.5 Panel widths across all 11 screens

| Screen | Body layout |
|---|---|
| findings | `grid: minmax(0,1fr) 384px` |
| deliveries | `grid: minmax(0,1fr) 360px` |
| views | `grid: minmax(0,1fr) 360px` |
| changes | filter bar + summary bar, then `grid: minmax(0,1fr) 400px` |
| runs | `grid: 320px minmax(0,1fr)` (rail on the **left**) |
| packs | `grid: 300px minmax(0,1fr)` (rail on the **left**) |
| dash | single scrolling column; `grid: repeat(4, minmax(0,1fr))` KPI row, then `grid: minmax(0,1.5fr) minmax(0,1fr)` |
| models | single column; table, then `grid: minmax(0,1fr) minmax(0,1fr)` |
| members | single column; table, then `grid: repeat(auto-fit, minmax(280px,1fr))` |
| settings | `grid: repeat(auto-fit, minmax(320px,1fr))`, `align-items:start` |
| views (cards) | `grid: repeat(auto-fill, minmax(228px,1fr))`, `gap:12px` |
| stub | flex-centered card, `max-width:340px` |

Four detail-panel widths (`360`, `384`, `400`) and two rail widths (`300`, `320`) for the same structural role. Recommendation: one detail-panel width of `384px` and one rail width of `320px`.

---

## 5. Component inventory

17 inline SVG icons total. All are `15×15` with `viewBox="0 0 15 15"`, `fill="none"`, `stroke="currentColor"` (or an explicit hex on the viewer palette), `stroke-width="1.4"`. The single exception is the delivery search icon: `12×12`, still `viewBox="0 0 15 15"`, `stroke-width="1.5"` — which renders at an effective 1.2px stroke. Standardize on `15×15 / 1.4`.

### 5.1 Shell

| # | Component | Metrics | States present | shadcn verdict |
|---|---|---|---|---|
| 1 | Sidebar rail | `width:238px`, `bg #ffffff`, `border-right 1px #e3e3e0`, `overflow-y:auto` | expanded only | **custom** — shadcn has no nav-rail primitive in the listed set |
| 2 | Wordmark lockup | `gap:9px`; mark `27×27`; name Archivo 16/600/`-0.015em`/lh1.1 `#18181b`; sub mono 9.5px/`0.13em`/uppercase `#8f8f92` | static | **custom** |
| 3 | Project switcher | `width:100%`, `padding:8px 10px`, `radius:5px`, `border 1px #e3e3e0`, `bg #fafafa`, sans 12.5px `#18181b`, label ellipsised, trailing `▾` `#6b6b70`, `text-align:left`, `cursor:pointer` | default; declared hover `border-color:#cdcdc9` (inert) | **Select** trigger (or DropdownMenu). Needs a full restyle: shadcn `SelectTrigger` is `h-9`, `rounded-md`(6px), `border-input`, `text-sm`(14px). |
| 4 | Sidebar section label | mono 10px `0.14em` uppercase `#8f8f92`; `padding:4px 12px 0` / `16px 12px 0` | static | **custom** — not a `Separator`; it has no rule |
| 5 | Nav item | `padding:7px 10px`, `radius:5px`, `gap:10px`, `border:0`, sans 13px, icon `15×15`; active rail = `<span position:absolute; left:-12px; top:6px; bottom:6px; width:2px; radius:0 2px 2px 0>` | **active** `bg #e8f3f1` / `fg #0a5c56` / rail `#0b7c74`; **idle** `bg transparent` / `fg #5c5c62` / rail `transparent`. No hover declared. | **custom** — `Button variant="ghost"` gets close, but the negative-offset 2px rail has no shadcn analogue and must be a pseudo-element or absolute span |
| 6 | Nav trailing slots | three variants: (a) mono 11px `#8f8f92` count `12`; (b) `7×7` circle `#0b7c74`; (c) count badge `height:17px`, `padding:0 6px`, `radius:3px`, `bg #dc2626`, `#fff`, mono 11px, value `34` | one per item, all static | **Badge** for (c); note `height:17px` and `radius:3px` vs shadcn's `rounded-full px-2.5 py-0.5` |
| 7 | Language toggle | two buttons `flex:1`, `height:27px`, `radius:5px`; JA sans 11.5px, EN mono 11px | **active** `border #dededa` / `bg #f2f2f0` / `fg #0a5c56`; **idle** `border transparent` / `bg transparent` / `fg #5c5c62` (JA) or `#6b6b70` (EN) | **ToggleGroup** `type="single"`. Flag the asymmetric idle foreground; pick one. |
| 8 | Ghost sidebar row (Collapse, Help) | `padding:7px 10px`, `radius:5px`, `bg transparent`, `#5c5c62`, sans 13px, icon `15×15`; Help has trailing `›` `#8f8f92` | default; declared hover `background:#f2f2f0; color:#18181b` (inert) | **Button** `variant="ghost"` |
| 9 | Header breadcrumb + title | mono 11px `#6b6b70` crumb, `gap:9px`, sans 15/600 `#18181b` title | driven by `page` | **Breadcrumb**, though the artboard renders a single crumb with no separator |
| 10 | Locked badge | `height:19px`, `padding:0 7px`, `radius:3px`, `border 1px #e3e3e0`, `bg #fafafa`, sans 11px `#5c5c62` | static | **Badge** `variant="outline"` |
| 11 | Theme segmented control | track: `gap:1px`, `padding:3px`, `radius:5px`, `bg #f2f2f0`, `border 1px #e3e3e0`; segment: `height:22px`, `padding:0 8px`, `radius:3px`, mono 11px | **DARK** idle `fg #6b6b70`, no bg/border; **LIGHT** active `bg #ffffff` + `border 1px #dedeDA` + `fg #0a5c56` | **ToggleGroup**, but the active item carries a *border* inside a 22px track, so the item's box grows while the track does not. shadcn `ToggleGroupItem` has no border by default; this needs an explicit `data-[state=on]:border` rule. Rendered as `<span>`, **not wired**. |
| 12 | Header secondary button | `height:32px`, `padding:0 11px`, `radius:5px`, `border 1px #dededa`, `bg #ffffff`, `#18181b`, sans 12px, `flex-shrink:1`, `min-width:0`, ellipsised | default; declared hover `border-color:#0b7c74` (inert) | **Button** `variant="outline"` with `h-8 px-[11px] text-[12px] rounded-[5px]` |
| 13 | Header primary button | `height:32px`, `padding:0 12px`, `radius:5px`, `border+bg #0b7c74`, `#ffffff`, sans 12px/500, `flex-shrink:0` | default; declared hover `background:#095f59` (inert) | **Button** `variant="default"` with a teal override |
| 14 | Avatar | `28×28` circle, `bg #e8f3f1`, `border 1px #cfe6e2`, sans 11px `#0a5c56`, single JA glyph `森`. Variants: `26×26` (members), `20×20` (view cards); neutral flavor `bg #f2f2f0` / `border 1px #e3e3e0` / `fg #3f3f46` | accent, neutral | **Avatar** + `AvatarFallback`. shadcn ships no border on the fallback; add one. |
| 15 | Footer status bar | `height:30px`, `gap:16px`, `padding:0 16px`, mono 11px `#6b6b70`, right slot `margin-left:auto` `#0a5c56` | static | **custom** |

### 5.2 Viewer pane

| # | Component | Metrics | States | shadcn verdict |
|---|---|---|---|---|
| 16 | Canvas placeholder | `bg #ececeb`; hatch `repeating-linear-gradient(135deg, rgba(0,0,0,0.04) 0 1px, transparent 1px 10px)`; caption mono 11px `0.1em` uppercase `#9a9a9d` | static mock | **custom** — replace with the real viewer |
| 17 | Tool palette | column, `gap:1px`, `padding:5px`, `radius:6px`, `border 1px #dededa`, `bg rgba(255,255,255,0.92)`; items `30×30`, `radius:4px` | item 1 **active**: `bg #e8f3f1`, icon stroke `#0b7c74`; items 2–4 **idle**: no bg, stroke `#5c5c62` | **ToggleGroup** vertical inside a translucent shell. The `rgba` glass panel is **custom**; shadcn has no glass surface. Rendered as `<span>`, **not wired**. |
| 18 | Isolate banner | `padding:7px 11px`, `radius:6px`, `border 1px #dededa`, `bg rgba(255,255,255,0.92)`, `gap:6px`, sans 11.5px `#5c5c62`; label `#18181b` `flex-shrink:0`; value ellipsised; action `解除` `#0b7c74` `flex-shrink:0` | one state | **custom** — `Alert` is far heavier (icon slot, `p-4`, title/description). This is a single-line glass chip with an inline text action. |
| 19 | Severity legend | column, `gap:6px`, `padding:10px 12px`, `radius:6px`, `border 1px #dededa`, `bg rgba(255,255,255,0.94)`; eyebrow mono 10px `0.12em` uppercase `#8f8f92`; 5 rows `gap:8px` sans 12px `#3f3f46` with a `9×9` `radius:2px` swatch | static; all 5 levels shown | **custom** |
| 20 | View-mode switch | `gap:1px`, `padding:4px`, `radius:6px`, `border 1px #dededa`, `bg rgba(255,255,255,0.92)`; items `height:26px`, `padding:0 10px`, `radius:4px`, sans 11.5px | **active** `3D`: `bg #e8f3f1` `fg #0a5c56`; **idle** `平面`/`断面`: `fg #6b6b70` | **ToggleGroup**. Rendered as `<span>`, **not wired**. Note this is a *third* segmented-control geometry (26px item / 4px track pad / 6px track radius) after the header's (22/3/5) and settings' (30px items, no track). |

### 5.3 Findings panel

| # | Component | Metrics | States | shadcn verdict |
|---|---|---|---|---|
| 21 | Panel header | `padding:14px 16px 12px`, `gap:8px`; `h2` sans 13/600 `#18181b` `margin:0`; count mono 11px `#6b6b70`; sort control `margin-left:auto` sans 11.5px `#6b6b70` reading `重要度順 ▾` | static | Sort control maps to **Select**, but the artboard gives it **no trigger chrome at all** — no height, border, padding, or background. shadcn's `SelectTrigger` would add all four. Either accept a bare-text trigger (custom) or accept the visual change. |
| 22 | Severity stat tile | 4 tiles, `display:flex; gap:6px`; each `flex:1`, `padding:8px 9px`, `radius:5px`, `border 1px #e3e3e0`, `bg #fafafa`; number `display:block` mono 16px in the severity numeric color; label sans 11px `#6b6b70` | static | **Card**, but shadcn `Card` is `rounded-xl border py-6 gap-6` with `CardHeader/Content` padding. At `8px 9px` this is a tile, not a card. Simpler as a `div`. **Only 4 of the 5 levels appear (参考 is omitted).** |
| 23 | Severity group header | `padding:9px 16px`, `gap:8px`, `bg #fafafa`; `8×8` `radius:2px` swatch; label sans 12.5/600 `#18181b`; count; trailing `▾` `#8f8f92` `margin-left:auto`. First header: `border-bottom 1px #e3e3e0` only. Later headers: `border-top` **and** `border-bottom 1px #e3e3e0`. | **expanded** (重大): no `▾`. **collapsed** (高, 判定不能): `▾` present but children still render for 高. | **Collapsible** trigger. Two inconsistencies: the first header has no chevron, and the 判定不能 count uses sans 11.5px while 重大/高 use mono 11px. Standardize on a chevron on every header and mono 11px counts. |
| 24 | Expanded finding card | `padding:10px 16px`, `border-bottom 1px #eeeeec`, `bg #f4faf9`, `border-left 2px solid #0b7c74`. Sub-parts: id/title row `align-items:baseline; gap:8px` (mono 11px `#0a5c56` + sans 13/500 `#18181b`); prose `<p margin:5px 0 0>` sans 12px `#5c5c62` `text-wrap:pretty`; tag row `margin-top:8px; gap:6px; flex-wrap:wrap`; object mini-table `margin-top:9px`; action row `margin-top:9px; gap:6px` | selected / expanded only (no unselected-expanded variant exists) | **Card** + **Table** + **Badge** + **Button**. Flag: the selection rail is a `border-left`, unlike the four `inset` shadows elsewhere. |
| 25 | Tag pill | `padding:2px 6px`, `radius:3px`, `bg #eeeeec`, sans 10.5px `#5c5c62`. Third pill is mono 10.5px (`12 OBJ`). | static | **Badge** `variant="secondary"`. Note the fill reuses the row-divider grey `#eeeeec` — consider a dedicated `--ms-pill-bg`. |
| 26 | Object mini-table | wrapper `radius:5px`, `border 1px #e3e3e0`, `bg #ffffff`, `overflow:hidden`. Head: `grid-template-columns:1fr 66px 54px`, `gap:8px`, `padding:6px 9px`, `bg #fafafa`, sans 10.5px `#6b6b70`. Rows: same grid, `padding:6px 9px`, `border-top 1px #eeeeec`, sans 12px `#3f3f46`; floor col `#6b6b70`; value col `#b91c1c`. Overflow row: `padding:6px 9px`, sans 12px `#6b6b70`, `他 9 件`. | 3 data rows + 1 overflow row | **Table** will not map — see §5.6. |
| 27 | In-card action buttons | primary `height:28px`, `padding:0 10px`, `radius:4px`, `border+bg #0b7c74`, `#ffffff`, sans 12px. Secondary ×2 same box with `border 1px #dededa`, `bg #ffffff`, `#18181b`. | default only | **Button** `size="sm"`. Note `radius:4px` here versus `radius:5px` on every other button in the app. |
| 28 | Collapsed finding row | `padding:11px 16px`, `gap:10px`, `border-bottom 1px #eeeeec`; mono 11px id `#6b6b70`; sans 13px title `#18181b` ellipsised; trailing count mono 11px `#6b6b70` `margin-left:auto` | default only. **No hover or selected style is declared for these rows.** | **custom** row. You must invent the hover state; the artboard does not specify it. |
| 29 | Severity badge | `display:inline-flex`, `height:19px`, `padding:0 6px`, `radius:3px`, sans 11px; 5 bg/fg pairs from §1.6 | 重大 / 高 / 中 / 参考 / 判定不能 (and the abbreviated `不能`) | **Badge**, fully overridden. shadcn's is `rounded-md border px-2 py-0.5 text-xs font-medium` with a border and `font-medium`; these have no border and weight 400. |
| 30 | Status badge | `display:inline-flex`, `height:20px`, `padding:0 7px`, `radius:3px`, sans 11px. Variants: `#e8f3f1`/`#0a5c56` (正常, レビュー中, 合格, 情報管理者); `#f2f2f0`/`#3f3f46` (承認済, 完了, 対象外, 編集者, 閲覧者); `#fee2e2`/`#991b1b` (失敗, 不合格); `#ede9fe`/`#5b21b6` (判定不能) | 4 flavors | **Badge**. Flag: `height:20px`/`padding:0 7px` here versus `height:19px`/`padding:0 6px` for severity badges — a 1px/1px difference with no semantic reason. Standardize on `20px` / `0 7px`. |

### 5.4 Cross-screen components (present on the other 10 screens)

| # | Component | Metrics | States | shadcn verdict |
|---|---|---|---|---|
| 31 | Top-level card | `radius:7px`, `bg #ffffff`, `border 1px #e3e3e0`; header `padding:12px 16px`, `border-bottom 1px #e3e3e0`, `gap:10px`, `h2` sans 13/600 | default; error flavor `border 1px #f3d3d0` | **Card**. Override `rounded-xl`→7px, drop the shadow, drop `py-6`. |
| 32 | KPI card | `padding:13px 15px`, `radius:7px`, `bg #ffffff`, `border 1px #e3e3e0`; caption sans 11.5px `#6b6b70`; value row `align-items:baseline; gap:7px; margin-top:3px` with mono 26px/500 `#18181b`; delta sans 11.5px in `#15803d` / `#6b6b70` / `#b45309` | 4 instances, one per metric | **Card** |
| 33 | Data table (7 instances) | CSS **grid**, not `<table>`. Header row `padding:7px 16px` (or `7px 18px`), `bg #fafafa`, `border-bottom 1px #e3e3e0`, sans 11px `#6b6b70`. Body row `padding:10–12px 16/18px`, `border-bottom 1px #eeeeec`, `align-items:center`; last row omits the bottom border. Column tracks per table: `66px minmax(150px,1fr) 72px 58px 92px` (dash) / `minmax(190px,1fr) 62px 96px 66px 80px` (deliveries) / `92px minmax(150px,1fr) 80px 66px 66px 66px` (runs) / `96px minmax(170px,1fr) 118px 92px 80px` (changes) / `minmax(200px,1fr) 84px 96px 84px 96px 90px 92px` (models) / `92px minmax(180px,1fr) 78px 116px 96px` (packs) / `minmax(190px,1fr) 128px 108px 132px 96px` (members). Row `min-width` 530/560/620/640/660/830px. | default; **selected** `bg #f4faf9` + `box-shadow:inset 2px 0 0 #0b7c74`; **error** `bg #fef7f6`; **indeterminate** `bg #faf8ff`. No hover declared on any row. | **Will not map.** See §5.6. |
| 34 | Filter chip row | active `height:26px` or `28px`, `padding:0 10/11px`, `radius:5px`, `bg #18181b`, `#ffffff`, sans 11.5px; idle `border 1px #e3e3e0`, `#3f3f46`, `bg transparent` (deliveries) or `#ffffff` (views) | active / idle | **ToggleGroup** or **Tabs**. Note the active chip is a solid near-black fill, the only such fill besides the deadline bar; shadcn `Tabs` uses a muted track with a white active pill, a different visual language. |
| 35 | Search affordance | `display:inline-flex`, `gap:6px`, `height:28px`, `padding:0 10px`, `radius:5px`, `border 1px #e3e3e0`, sans 11.5px `#6b6b70`, `12×12` magnifier icon | one state | Rendered as a `<span>` containing the placeholder text `納品を検索`. **Not an input.** Maps to **Input** with a leading icon, but you are inventing the real thing. |
| 36 | Progress bar | track `height:4px` (deliveries) / `5px` (dash) / `6px` (runs scorecard), `radius:2px` or `3px`, `bg #eeeeec`, `overflow:hidden`; fill `display:block`, same height, `width:<pct>`, `bg #0b7c74` (current) / `#a8bfbb` (historic) / severity color / `#18181b` (deadline) | 4 color variants, 3 heights | **Progress**. Three heights and two radii for one component. Standardize on `height:6px; radius:3px`. |
| 37 | Sparkline | container `height:28px`, `display:flex; align-items:flex-end; gap:3px`; 8 bars `flex:1`, `radius:1px`, heights `52% 58% 55% 68% 64% 75% 82% 86%`, `bg #dce7e5`, last bar `#0b7c74` | static | **custom** — no chart primitive in the listed shadcn set |
| 38 | Stacked severity bar | `display:flex; gap:3px`; 4 spans `flex:6/12/11/5`, `height:5px`, `radius:3px`, severity swatch colors | static | **custom** |
| 39 | Changes summary chip | `padding:8px 12px`, `radius:6px`, `bg #ffffff` (or `#fafafa` for 変更なし), `border 1px #e3e3e0`, `gap:8px`; `9×9` `radius:2px` swatch; label sans 11.5px `#6b6b70`; value mono 15px `#18181b` (or `#3f3f46`) | 7 kinds | **custom** (or a small `Card`) |
| 40 | Compare selector pair | left `height:29px`, `padding:0 10px`, `radius:5px`, `border 1px #dededa`, `bg #fafafa`, sans 12px `#18181b`, `▾` `#8f8f92`; right (active) `border 1px #0b7c74`, `bg #e8f3f1`, `#0a5c56`, `▾` `#0b7c74`; arrow `→` `#8f8f92` between them; third selector `border 1px #dededa`, `bg #ffffff`, `#3f3f46` | base / head / discipline | **Select** ×3. Rendered as `<span>`, **not wired**. |
| 41 | View card | `radius:7px`, `bg #ffffff`, `overflow:hidden`; thumb `height:132px`, `bg #ececeb` + hatch, `border-bottom 1px #e3e3e0`, badge at `left:8px; top:8px` (`height:20px`, `padding:0 7px`, `radius:3px`, `bg rgba(255,255,255,0.92)`, `border 1px #dededa`, mono 10.5px); body `padding:11px 13px` | **selected** `border 1px #0b7c74` + `box-shadow:0 0 0 2px #e8f3f1`, title sans 12.5/500, badge text `#0a5c56`; **idle** `border 1px #e3e3e0`, title sans 12.5/400, badge text `#3f3f46` | **Card** |
| 42 | Diff overlay | `height:180px`, `radius:6px`, `border 1px #e3e3e0`, `bg #ececeb` + hatch, caption mono 10.5px `0.08em` uppercase `#9a9a9d`; two mini toggles at `left:9px; bottom:9px`, `height:23px`, `padding:0 8px`, `radius:4px`, sans 11px; active `bg #e8f3f1`, `border 1px #b8d9d4`, `#0a5c56`; idle `bg #ffffff`, `border 1px #dededa`, `#18181b` | 旧を表示 / 新を表示 | **custom** + **ToggleGroup** |
| 43 | Info callout | `padding:9px 11px`, `radius:5px`, `bg #eff4ff`, `border 1px #d5e0f8`, sans 12px `#1e40af` | one state | **Alert**, restyled. shadcn's `Alert` has `p-4`, an icon grid, and title/description slots; this is one line of text. |
| 44 | Property-diff table | wrapper `radius:5px`, `border 1px #e3e3e0`, `bg #ffffff`, `overflow:hidden`; head `grid: minmax(0,1fr) 78px 78px`, `gap:8px`, `padding:6px 10px`, `bg #fafafa`, sans 10.5px `#6b6b70`; rows same grid, `padding:8px 10px`, `border-top 1px #eeeeec`, sans 12px; name `#3f3f46`, old mono `#6b6b70`, new mono `#18181b` or `#b91c1c` | changed / unchanged (new value color) | Same grid-vs-`<table>` problem as #33 |
| 45 | Activity row | `display:flex; gap:11px; padding:9px 16px`; `7×7` circle `margin-top:6px` `flex-shrink:0` in `#0b7c74` / `#c2410c` / `#8f8f92`; message sans 12.5px `#18181b` `text-wrap:pretty`; meta mono 11px `#6b6b70` | 3 dot colors | **custom** |
| 46 | Source-model row | `padding:10px 16px`, `gap:10px`, `border-bottom 1px #eeeeec`; `6×24` `radius:3px` status rail (`#0b7c74` ok / `#dc2626` failed); name sans 12.5px; meta mono 11px; trailing status sans 11.5px `#0a5c56` or `#b91c1c` + a `再試行` chip (`height:24px`, `padding:0 9px`, `radius:5px`, `border 1px #dededa`, sans 11.5px) | ok / failed (`bg #fef7f6`) | **custom** row + **Button** `size="sm"` |
| 47 | Scorecard row | `padding:11px 16px`, `gap:12px`; `8×8` `radius:2px` swatch; label `width:64px` sans 12.5/500; count mono 12px `width:110px` `#3f3f46`; bar `flex:1` `height:6px` `radius:3px` `bg #eeeeec` with a severity-colored fill | 5 rows; 判定不能 row replaces the bar with prose `#5b21b6` and gets `bg #faf8ff` | **custom** + **Progress** |
| 48 | Text input | `width:100%`, `margin-top:5px`, `height:32px`, `padding:0 10px`, `box-sizing:border-box`, `radius:5px`, `border 1px #dededa`, `bg #ffffff`, `#18181b`, `font-family:inherit`, sans 12.5px. Label `display:block` sans 11.5px `#6b6b70`. | default only. No focus, hover, disabled, or error state declared beyond the global `:focus-visible`. | **Input** + **Label**. shadcn `Input` is `h-9`(36px) `rounded-md`(6px) `text-sm`(14px) `px-3`; every value differs. |
| 49 | Checkbox | native `<input type="checkbox">`, `accent-color:#0b7c74`, `15×15`, `checked` hardcoded; label `display:flex; align-items:center; gap:9px`, sans 12.5px `#3f3f46` | checked only (3 instances) | **Checkbox** — but note shadcn's is a Radix button with an SVG tick, sized `size-4`(16px) with a border and `rounded-[4px]`. The artboard's is the OS control tinted by `accent-color`; the visual will differ. |
| 50 | Destructive card | `padding:14px 16px`, `radius:7px`, `bg #ffffff`, `border 1px #f3d3d0`; `h2` sans 13/600 `#991b1b`; `p` `margin:6px 0 0` sans 12px `#5c5c62`; button `height:31px`, `padding:0 12px`, `radius:5px`, `border 1px #dc2626`, `bg #ffffff`, `#991b1b` | declared hover `background:#fef2f2` (inert) | **Card** + **Button**. shadcn `variant="destructive"` is a *solid* red fill; this is an outline-danger button, which shadcn does not ship. Add a `destructive-outline` variant. |
| 51 | Empty state | `max-width:340px`, `text-align:center`, `padding:26px`, `radius:8px`, `bg #ffffff`, `border 1px #e3e3e0`; eyebrow mono 10px `0.14em` uppercase `#8f8f92`; `h2` `margin:8px 0 0` sans 15/600; `p` `margin:7px 0 0` sans 12.5px `#5c5c62` `text-wrap:pretty` | one state | **Card** |
| 52 | Button size ladder | Nine distinct heights across the file: `32` (header), `31` (panel primary, destructive, pack actions), `30` (views save, settings language), `29` (models/members primary, compare selector), `28` (finding actions, settings change, search), `27` (language toggle), `26` (filter chip, pack new), `24` (retry, resend), `23` (diff toggle), `22` (models retry, theme segment) | — | **Button**. Ten heights for what are really three sizes. Recommendation: `sm=24`, `default=28`, `lg=32`, and rebuild every control on those three. |

### 5.5 Primitives from the listed shadcn set that appear **nowhere** in the artboard

`Tabs` (no tab bar exists; the closest is the filter-chip row, which is a chip group), `Tooltip` (no hover affordance of any kind), `ScrollArea` (native scrollbars, custom-styled), `Separator` (every divider is a `border-*` on an existing box, never a standalone rule), `DropdownMenu` content (four `▾` chevrons imply menus; none is rendered), `Collapsible` mechanism (the `▾` on severity group headers implies collapse; nothing collapses).

### 5.6 What will not map cleanly to shadcn defaults

1. **Every data table is a CSS grid, not a `<table>`.** Seven tables, each with its own fixed-px column track list, its own row `min-width`, and horizontal scroll delegated to the wrapping card (`overflow-x:auto; overflow-y:hidden`). shadcn `Table` renders semantic `<table>/<thead>/<tr>/<td>` with `w-full` and per-cell `p-2`; it has no column-track concept and no per-table min-width. Reimplement as a grid-based `<DataGrid>` with a `columns` prop that emits `grid-template-columns` and `min-width`, and give it row-state variants (`selected`, `error`, `indeterminate`). Do not try to bend `Table` into this.

2. **Badges.** shadcn `Badge` is `rounded-md border px-2 py-0.5 text-xs font-medium` (and `rounded-full` in some versions). The artboard's badges are borderless, `radius:3px`, `height:19px`/`20px` with `padding:0 6px`/`0 7px`, `font-size:11px`, `font-weight:400`, and carry 9 distinct bg/fg pairs (5 severity + 4 status). Every visual property differs. Write a `Badge` with `severity` and `status` variant axes and no default border.

3. **Three different segmented controls, none of which is a Tabs.** Header theme (`22px` items, `3px` track pad, `5px` track radius, active item has a *border*), viewer view-mode (`26px` items, `4px` pad, `6px` radius, no border), settings theme (`30px` items, no track at all). `ToggleGroup` gives you one geometry. You need one `SegmentedControl` component with a size prop, and an explicit `data-[state=on]` border rule for the header variant.

4. **No shadows and no rings.** The design is completely flat: two `box-shadow` declarations, both flat selection rails, zero elevation. shadcn `Card` ships `shadow-sm`, `Popover`/`DropdownMenu`/`Select` content ship `shadow-md`, and focus is expressed as `ring-[3px] ring-ring/50`. The artboard's focus is `outline:2px solid #0b7c74; outline-offset:1px`. You must strip shadows globally and replace the ring token with an outline, or the rebuild will read as generic shadcn.

5. **Translucent glass panels over the viewer.** Four overlays use `rgba(255,255,255,0.92)`/`0.94` with a `1px #dededa` border, floating over a hatched canvas. No shadcn primitive is translucent, and none is positioned. These are four bespoke absolutely-positioned components (tool palette, isolate banner, severity legend, view-mode switch) and the isolate banner additionally needs `width:fit-content` with `max-width:calc(100% - 74px)` and internal `flex-shrink` control so the middle segment ellipsises while the label and action do not.

---

## 6. Interactive state and data shape

### 6.1 React state

The whole artboard has **two state keys**.

```js
class Component extends DCLogic {
  state = { page: "findings", lang: "ja" };
}
```

`page` is one of the 10 keys in `PAGES`; anything else falls through to `isStub`. `lang` is `"ja"` or `"en"`. There is no selection state, no expanded/collapsed state, no filter state, no viewer state, and no theme state.

### 6.2 Derived values

`renderVals()` returns a flat bag of ~70 keys consumed by `{{ }}` bindings:

| Group | Keys | Derivation |
|---|---|---|
| Labels | the 18 `NAV` keys | `NAV[k][lang === "ja" ? 0 : 1]` |
| Breadcrumb / title | `crumb`, `pageTitle` | `PAGES[page].crumb`/`.crumbEn`, `.title`/`.titleEn` |
| Screen flags | `isDash`, `isDeliveries`, `isRuns`, `isFindings`, `isModels`, `isChanges`, `isPacks`, `isViews`, `isMembers`, `isSettings`, `isStub` | `page === key`; `isStub` = `designed.indexOf(p) === -1` |
| Navigation handlers | `goDash`, `goDeliveries`, `goRuns`, `goFindings`, `goModels`, `goChanges`, `goViews`, `goPacks`, `goMembers`, `goSettings` | `go(page)` returns `() => this.setState({ page })` |
| Language handlers | `setJa`, `setEn` | `() => this.setState({ lang })` |
| Language toggle styles | `jaBg`, `jaFg`, `jaBorder`, `enBg`, `enFg`, `enBorder` | ternaries on `ja` |
| Nav item styles | `bg`/`fg`/`bar` × 10 prefixes (`Dash`, `Del`, `Runs`, `Find`, `Models`, `Chg`, `Views`, `Packs`, `Mem`, `Set`) | `navVals(key, prefix)` |

Style constants:

```js
const ACTIVE_BG = "#e8f3f1", ACTIVE_FG = "#0a5c56", IDLE_FG = "#5c5c62", BAR = "#0b7c74";
```

### 6.3 Data arrays and objects

There are exactly **two** data structures. Neither describes domain content.

`PAGES` — 10 entries, fields `crumb`, `title`, `crumbEn`, `titleEn`:

```js
findings: { crumb: "納品 2026-08", title: "指摘事項",
            crumbEn: "DELIVERY 2026-08", titleEn: "Findings" }
```

`NAV` — 18 entries, each a `[ja, en]` tuple:

```js
navFind: ["指摘事項", "Findings"]
```

**Every domain row is hardcoded HTML.** There is no findings array, no delivery array, no model array, no member array, no change array, no requirement array. The 6 findings, 6 deliveries, 6 runs, 4 source models, 8 changes, 6 requirements, 5 members, 4 saved views, and 4 activity entries are all literal markup. Any rebuild must invent the row types; §8 lists what the app can actually supply.

### 6.4 What is wired and what is not

| Interaction | Wired? | Detail |
|---|---|---|
| Sidebar navigation | **yes** | 10 nav buttons → `go(page)` |
| In-content deep links | **yes** | 16 `onClick` bindings total: `goFindings` ×5 (dash table link, runs scorecard link, changes related-finding button, views linked-finding card, plus one more), `goModels` ×2, `goPacks` ×2, `goChanges`/`goDash`/`goDeliveries`/`goRuns`/`goViews`/`goMembers`/`goSettings` ×1 each |
| Language switch | **yes** | `setJa`/`setEn` ×2 each. The sidebar pair and the settings 既定の表示言語 pair share the same handlers and the same style bindings, so the two controls always agree. |
| Dark/light switch | **no** | Header segments are `<span>` with no handler. The settings 既定のテーマ pair is also `<span>`. No `theme` state exists. **A dark theme is not in this file.** |
| Sidebar collapse | **no** | Button exists, no handler, no collapsed layout |
| Help | **no** | Button exists, no handler |
| Project switcher | **no** | Button exists, no handler, no menu |
| Finding selection | **no** | The expanded F-118 card and the collapsed rows are separate static markup; no click target, no hover, no shared row component |
| Severity group collapse | **no** | `▾` is a literal character; the 高 group's rows render regardless |
| Sort (`重要度順 ▾`) | **no** | Static text |
| Isolate / `解除` | **no** | Static text; `解除` is styled as a link but is a `<span>` |
| Tool palette, view-mode switch (3D/平面/断面) | **no** | `<span>` elements, active state hardcoded |
| Filter chips, search, retry, resend, export, run, compare, assign, approve, save-view, restore-view, invite, delete-project | **no** | All static |
| Checkboxes | **no** | `checked="{{ true }}"` on all 3; no handler |
| Text inputs | **no** | `value` hardcoded on both; no handler |
| Row selection on any table | **no** | Selected state is baked into one row per table |
| Hover on anything | **no** | 9 `style-hover` attributes; the renderer ignores the attribute entirely |

### 6.5 i18n behaviour — the most important finding in this section

`lang` translates **20 strings**: the 18 `NAV` labels plus `crumb` and `pageTitle`. Everything else stays Japanese in both languages: every table header, every row, every badge, every button inside a screen body, every severity name, every card title. Switching to EN produces an English sidebar and header over a fully Japanese body.

Two consequences for the rebuild:

- The artboard is not a bilingual design. It specifies the JA design plus an EN chrome sample. You have no EN text for 400+ strings, and JA is far more compact than EN — `プロジェクト設定` at 13px fits the 238px sidebar; `Project settings` at 13px is the longest EN nav label in the file and already relies on `text-overflow:ellipsis` (declared on every nav label).
- `チェック実行` maps to **two different** EN strings: `navRuns` → `Check runs` (a noun, the list screen) and `actRun` → `Run check pack` (a verb, the header action). The JA is ambiguous and only the EN disambiguates. Pick distinct JA strings, e.g. keep `チェック実行` for the noun and use `チェックを実行` for the action.
- EN breadcrumbs are uppercase (`PROJECT`, `TENANT`, `DELIVERY 2026-08`); JA breadcrumbs are not. That is a deliberate typographic choice, since the header crumb is set in IBM Plex Mono, which has no CJK uppercase concept.

---

## 7. String inventory

### 7.1 Bilingual strings — the complete set (20 keys, from `NAV` and `PAGES`)

| Key | Japanese | English | Surface |
|---|---|---|---|
| `secReview` | レビュー | REVIEW | Sidebar section label |
| `secModel` | モデル | MODEL | Sidebar section label |
| `secSetup` | 設定 | SETUP | Sidebar section label |
| `navDash` | ダッシュボード | Dashboard | Nav item |
| `navDel` | 納品 | Deliveries | Nav item (trailing count `12`) |
| `navRuns` | チェック実行 | Check runs | Nav item (trailing teal dot) |
| `navFind` | 指摘事項 | Findings | Nav item (trailing red badge `34`) |
| `navModels` | ソースモデル | Source models | Nav item |
| `navChg` | 変更差分 | Changes | Nav item |
| `navViews` | 保存ビュー | Saved views | Nav item |
| `navPacks` | チェックパック | Check packs | Nav item |
| `navMem` | メンバー | Members | Nav item |
| `navSet` | プロジェクト設定 | Project settings | Nav item |
| `navCollapse` | サイドバーを閉じる | Collapse sidebar | Sidebar footer |
| `navHelp` | ヘルプ | Help | Sidebar footer |
| `actCompare` | 2026-06 と比較 | Compare with 2026-06 | Header button |
| `actExport` | レポート出力 | Export report | Header button |
| `actRun` | チェック実行 | Run check pack | Header primary button |
| `badgeLocked` | 確定済 | Locked | Header badge |
| `crumb` / `pageTitle` | per screen, below | per screen, below | Header |

Breadcrumb and title pairs:

| Screen | JA crumb | JA title | EN crumb | EN title |
|---|---|---|---|---|
| `dash` | プロジェクト | ダッシュボード | PROJECT | Dashboard |
| `deliveries` | プロジェクト | 納品 | PROJECT | Deliveries |
| `runs` | 納品 2026-08 | チェック実行 | DELIVERY 2026-08 | Check runs |
| `findings` | 納品 2026-08 | 指摘事項 | DELIVERY 2026-08 | Findings |
| `models` | プロジェクト | ソースモデル | PROJECT | Source models |
| `changes` | 納品 2026-08 | 変更差分 | DELIVERY 2026-08 | Changes |
| `views` | 納品 2026-08 | 保存ビュー | DELIVERY 2026-08 | Saved views |
| `packs` | テナント | チェックパック | TENANT | Check packs |
| `members` | テナント | メンバー | TENANT | Members |
| `settings` | プロジェクト | プロジェクト設定 | PROJECT | Project settings |

### 7.2 English-only strings (no JA counterpart anywhere)

| String | Surface |
|---|---|
| `ModelShelf` | Wordmark |
| `BIM Delivery Checker` | Wordmark subtitle |
| `DARK`, `LIGHT` | Header theme segments, settings theme segments |
| `EN` | Sidebar language toggle (paired with 日本語) |
| `English` | Settings language toggle (paired with 日本語) |
| `combined ifc model — canvas` | Viewer caption |
| `base / head overlay` | Changes diff-overlay caption |
| `engine 0.9.4` | Footer |
| `parser web-ifc 0.0.57` | Footer, and runs metadata block |
| `origin 412308.44, 5318992.10` | Footer |
| `4 / 4 sources ready` | Footer right slot |
| `engine 0.9.4 · parser web-ifc 0.0.57` | Runs metadata |
| `pack JRC-IR v4 · ids sha 4c1f…9ab2` | Runs metadata |
| `ARCH`, `STRUCT`, `MEP`, `OTHER` | Discipline codes (also appear inside JA labels such as `建築 ARCH`) |
| `IFC4`, `IFC2X3`, `IFC4 / 2X3` | Schema labels |
| `property`, `classification`, `attribute` | Facet column, packs table |
| `IfcWall`, `IfcDoor`, `IfcSlab`, `IfcColumn`, `IfcSpace`, `IfcBeam` | IFC type column |
| `FireRating`, `Thickness`, `IsExternal`, `true` | Property-diff table |
| `Pset_WallCommon.FireRating 必須` | Mixed; the identifier is English |
| `コア壁は LoadBearing = true` | Mixed |
| `SHA-256`, `4c1f9ab2…8e70` | Models metrics |
| `JGD2011 / 9 系` | Settings (mixed) |
| `R10`, `R11`, `R12`, `rev_*`, `dlv_*`, `prj_*`, `view_*`, `F-118`…`F-151`, `IR-A-014`…`IR-X-011` | Identifiers |
| `2O2Fr$t4X7Zf8NOew3FLOH` | IFC GlobalId, changes detail panel |
| `worker timeout` | Failed run reason, runs list |
| `Archicad 27`, `Revit 2026`, `Civil 3D 2026` | Authoring tools (inside JA strings) |
| `morita@jrc.co.jp`, `sato@arch-partners.jp`, `suzuki@str-eng.jp`, `tanaka@mep-works.jp`, `takahashi@jrc.co.jp`, `yamada@site-topo.jp`, `kimura@mep-works.jp` | Members |
| `3D` | Viewer mode segment |
| `12 OBJ`, `obj` | Object-count units |

### 7.3 Japanese-only strings — shell

| Japanese | Surface | EN counterpart |
|---|---|---|
| 品川ターミナル C 期 | Project switcher; settings project name input | none |
| 日本語 | Language toggle | none (paired with `EN` / `English`) |
| 森 | Header avatar initial | none |

### 7.4 Japanese-only strings — findings screen (the target screen, complete)

Viewer pane:

| Japanese | Surface |
|---|---|
| アイソレート: | Isolate banner label |
| 12 オブジェクト · F-118 | Isolate banner value |
| 解除 | Isolate banner action |
| ハイライト | Legend eyebrow |
| 重大 / 高 / 中 / 参考 / 判定不能 | Legend rows (the 5 severity names) |
| 3D / 平面 / 断面 | View-mode segments |

Findings panel:

| Japanese | Surface |
|---|---|
| 指摘事項 | Panel `h2` |
| 34 件 · 612 オブジェクト | Panel count |
| 重要度順 ▾ | Sort control |
| 重大 / 高 / 中 / 判定不能 | Stat tile labels (参考 absent) |
| 6 件 · 118 オブジェクト | 重大 group count |
| 12 件 · 264 オブジェクト | 高 group count |
| 5 件 — 根拠が不足 | 判定不能 group count |
| 防火区画壁に耐火性能の記載なし | F-118 title |
| 防火区画に属する全ての IfcWall に Pset_WallCommon.FireRating が設定されていること。 | F-118 requirement prose |
| プロパティ | F-118 tag (facet) |
| 防火・避難 | F-118 tag (category) |
| オブジェクト / 階 / 実値 | Mini-table headers |
| EW-200 外壁 / IW-100 シャフト A / IW-100 シャフト B | Mini-table object names |
| 3F / 4F | Mini-table storeys |
| 他 9 件 | Mini-table overflow row |
| ビューで絞り込む | F-118 primary action |
| 担当割当 | F-118 secondary action |
| 承認 | F-118 secondary action |
| 室に用途分類コードが未設定 | F-121 title |
| ダクトが構造梁と干渉 | F-124 title |
| コア壁の耐力壁フラグが欠落 | F-130 title |
| 扉の有効幅が基準未満 | F-142 title |
| 仕上材の材料参照が欠落 | F-147 title |

### 7.5 Japanese-only strings — the other 9 screens

`dash`: 最新納品の適合率, 未処理の指摘, ソースモデル, 次回提出まで, 日 — 2026/09/19, レビュー期間 62% 経過, 重大 6 · 高 12 · 中 11 · 判定不能 5, 1 件パース失敗, 建築・構造・造成 正常, 設備 MEP-HVAC-R05 失敗, 重要度の高い未処理, 指摘一覧へ →, ID, 要件, 重要度, 対象, 担当, 不能, 建築 / 佐藤, 設備 / 田中, 構造 / 鈴木, 未割当, 機器の型番情報が判定できない, ソースモデルの状態, 開く →, 建築 · IFC4 · 128 MB, 構造 · IFC4 · 74 MB, 設備 · IFC2X3 · 96 MB, 造成 · IFC4 · 22 MB, 正常, パース失敗, 再試行, 最近の活動, チェック実行が完了 — JRC 情報要件 v4, F-124 を設備 / 田中 に割当, MEP-HVAC-R05.ifc のパースが失敗（エンティティ 41208）, 納品「2026-08 調整図提出」を確定

`deliveries`: すべて 12, レビュー中 1, 承認済 9, 納品を検索, 納品, モデル, 適合率, 指摘, 状態, 2026-08 調整図提出, 2026-06 実施設計 中間, 2026-04 基本設計 最終, 2026-02 基本設計 中間, 2025-12 概念設計, 2025-10 事前協議, レビュー中, 承認済, 完了, ビューアで開く, 差分, 収録モデルリビジョン, 実行履歴, JRC 情報要件 v4 / v3, パース失敗 — エンティティ 41208, 前回から再利用

`runs`: 実行履歴, 28 件, JRC 情報要件 v2/v3/v4, 失敗, 適合率, 合格, 不合格, 対象外, 判定不能, 重要度別スコアカード, 6 件 · 118 obj, 12 件 · 264 obj, 11 件 · 187 obj, 5 件 · 43 obj, 5 件 · 63 obj, 合格として扱いません — 根拠または対応範囲が不足, 要件別の結果, 64 要件, 識別子, 要件名, 結果, 壁の耐火性能, 室の用途分類, 耐力壁フラグ, 機器の型番情報, 階の命名規則, 造成範囲の座標系

`changes`: 比較, 建築 ARCH ▾, 不確実な対応 14 件, 追加, 削除, 移動, 形状変更, 属性変更, 複合, 変更なし, 変更種別, オブジェクト, IFC タイプ, 階, 対応, 一致, 推定 0.82, 推定 0.71, EW-200 外壁, IW-100 シャフト A, D-0412 防火扉, SL-300 スラブ, CW-110 間仕切, CL-020 柱, RM-3-014 事務室, B-2-008 梁, 旧を表示, 新を表示, 移動距離 0.42 m — 東へ, プロパティの差分, プロパティ, 旧, 新, この変更により要件 IR-A-014（壁の耐火性能）が新たに不合格になりました。, 関連する指摘 F-118 を開く

`models`: ソースモデル, 4 件 · 全 62,252 オブジェクト, IFC を追加, ファイル, 分野, リビジョン, スキーマ, オブジェクト, サイズ, 状態, 建築 東棟 · Archicad 27, 構造 コア · Revit 2026, 造成 · Civil 3D 2026, ARC-EAST-R12.ifc のリビジョン履歴, 2026/08/13 提出, 2026/06/11 提出, 2026/04/07 提出, 現行, パース・ジオメトリ指標, パース時間, 単位（長さ→m）, 一意ジオメトリ / インスタンス

`packs`: チェックパック, ＋ 新規, JRC 情報要件, 国交省 BIM 標準, 社内 品質基準, 設備 干渉ルール, v4 · 64 要件 · 08/01 発行, 現行バージョン, 2026/08/01 発行, 要件数, 重大, 対象 IFC, IDS を書き出す, 新バージョンを作成, 要件一覧, 分類, ファセット, Pset_WallCommon.FireRating 必須, IfcSpace に分類参照が必要, コア壁は LoadBearing = true, 主要機器に製造者・型番, 「B1F / 1F / 2F」形式, 測地座標の明示が必要, 防火・避難, 用途・面積, 構造, 設備, 命名規則, 座標・単位

`views`: すべて 9, 自分のビュー 4, 共有 5, 現在のビューを保存, 3F 防火区画, 3F 防火区画レビュー, MEP 干渉, 設備 干渉 4F 天井内, コア 全高, コア壁 耐力壁確認, 1F 平面, 1F 平面 用途分類, 断面 +2.4 m, MEP のみ, STRUCT のみ, 平面ビュー, 共有, 自分のみ, ビューを復元, 保存された状態, カメラ, 透視 · 42°, 断面, 水平 +2.4 m, 表示分野, アイソレート, 12 オブジェクト, 紐付く指摘

`members`: メンバー, 8 名 · 3 組織, メンバーを招待, 氏名, 組織, 権限, 担当分野, 指摘, 森田 健一, 佐藤 美咲, 鈴木 大輔, 田中 亮, 高橋 悠, JR 東日本コンサル, 設計 A 事務所, 構造設計 B, 設備 C 工業, 情報管理者, 編集者, 閲覧者, 全分野, 建築 ARCH, 構造 STRUCT, 設備 MEP, 権限の内容, チェックパックの編集、納品の確定、メンバー管理, モデルの提出、指摘への対応、ビューの共有, 閲覧とレポート出力のみ, 保留中の招待, 閲覧者 · 08/12 送信, 編集者 · 08/13 送信, 再送

`settings`: プロジェクト情報, プロジェクト名, プロジェクト ID, 発注者, JR 東日本コンサルタンツ, 既定のチェックパック, JRC 情報要件 v4, 64 要件 · 08/01 発行, 変更, 納品の確定時に自動でチェックを実行, 判定不能は合格として扱わない, 座標系・単位, 測地座標系, プロジェクト原点, 真北角, 長さの単位, m（IFC 0.001）, 表示とレポート, 既定の表示言語, 既定のテーマ, レポートに 3D スナップショットを含める, プロジェクトの削除, 納品・実行履歴・指摘事項がすべて削除されます。この操作は取り消せません。, プロジェクトを削除

`stub`: 未設計, この画面はまだ設計していません。必要になったタイミングで、同じコンソール様式で追加します。

### 7.6 Glyph-only strings

`▾` (12 uses, dropdown/collapse affordance), `›` (help row), `→` (compare arrow), `▲ 4.1` (positive delta), `—` (em dash as the null-value marker throughout, 30+ uses), `·` (middle dot as the metadata separator throughout), `＋` (full-width plus, packs new button), `−` (minus sign in `+412 / −96`).

The em dash `—` doubles as both "no value" (table cells) and a sentence-level dash (`5 件 — 根拠が不足`, `移動距離 0.42 m — 東へ`). Recommendation: keep `—` for null cells and use `：` or a comma for prose.
