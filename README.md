# OpenCode Skill of the Day

An OpenCode V2 home-page card for discovering available skills, ordered from
least to most used over the last **30 days**. Browse forgotten skills, add a
skill to your draft, or draft a removal request without changing configuration.

## Install locally

Requires Bun 1.3.6 or newer. Verified against OpenCode 2.0.28 and its
OpenTUI 0.5.17 public APIs. The published 2.0.29 TUI API files are identical,
but a live 2.0.29 run has not been tested.

Clone or place this directory on the **server** running OpenCode, then:

```sh
git clone https://github.com/Mishkun/opencode-skill-of-the-day.git
cd opencode-skill-of-the-day
bun install --registry https://registry.npmjs.org
bun run build
bun run typecheck
bun test
```

Add the absolute directory to the desired project's `opencode.json` or
`opencode.jsonc`, preserving other settings and plugins:

```json
{
  "plugins": ["/absolute/path/to/opencode-skill-of-the-day"]
}
```

The V2 local loader uses root `index.ts`. The root `tui.ts` adapter and
package `./tui` export point to `dist/tui.js`, compiled with the OpenTUI Solid
Bun transform. Plain `bun build` cannot replace this JSX build step. Build
before loading; rebuild after source changes. Use the normal OpenCode plugin
reload workflow when needed. No global configuration change or restart is
performed by this package.

The connected server advertises the TUI entrypoint automatically. The server
plugin is required; a CLI-only installation has no ranking RPC and shows an
unavailable state. There is **no dependency on a history/introspection plugin**.

## Options

```json
{
  "plugins": [{
    "package": "/absolute/path/to/opencode-skill-of-the-day",
    "options": {
      "refreshSeconds": 60,
      "dbPath": "/absolute/path/to/server-history.sqlite"
    }
  }]
}
```

- `refreshSeconds`: polling interval, 15–3600 seconds; default 60. Home mounts
  and location changes also refresh. Hidden cards stop polling. Retry handles
  unavailable RPC, registry or database states.
- `dbPath`: optional **server-side absolute path**. Omit normally. Default
  resolution follows OpenCode 2.0.28's channel filename rules,
  `OPENCODE_DB`, `OPENCODE_DISABLE_CHANNEL_DB` and `XDG_DATA_HOME`.
  Useful for an isolated test fixture or custom server storage. In-memory
  databases cannot be reopened and are reported unavailable.

Never point a remote TUI at an unrelated client database: all SQLite access
occurs on the connected **server**, via a location-scoped custom RPC.

## Card actions

- Initial selection: least-used available configured skill. Zero-use skills
  are included. Equal-count groups are randomized once per Home mount; their
  order stays stable across polling and refresh. Usage counts always sort
  ascending, even when counts change.
- `<-` / `->`: page through the complete least-to-most-used ordering, without
  wrapping at either end. The current selection survives refresh if available.
- **Use** inserts `@<id>` at the current cursor, adds word separators where
  needed, and leaves the caret immediately after the skill token. Select the
  skill through OpenCode's native autocomplete before sending the prompt:
  literal mention text alone is not a committed skill attachment. While the
  picker is open, Enter performs its normal selection action. The plugin
  itself never selects a picker entry or sends the prompt.
- **Remove** appends this plain-language request and focuses the textbox:

  > Please remove the @\<id\> skill from my OpenCode configuration. Use this setup’s installation workflow.

  It **does not remove a skill**, open a modal, modify configuration or submit
  the request. Review the draft and choose whether to send it yourself.
- Existing selected text is retained; selection is cleared and Use inserts at
  its end. No whole-buffer rewrite occurs, preserving native attachment marks.
- **X** hides the widget only until home remount. No persisted snooze or timer.

Buttons are mouse actions, not global arrow-key overrides. They do not steal
focus. Edits require the home route, base input mode and a public focused
edit buffer; otherwise the plugin requests that you focus the home textbox.
All buttons, including X, use the same normal style, invert on hover and
restore on mouse exit.

During initial loading and location switches, the entire card is absent: no
title, loading text, placeholder or reserved space. Once ready, same-location
refreshes keep the card visible and preserve selection and tie order. Errors
without a usable result show their status and Retry after loading finishes.

