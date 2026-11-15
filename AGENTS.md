# Agent instructions

This project uses the Payload CMS skill at `.claude/skills/payload/`.
Start with `.claude/skills/payload/SKILL.md` for a quick reference, then see `.claude/skills/payload/reference/` for detailed docs.

## Architecture

Read `architecture/ARCHITECTURE.md` before planning, recommending or implementing changes. It documents how this Payload backend, the Flutter collector app and storage fit together, plus the known risks and next steps. `architecture/vimu-system-architecture.excalidraw` is the matching diagram.

- Plans and recommendations should fit the architecture described there, or say explicitly where and why they depart from it.
- When a change alters the architecture (collections, access rules, endpoints, auth, storage, app integration), update `ARCHITECTURE.md` in the same change and note if the diagram needs updating.
