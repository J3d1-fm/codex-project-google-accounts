---
name: project-google-accounts
description: Use when Gmail, Google Calendar, Google Drive, or Google access should come from the Google account bound to the current local project rather than the built-in Codex connector account. Provides project-account binding, OAuth login URLs, Gmail profile/search/thread/draft/send tools, Calendar list/read/create/update/delete/freebusy tools, and Drive search/list/create/export/update tools.
---

# Project Google Accounts

Use this plugin when a Codex project needs its own Gmail, Google Calendar, or Google Drive account without changing the account used to sign in to Codex.

## Fast Path

- If the current project already has `.codex/google-account.json`, local instructions name the binding, or the thread context already names the project-bound account, call the target Gmail/Calendar/Drive tool directly. Do not call `google_accounts.project_status`, `gmail.profile`, or connector profile checks first.
- Treat `google_accounts.project_status` and `gmail.profile` as diagnostics, not prerequisites. Use them only when the binding is unknown, the user asks which account is connected, or a previous tool call failed with an account/token/scope error.
- For a short reply to a known Gmail thread, prefer `gmail.reply_thread_latest` with the known `thread_id`.
- For Gmail attachments, pass `attachments` directly to `gmail.send`, `gmail.create_draft`, or `gmail.reply_thread_latest`. Each attachment can use `path` for a local file or `content_base64`; do not switch to generic Gmail connector flows just to attach files.
- For Calendar reads, prefer `calendar.list_events` with an explicit `time_min`/`time_max` window. Use `calendar.freebusy` when the user asks for availability.
- For Calendar writes with known event details, call `calendar.create_event`, `calendar.update_event`, or `calendar.delete_event` directly after normal user confirmation rules. Do not preflight with calendar/account diagnostics unless the destination calendar/account is ambiguous.
- For Drive, use `drive.ensure_project_folder` once per project only if no default project folder is already known. Then `drive.create_folder`, `drive.create_file`, `drive.create_google_doc`, and `drive.list_folder` default to that saved project folder.
- When the user asks to create a Google Doc from known/provided text, use `drive.create_google_doc` directly with `content`.

## Workflow

1. Use the fast path when the project binding, target thread, target calendar action/window, or target Drive artifact is already known.
2. If the project binding is unknown or the user asks to check it, call `google_accounts.project_status`.
3. If the project has no account, call `google_accounts.bind_project` with the requested account email.
4. If that account is not connected, or a Gmail/Calendar/Drive call returns `GOOGLE_ACCOUNT_RECONNECT_REQUIRED`, call `google_accounts.reconnect` and show the returned URL to the user.
5. After the browser redirects to localhost, call one low-risk service check such as `gmail.profile`, `calendar.list_calendars`, or `drive.list_folder`.
6. Use the Gmail, Calendar, or Drive tools with the default project path unless the user explicitly names another project.

## Reconnect Behavior

- If `project_status.token.status` is `missing`, `missing_refresh_token`, `missing_scopes`, or a Gmail/Calendar/Drive tool reports `GOOGLE_ACCOUNT_RECONNECT_REQUIRED`, do not ask the user to change built-in Codex connectors.
- Call `google_accounts.reconnect` for the current project/account and present the authorization URL.
- Reconnect overwrites the old token but keeps the project-to-account binding.
- Use `google_accounts.disconnect_local` only when the user explicitly asks to remove the local token; it should not remove project binding.

## Safety

- Sending email, creating drafts, attaching files, creating/updating/deleting calendar events, and creating/moving/renaming Drive files or folders are external actions. Follow normal confirmation rules before performing writes.
- OAuth URLs grant access to Gmail, Calendar, and Drive scopes. Explain the account and destination before asking the user to authorize.
- Tokens are stored locally by the MCP server, outside the project repository.
