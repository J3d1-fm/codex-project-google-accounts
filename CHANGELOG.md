# Changelog

## v0.1.3 - 2026-05-13

### Added
- Added Gmail attachment support for `gmail.send`, `gmail.create_draft`, and `gmail.reply_thread_latest`.
- Attachments can be provided as local file paths or base64 content.

### Changed
- Updated fast-path skill guidance so project-bound Gmail can attach files directly without falling back to generic Gmail connector flows.

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
