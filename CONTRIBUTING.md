# Contributing

Thanks for considering a contribution. This is a small, focused codebase; the goal
is to keep it that way.

## Setup

Requires Node.js 20 or newer.

```
npm install
npm run build
```

## Workflow

Before opening a pull request, make sure all of these pass — CI runs the same set:

```
npm run lint
npm run format:check
npm run build
npm test
```

Use `npm run format` to apply Prettier and `npm run test:watch` while iterating.

## Code style

- TypeScript in strict mode; the linter and formatter are the source of truth.
- Match the surrounding code: naming, import order, async/await, file layout.
- Comment _why_, not _what_, and only where the intent is not obvious from the code
  (for example a Proxmox API quirk). No banner comments, no restating the function
  name, no emoji.
- Keep abstractions proportional to the problem. Don't add layers for one caller.

## Tests

- Unit tests live next to the code as `*.test.ts` and mock `fetch`. Add or update
  them for any behaviour change — assert real behaviour, not `expect(true)`.
- `npm run sweep` exercises every tool end to end against the in-memory simulator in
  `sim/` (start it with `npm run sim` first). No Proxmox needed.
- `npm run test:live` runs the full create/snapshot/backup/restore cycle against a
  real node. Point a `.env` at a throwaway lab node and a free VMID range — never a
  production cluster. It cleans up after itself.

## Adding a tool

Tools are grouped by area under `src/tools/`. To add one:

1. Register it in the matching module with a `zod` schema and a short, action-oriented
   description.
2. Set the annotations honestly: `readOnlyHint` for reads; `destructiveHint` for
   anything that can lose data or disrupt a guest.
3. Mark state-changing tools with `write: true` so they are skipped in read-only mode.
4. Gate destructive tools through `requireConfirm` (and `requireMatchingId` for
   delete/restore/rollback), and call `guardTarget` to honour the allowlists.
5. Return write results through `settleTask` so the UPID is polled to completion.
6. Add it to the README tool list.

## Distribution artifacts

The compiled `dist/` is committed because the Claude Code plugin and the `.mcpb`
bundle run the prebuilt output — a marketplace install does not build. After changing
anything under `src/`, run `npm run build` and commit the updated `dist/` in the same
change.

## Commit messages

Short, imperative, describing the change: `add qemu lifecycle tools`, `handle UPID
polling timeout`. One logical change per commit.