The card anchors to the public `after: "prompt.footer"` slot and appears as an
absolute, full-width column two rows below the prompt's native footer. A
supported OpenTUI Solid `Portal` mounts the card-sized box on the renderer root,
avoiding later transparent host branches overwriting its mouse hit grid. Only
the portal's own box is positioned; it stays within the prompt's 75-column
width, below native modal layers, without squeezing the path/file row or
covering the native textbox's mouse area.
The heading, skill name, usage and X share one line:
`Skill of the Day: name 0 uses 30d X`. Names are shortened before the count;
explicit padding separates the fields. Descriptions are control-character-cleaned,
limited to 400 characters and clipped to two lines. Paging and actions sit below.

If the complete card cannot fit above the bottom status row plus one spare
row, it is **hidden**, not clipped or moved to another footer. Terminals below
20 rows and prompt widths below 40 columns also hide it. It returns when input
shrinks or the viewport grows, unless dismissed with X. Selection, tie order
and the single card/RPC model survive these layout changes. Geometry comes
only from a plugin-owned public layout anchor and completed renderer frames.
That anchor draws nothing, reserves no flow space and has no mouse hit target;
no native parent layout, private IDs or host tree are inspected or mutated.

## Counts and SQLite privacy

The count is **distinct skill uses per stored user turn**, not raw attempts:

- Completed explicit `skill` tool results with `state.input.id` (or historical
  `name` fallback); failed, running and streaming results excluded. Success is
  determined by `state.status === "completed"`. The V2 `executed` flag means
  **provider-executed**, not “did this tool run”: locally executed successful
  loads commonly have `executed: false` and must still count. Both flag values
  and historical absence are supported.
- Native `user.skills[].id` attachments. This field was verified in the V2
  schema and locally stored payload shapes; absent historical fields count
  no attachment, not a prose mention. Empty arrays are valid; present array
  elements must be objects with nonempty string IDs. Unknown/scalar elements,
  missing IDs and nonstring IDs make the ranking unavailable rather than
  silently producing zero or partial counts.
- Repeated loads and attachment-plus-tool use of the same skill in the same
  turn count once. Tools map to the nearest preceding user message by session
  sequence; orphan tool messages use their own message ID.
- Window: `[now − 30 × 24 hours, now)`, in epoch milliseconds. Tools use their
  completion timestamp, falling back to persisted message creation time.
- All stored V2 sessions on this server are included, across projects,
  subagents and archived sessions. Recommendations join those counts to the
  current location's available registry; unavailable historical skills do
  not become recommendations.

Each query opens SQLite with `readonly: true` and `PRAGMA query_only=ON`, checks
the expected columns, reads a consistent transaction and closes it. Queries
run in a worker off the server event loop with a 30-second termination limit
and a one-second lock wait. No cache/index database is created. No SQL/path
input is accepted from the RPC caller; only installation options set a path.

Historical aggregate counts are cached **in server memory for 60 seconds**, keyed
by the resolved database path and shared across location handlers. The available
registry and its metadata are read afresh on every RPC and joined to those counts;
location-specific recommendations are never cached. Concurrent cold reads share
one worker. Expired reads return last-good counts immediately and start a single
background refresh. The TUI follows up every two seconds while the RPC reports
`refreshInProgress`, adopting the new counts without blanking the ready card.

Cache-backed RPC results include `stale` and `refreshInProgress`. Cached `since` and `until`
always describe the original query window, not the time of a cache hit. A failed
background query keeps last-good counts with `stale: true` and a fixed `error`;
retries back off from five seconds to at most 60 seconds. Missing paths cannot
borrow another database's cached counts. At most 16 source entries are retained,
with least-recently-used eviction and ten-minute idle cleanup on access. Pending
workers are not evicted or cancelled by another location's disposal. Configuration
reload may reset the cache; there is no durable cache and no database/index change.

SQL projects IDs, timestamps and aggregate counts, never prompt text, skill
bodies, reasoning, tool output or credentials. The RPC returns configured
skill metadata and aggregate counts only. SQLite/worker errors are reduced
to fixed status messages, never logged or returned verbatim. The package makes
no third-party network requests. Fixtures are synthetic; no personal history,
actual configured registry dump or screenshots are included in this repository.

