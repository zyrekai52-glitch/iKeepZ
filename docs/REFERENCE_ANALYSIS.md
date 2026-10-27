# Reference analysis — “KeepR” video

The supplied video (3 min 33 s, 1920×1080) shows **KeepR**, a local-first encrypted vault / “Life OS” desktop app, in a custom window
on a dark wavy wallpaper. It is **not** a finance app. iKeepZ takes its **visual language and interaction patterns**; the product scope
comes from the brief (12 sections + e-wallet). The KeepR logo, name, keyhole-R mark and intro animation are *not* reused.

## What the video shows (timeline)
| t | screen | patterns taken |
|---|---|---|
| 0:00 | Lock screen on dark wallpaper: logo, tagline, “Master password” field with eye toggle, white “Unlock Vault →” button, “Forgot password? Use recovery code”, tiny spec line | centred auth card, password reveal toggle, loading state on the button (“Working…”) |
| 0:08 | Unlock → dark→light **theme transition wipe** | animated theme switch |
| 0:12 | **Dashboard**: greeting “Good evening, NAME.”, 3 stat cards, amber alert row (“1 task overdue · View tasks →”), area chart “Income Activity” with hover tooltip + THIS MONTH / ALL-TIME mini cards, side widgets (World Clocks, Upcoming Tasks, Vault Protection checklist 3/3 + “Create Backup”), Recent list | summary cards, alert strip, area chart + tooltip, side widgets, checklist-with-progress |
| 0:22 | “Add World Clock City” modal: search field + list rows with “+ Add” | search-in-modal pattern |
| 0:30 | **Vault** list: grid/list toggle, search, tag filter, “+” button; rows with icon, title, subtitle, masked value, eye / copy / star / ⋮ actions | list rows with inline actions, favourites |
| 0:36 | Detail modal (read-only fields, Close / Copy / Edit) and **New credential** modal (uppercase micro-labels, inputs on light-gray fill, password strength meter, folder select, favourite star, tags) | detail→edit modal flow, strength meter, tags |
| 0:55 | **Notes**: two-pane list + editor, search, folder filter, toolbar, success toast “Success — Note created” bottom-right | master/detail, toast |
| 1:25 | “Move to folder” picker modal | picker modal |
| 1:30 | **Tasks**: grouped table (To Do / In Progress / Completed) with colour chips (Low green, Medium amber, High red), search, due-date + tag filters, row ⋮; detail modal, edit modal with date + selects | grouped tables, priority chips, filters |
| 2:00 | **Calendar**: week / month / year views, summary cards below | summary cards under a view |
| 2:20 | **Income** (finance-like): “Log income” modal — SOURCE, CURRENCY dropdown (PHP USD AUD EUR GBP JPY CAD …), AMOUNT, DATE, CATEGORY (Salary, Freelance, Consulting, Bonus, Royalties), REMARKS/NOTES; detail modal with “+ PHP 260,000.00” | **record form + detail modal → iKeepZ Records** |
| 2:35 | **Folders**: coloured folder cards, colour picker popover, “New folder” modal, sort + grid/list toggle | **Categories** with colour picker |
| 2:45 | Favourites, **Generate Password** (length slider, toggle rows, strength bar) | toggles/sliders in settings-style rows |
| 3:00 | **Settings**: left sub-nav (Account · Appearance · Security · Data · About). Appearance: Light/Dark segmented control, **accent colours** (Sage, Clay, Slate, Moss, Stone, Dusk), font size (Small/Medium/Large), toggle. Security: auto-lock minutes, change master password, recovery code dialog. Data: export/import, CSV, red “Reset Vault” danger zone | **Settings structure, accents, font size, auto-lock** |
| 3:20 | Command palette (“Search … ⌘K”), then intro animation “KeepR” | quick-search palette |

## Layout system
* Custom title row: ☰ toggle, tiny wordmark, centred search pill “Search ⌘K”, window controls (desktop only in iKeepZ: search pill in the top bar).
* **Sidebar** ~200 px: avatar + display name + theme toggle (moon), section labels “MODULES” / “TOOLS” (9 px, uppercase, wide tracking),
  items with outline icon + label, selected item = soft blue-gray pill, count badge (Tasks 3). Bottom group: Activity Log, Settings, Lock.
* Content: page title (mono, bold) + muted one-line description, toolbar row (search, filters, primary “+” square button), then cards.
* Cards: white, 1 px border `#E5E7EB`, radius ≈ 10, no heavy shadow. Modals: radius ≈ 12, backdrop blur + dim, title + close ✕, footer buttons
  (outlined Cancel, filled primary).
* Typography: **monospace** for titles, labels, buttons, numbers (JetBrains-Mono-like), clean sans for descriptive body text. Micro-labels uppercase 9–10 px,
  letter-spaced, muted.
* Colours (sampled): primary slate-blue ≈ `#3F6A85`; light surface `#FFFFFF`, fill `#F3F4F6`, border `#E5E7EB`, selected nav `#E3E9EE`, text `#1B2430`, muted `#6B7580`;
  chips Low `#2F8F4E on #DDF2E3`, Medium `#B7791F on #FBEFD0`, High `#C53030 on #FBDADA`; dark surfaces ≈ `#121417` / `#1A1E23`, border `#2A2F36`, text `#E6E8EB`.
* Motion: restrained — 150–250 ms fades, modal scale-in, theme cross-fade.

## Mapping to the brief’s sections
| brief section | reference pattern reused |
|---|---|
| Dashboard | greeting, stat cards, alert strip, area chart + tooltip, side widgets, recent list |
| Analytics | chart card + mini stat cards, range filter |
| Records / Transactions | Income “Log income” form + detail modal, Vault list rows, filters/search/sort |
| Categories | Folders (colour cards, colour picker, new-folder modal) |
| Reports | Data tab (export CSV) + summary cards |
| E-Wallet | new section (not in video) built from the same cards/modals/chips |
| Notifications | toast + list rows |
| Profile | Settings → Account (picture, display name, preview card) |
| Security | Settings → Security (auto-lock, password change, recovery) |
| Settings | Settings sub-nav, Appearance (theme, accent, font size) |
| Help & Support / About | Settings → About pattern |

Not taken from the video (not in the brief): password vault, notes, tasks, calendar, world clocks, encryption/master-password model.
