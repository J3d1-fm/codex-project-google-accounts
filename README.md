# Codex Project Google Accounts

A local Codex MCP plugin for routing Gmail, Google Calendar, and Google Drive actions through a Google account bound to the current project.

This is useful when your Codex login account is not the same account you want to use for project email, calendars, or Drive files.

## What It Does

- Maps local project folders to Google account emails.
- Stores OAuth tokens locally on your machine.
- Exposes project-bound Gmail tools for search, thread reading, drafts, sends, and replies.
- Exposes project-bound Google Calendar tools for event reads, event writes, and free/busy checks.
- Exposes project-bound Google Drive tools for search, folder creation, Google Doc creation, uploads/imports, metadata updates, and exports.
- Uses a fast path: once a project account is known, Codex can call the target Gmail/Calendar/Drive tool directly instead of checking profile/status first.

## What It Stores

By default:

```text
~/.codex/project-google-accounts/projects.json
~/.codex/project-google-accounts/tokens/*.json
~/.codex/project-google-accounts/oauth-client.json
<project>/.codex/google-account.json
```

The project-local `.codex/google-account.json` stores only the account email and token storage path. It does not store OAuth refresh tokens.

Do not commit `~/.codex/project-google-accounts` or project-local `.codex/google-account.json` files to a public repository.

## Install

Clone this repository into a local plugin directory:

```bash
git clone https://github.com/J3d1-fm/codex-project-google-accounts.git
```

Then install or enable it in your Codex plugin environment according to your Codex plugin workflow. The plugin entrypoint is:

```text
.codex-plugin/plugin.json
```

The MCP server config is:

```text
.mcp.json
```

## Google OAuth Setup

Create a Google OAuth client once:

1. Open Google Cloud Console.
2. Create or select a Google Cloud project.
3. Enable the Gmail API.
4. Enable the Google Calendar API.
5. Enable the Google Drive API.
6. Configure the OAuth consent screen.
7. Create an OAuth Client ID.
8. Choose application type `Desktop app`.
9. Download the JSON.
10. Save it as:

```text
~/.codex/project-google-accounts/oauth-client.json
```

Requested scopes:

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/gmail.compose
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/drive
openid
email
profile
```

If your OAuth app is in Google testing mode, add each Google account you want to use as a test user in the OAuth consent screen.

## First-Time Project Setup

Bind the current local project to an account:

```json
google_accounts.bind_project({
  "account_email": "you@example.com"
})
```

Start OAuth:

```json
google_accounts.reconnect({})
```

Open the returned `authorization_url`, approve access, and wait for the localhost success page.

Confirm with one low-risk check:

```json
gmail.profile({})
```

## Fast Path Examples

After a project is connected, call the target tool directly.

Search Gmail:

```json
gmail.search({
  "query": "from:someone@example.com newer_than:7d",
  "max_results": 10
})
```

List calendar events:

```json
calendar.list_events({
  "calendar_id": "primary",
  "time_min": "2026-01-01T00:00:00Z",
  "time_max": "2026-01-02T00:00:00Z"
})
```

Create a calendar event:

```json
calendar.create_event({
  "summary": "Planning",
  "start": "2026-01-01T15:00:00Z",
  "end": "2026-01-01T15:30:00Z"
})
```

Create a native Google Doc from text:

```json
drive.create_google_doc({
  "name": "Project Notes",
  "content": "Document body",
  "content_mime_type": "text/plain"
})
```

Create a formatted Google Doc from HTML:

```json
drive.create_google_doc({
  "name": "Formatted Notes",
  "content": "<h1>Notes</h1><p>Document body</p>",
  "content_mime_type": "text/html"
})
```

## Reconnect

If a tool returns `GOOGLE_ACCOUNT_RECONNECT_REQUIRED`, run:

```json
google_accounts.reconnect({})
```

Reconnect keeps the project binding and replaces the local token for that account.

## Security Notes

- Keep OAuth client files and token files outside git.
- Never commit `tokens/*.json`.
- Use separate Google Cloud OAuth clients for different environments if needed.
- Review Google API scopes before authorizing.
- Email sends, calendar writes, and Drive writes are external actions. Confirm them before running.

## Development Checks

```bash
node --check bin/server.mjs
python3 /path/to/quick_validate.py skills/project-google-accounts
```