Without a successful result for the source, missing database, schema mismatch,
invalid payload, query failure or timeout show **unavailable**, with Retry—not
invented zero counts. Background failures preserve same-source last-good data;
transient RPC failures preserve an already-ready card. An empty supported database
really yields zero; an empty registry yields no skills.

## Known limits and verification

- Fork copies may inflate counts: distinct persisted turns are not collapsed
  across fork lineage. No content hashing is used to merge legitimate similar
  prompts.
- Concurrent steering can make nearest-preceding-user attribution approximate;
  the persisted tool schema exposes no direct originating user-request ID.
- Only retained V2 records count. Legacy tables, pending prompts, prose,
  automatically injected instructions and standalone `session.skill` messages
  are excluded. A completed tool result is tool-reported success, not proof
  that its instructions were followed.
- Native attachment fields and public editor APIs are supported, but this
  plugin does not expose a host-specific prompt controller or inspect private
  renderable IDs, trees or dialog stacks.
- Live prototype validation on 2.0.28 confirmed mouse insertion/native selection,
  Unicode draft preservation, existing native skill and file attachments,
  removal append, selection preservation, X hiding and below-composer layout.
  No action submitted. A separate explicit guarded submit confirmed native
  skill/file attachments without allowing model execution.
- Full-candidate validation on 2.0.28 confirmed server RPC against real history,
  next/previous paging, selection preservation across refresh, missing-database
  status and Retry recovery against a synthetic fixture, 80×30 layout, draft-only
  insertion/Remove, and X hiding. Version 0.1.1 has 55 tests, including seeded
  tie-order, fit gates and compiled headless rendering. A transparent competing
  hit-layer regression reproduces visible-but-unclickable controls before the
  root-portal fix and verifies paging afterward.
- Version 0.1.1 was also tested in a separate real OpenCode 2.0.28 instance:
  blank initial/refresh loading, different equal-use selections after remount,
  adjacent placement, actual mouse paging and draft-only Use/Remove. At 80×15
  or with a long draft the card disappears; growing to 140×50 restores it.
  Tests use a guard against prompt submission and a disposable runtime database.
- Geometry is reevaluated after completed frames; rapid layout changes settle
  on the following render. The fit gate reserves the normal one-row bottom
  status plus one row; arbitrary third-party footer overlays are not measured.
- The warning-toast refusal path for a focused dialog editor has not been
  independently proven; a native modal intercepted outside clicks in the live
  test. Remote-server transport and other operating systems are not live-tested.

Run `bun run build`, `bun run typecheck` and `bun test`. The GitHub CI workflow
runs these against public-safe fixtures only; it has no publish step.

## Sources

- https://opencode.ai/v2/docs/build/plugins
- https://opencode.ai/v2/docs/build/plugins/cli
- https://opencode.ai/v2/docs/build/plugins/rpc
- https://registry.npmjs.org/@opencode/plugin/-/plugin-2.0.28.tgz
  (`package/dist/tui/context.d.ts`)
- https://registry.npmjs.org/@opentui/core/-/core-0.5.17.tgz
  (`package/renderer.d.ts`, `package/renderables/EditBufferRenderable.d.ts`)
- https://github.com/anomalyco/opencode/blob/v2.0.28/packages/cli/src/database-path.ts
- https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/session/sql.ts
- https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/session/runner/publish-llm-event.ts
- https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/session/message-updater.ts
- https://github.com/anomalyco/opencode/blob/v2.0.28/packages/core/src/session/runner/to-llm-message.ts
- https://github.com/anomalyco/opencode/blob/v2.0.28/packages/schema/src/session-message.ts
- https://github.com/anomalyco/opencode/blob/v2.0.28/packages/tui/src/routes/home.tsx
- https://github.com/anomalyco/opencode/blob/v2.0.28/packages/tui/src/component/prompt/index.tsx
- https://github.com/anomalyco/opencode/blob/v2.0.28/packages/tui/src/plugin/render.tsx
- https://github.com/anomalyco/opencode/blob/v2.0.28/packages/plugin/src/tui/context.ts

MIT licensed. No Git initialization, commit, publication or user configuration
mutation is performed by the development/build commands above.
