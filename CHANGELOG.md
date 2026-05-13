# Changelog

## v0.1.2 - 2026-05-13

### Fixed
- Fixed public packaging so `skills/project-google-accounts/SKILL.md` is tracked and included in GitHub source archives.
- Scoped the local-state ignore rule to the repository root so it does not hide plugin skill files.

## v0.1.1 - 2026-05-13

### Added
- Public Codex plugin package for project-bound Google accounts.
- Gmail, Calendar, and Drive MCP tools.
- Fast-path guidance so routine tasks call target tools directly when project binding is known.
- `drive.create_google_doc` for one-call Google Doc creation from text or HTML.
- Optional content upload/import support in `drive.create_file`.

### Security
- No local tokens, OAuth client secrets, project paths, emails, logs, or personal workspace files are included.
