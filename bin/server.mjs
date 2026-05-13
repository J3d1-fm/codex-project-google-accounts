#!/usr/bin/env node
import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { URLSearchParams } from "node:url";

const DATA_HOME = process.env.PROJECT_GOOGLE_ACCOUNTS_HOME
  || path.join(os.homedir(), ".codex", "project-google-accounts");
const REGISTRY_PATH = path.join(DATA_HOME, "projects.json");
const REGISTRY_LOCK = path.join(DATA_HOME, "projects.lock");
const TOKEN_DIR = path.join(DATA_HOME, "tokens");
const OAUTH_CLIENT_PATH = process.env.GOOGLE_OAUTH_CLIENT_FILE
  || path.join(DATA_HOME, "oauth-client.json");
const DEFAULT_PROJECT = process.env.CODEX_WORKSPACE
  || process.env.PWD
  || process.cwd();

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive",
  "openid",
  "email",
  "profile"
];

const TOOLS = [
  {
    name: "google_accounts.project_status",
    description: "Diagnostics only. Show the project-bound Google account and token status when the binding is unknown or a prior Gmail/Calendar/Drive call failed.",
    inputSchema: {
      type: "object",
      properties: { project_path: { type: "string" } }
    }
  },
  {
    name: "google_accounts.bind_project",
    description: "Bind a local project path to a Google account email.",
    inputSchema: {
      type: "object",
      properties: {
        account_email: { type: "string" },
        project_path: { type: "string" }
      },
      required: ["account_email"]
    }
  },
  {
    name: "google_accounts.start_oauth",
    description: "Start OAuth for a Google account and return the browser authorization URL.",
    inputSchema: {
      type: "object",
      properties: {
        account_email: { type: "string" },
        project_path: { type: "string" }
      }
    }
  },
  {
    name: "google_accounts.reconnect",
    description: "Start a fresh OAuth consent flow for the project-bound account and overwrite any old local token.",
    inputSchema: {
      type: "object",
      properties: {
        account_email: { type: "string" },
        project_path: { type: "string" }
      }
    }
  },
  {
    name: "google_accounts.disconnect_local",
    description: "Delete the local OAuth token for an account while keeping the project binding.",
    inputSchema: {
      type: "object",
      properties: {
        account_email: { type: "string" },
        project_path: { type: "string" }
      }
    }
  },
  {
    name: "gmail.profile",
    description: "Diagnostics only. Return the Gmail profile for the project-bound account. Skip this before normal Gmail work when the project binding is already known.",
    inputSchema: {
      type: "object",
      properties: { project_path: { type: "string" } }
    }
  },
  {
    name: "gmail.search",
    description: "Fast path. Search Gmail messages directly for the project-bound account using Gmail query syntax; token refresh is automatic.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number" },
        project_path: { type: "string" }
      },
      required: ["query"]
    }
  },
  {
    name: "gmail.read_thread",
    description: "Fast path. Read a Gmail thread directly for the project-bound account; token refresh is automatic.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
        project_path: { type: "string" }
      },
      required: ["thread_id"]
    }
  },
  {
    name: "gmail.create_draft",
    description: "Create a Gmail draft for the project-bound account.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: "string" },
        bcc: { type: "string" },
        reply_message_id: { type: "string" },
        project_path: { type: "string" }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "gmail.send",
    description: "Send an email for the project-bound account.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: "string" },
        bcc: { type: "string" },
        reply_message_id: { type: "string" },
        project_path: { type: "string" }
      },
      required: ["to", "subject", "body"]
    }
  },
  {
    name: "gmail.reply_thread_latest",
    description: "Reply to the latest message in a known Gmail thread for the project-bound account. Use this for fast replies when the thread_id is already known.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
        body: { type: "string" },
        to: { type: "string", description: "Optional override. Defaults to the latest message sender." },
        subject: { type: "string", description: "Optional override. Defaults to Re: latest subject." },
        cc: { type: "string", description: "Optional override. Defaults to latest Cc plus the account address if needed." },
        bcc: { type: "string" },
        project_path: { type: "string" }
      },
      required: ["thread_id", "body"]
    }
  },
  {
    name: "calendar.list_calendars",
    description: "List Google calendars for the project-bound account. Use mostly after reconnect or when the user asks which calendars exist.",
    inputSchema: {
      type: "object",
      properties: {
        min_access_role: {
          type: "string",
          enum: ["freeBusyReader", "reader", "writer", "owner"],
          description: "Optional minimum access role filter."
        },
        show_hidden: { type: "boolean" },
        project_path: { type: "string" }
      }
    }
  },
  {
    name: "calendar.list_events",
    description: "Fast path. List Google Calendar events directly for the project-bound account; token refresh is automatic.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Defaults to primary." },
        time_min: { type: "string", description: "RFC3339 start time, defaults to now." },
        time_max: { type: "string", description: "RFC3339 end time." },
        query: { type: "string" },
        max_results: { type: "number" },
        single_events: { type: "boolean" },
        order_by: { type: "string", enum: ["startTime", "updated"] },
        show_deleted: { type: "boolean" },
        project_path: { type: "string" }
      }
    }
  },
  {
    name: "calendar.read_event",
    description: "Read one Google Calendar event by event ID for the project-bound account.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        calendar_id: { type: "string", description: "Defaults to primary." },
        project_path: { type: "string" }
      },
      required: ["event_id"]
    }
  },
  {
    name: "calendar.create_event",
    description: "Fast path. Create a Google Calendar event directly for the project-bound account when event details are known.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Defaults to primary." },
        summary: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        start: { type: "string", description: "RFC3339 date-time, or YYYY-MM-DD for all-day events." },
        end: { type: "string", description: "RFC3339 date-time, or YYYY-MM-DD for all-day events." },
        time_zone: { type: "string" },
        attendees: { type: "array", items: { type: "string" } },
        send_updates: { type: "string", enum: ["all", "externalOnly", "none"] },
        project_path: { type: "string" }
      },
      required: ["summary", "start", "end"]
    }
  },
  {
    name: "calendar.update_event",
    description: "Fast path. Update a Google Calendar event directly for the project-bound account. Only supplied fields are changed.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Defaults to primary." },
        event_id: { type: "string" },
        summary: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        start: { type: "string", description: "RFC3339 date-time, or YYYY-MM-DD for all-day events." },
        end: { type: "string", description: "RFC3339 date-time, or YYYY-MM-DD for all-day events." },
        time_zone: { type: "string" },
        attendees: { type: "array", items: { type: "string" } },
        send_updates: { type: "string", enum: ["all", "externalOnly", "none"] },
        project_path: { type: "string" }
      },
      required: ["event_id"]
    }
  },
  {
    name: "calendar.delete_event",
    description: "Fast path. Delete a Google Calendar event directly for the project-bound account.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: { type: "string", description: "Defaults to primary." },
        event_id: { type: "string" },
        send_updates: { type: "string", enum: ["all", "externalOnly", "none"] },
        project_path: { type: "string" }
      },
      required: ["event_id"]
    }
  },
  {
    name: "calendar.freebusy",
    description: "Fast path. Query free/busy blocks directly for the project-bound account when the user asks about availability.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_ids: { type: "array", items: { type: "string" }, description: "Defaults to primary." },
        time_min: { type: "string", description: "RFC3339 start time." },
        time_max: { type: "string", description: "RFC3339 end time." },
        time_zone: { type: "string" },
        project_path: { type: "string" }
      },
      required: ["time_min", "time_max"]
    }
  },
  {
    name: "drive.search",
    description: "Fast path. Search Google Drive directly for the project-bound account using Drive query syntax or a title/fullText search string.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Drive API q expression. If omitted, lists recent non-trashed files." },
        text: { type: "string", description: "Convenience search across file name and full text." },
        max_results: { type: "number" },
        include_trashed: { type: "boolean" },
        project_path: { type: "string" }
      }
    }
  },
  {
    name: "drive.list_folder",
    description: "List items directly inside a Google Drive folder for the project-bound account. Defaults to the project's configured Drive folder, then root.",
    inputSchema: {
      type: "object",
      properties: {
        folder_id: { type: "string", description: "Defaults to the project's configured Drive folder, then root." },
        max_results: { type: "number" },
        project_path: { type: "string" }
      }
    }
  },
  {
    name: "drive.get_metadata",
    description: "Get Google Drive file or folder metadata for the project-bound account.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string" },
        project_path: { type: "string" }
      },
      required: ["file_id"]
    }
  },
  {
    name: "drive.export_file",
    description: "Export a Google Workspace file or download text-like file content for the project-bound account.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string" },
        mime_type: { type: "string", description: "Defaults by file type. Examples: text/markdown, text/plain, text/csv, application/pdf." },
        project_path: { type: "string" }
      },
      required: ["file_id"]
    }
  },
  {
    name: "drive.ensure_project_folder",
    description: "Find or create a default Google Drive folder for this project/account and save it in the project-local binding. Use once before creating project artifacts if no default folder is known.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Defaults to the local project folder name." },
        parent_id: { type: "string", description: "Defaults to the project's configured Drive folder, then root." },
        project_path: { type: "string" }
      }
    }
  },
  {
    name: "drive.create_folder",
    description: "Fast path. Create a Google Drive folder directly for the project-bound account. Defaults to the project's configured Drive folder, then root.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        parent_id: { type: "string", description: "Defaults to the project's configured Drive folder, then root." },
        project_path: { type: "string" }
      },
      required: ["name"]
    }
  },
  {
    name: "drive.create_file",
    description: "Fast path. Create a native Google Doc, Sheet, Slide deck, or Drive file for the project-bound account. If content is supplied, uploads/imports it in one call.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        mime_type: {
          type: "string",
          description: "Use application/vnd.google-apps.document, application/vnd.google-apps.spreadsheet, application/vnd.google-apps.presentation, or another Drive MIME type."
        },
        content: { type: "string", description: "Optional UTF-8 content to upload/import into the file." },
        content_mime_type: { type: "string", description: "MIME type for content. Defaults to text/plain; use text/html for formatted Google Docs." },
        parent_id: { type: "string", description: "Defaults to the project's configured Drive folder, then root." },
        project_path: { type: "string" }
      },
      required: ["name", "mime_type"]
    }
  },
  {
    name: "drive.create_google_doc",
    description: "Fast path. Create a native Google Doc with provided text or HTML content in the project-bound Drive account. Use this instead of switching to generic Drive/Docs workflows when the project account is known.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        content: { type: "string", description: "UTF-8 document body. Plain text by default; pass text/html for formatted content." },
        content_mime_type: { type: "string", description: "Defaults to text/plain; use text/html for formatted Google Docs." },
        parent_id: { type: "string", description: "Defaults to the project's configured Drive folder, then root." },
        project_path: { type: "string" }
      },
      required: ["name", "content"]
    }
  },
  {
    name: "drive.update_metadata",
    description: "Fast path. Rename or move a Google Drive file/folder directly for the project-bound account.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string" },
        name: { type: "string" },
        add_parent_id: { type: "string" },
        remove_parent_id: { type: "string" },
        project_path: { type: "string" }
      },
      required: ["file_id"]
    }
  }
];

async function ensureHome() {
  await mkdir(TOKEN_DIR, { recursive: true });
}

function projectKey(projectPath = DEFAULT_PROJECT) {
  return path.resolve(projectPath);
}

function projectAccountConfigPath(projectPath = DEFAULT_PROJECT) {
  return path.join(projectKey(projectPath), ".codex", "google-account.json");
}

function legacyProjectAccountPath(projectPath = DEFAULT_PROJECT) {
  return path.join(projectKey(projectPath), ".codex", "gmail-account.md");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function tokenPath(email) {
  return path.join(TOKEN_DIR, `${normalizeEmail(email).replace(/[^a-z0-9_.-]/g, "_")}.json`);
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRegistryLock(fn) {
  await ensureHome();
  const started = Date.now();
  while (true) {
    try {
      await mkdir(REGISTRY_LOCK);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - started > 5000) throw new Error("Timed out waiting for project registry lock.");
      await sleep(50);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(REGISTRY_LOCK, { recursive: true, force: true });
  }
}

async function readRegistry() {
  return await readJson(REGISTRY_PATH, { projects: {} });
}

async function getBoundAccount(projectPath) {
  const registry = await readRegistry();
  const registryAccount = registry.projects[projectKey(projectPath)];
  if (registryAccount) return registryAccount;

  const projectConfig = await readJson(projectAccountConfigPath(projectPath), null);
  if (projectConfig?.account_email) return normalizeEmail(projectConfig.account_email);

  try {
    const legacyText = await readFile(legacyProjectAccountPath(projectPath), "utf8");
    const match = legacyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (match) return normalizeEmail(match[0]);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return null;
}

async function getProjectConfig(projectPath) {
  return await readJson(projectAccountConfigPath(projectPath), {});
}

async function updateProjectConfig(projectPath, patch) {
  const current = await getProjectConfig(projectPath);
  const next = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString()
  };
  await writeJson(projectAccountConfigPath(projectPath), next);
  return next;
}

async function requireBoundAccount(projectPath) {
  const account = await getBoundAccount(projectPath);
  if (!account) {
    throw new Error(`No Google account is bound to project ${projectKey(projectPath)}. Call google_accounts.bind_project first.`);
  }
  return account;
}

async function readOAuthClient() {
  const raw = await readJson(OAUTH_CLIENT_PATH, null);
  if (!raw) {
    throw new Error(`Missing OAuth client file: ${OAUTH_CLIENT_PATH}. Create a Google OAuth desktop client JSON there or set GOOGLE_OAUTH_CLIENT_FILE.`);
  }
  const client = raw.installed || raw.web || raw;
  if (!client.client_id || !client.client_secret) {
    throw new Error(`OAuth client file must contain client_id and client_secret: ${OAUTH_CLIENT_PATH}`);
  }
  return client;
}

async function readToken(email) {
  return await readJson(tokenPath(email), null);
}

async function saveToken(email, token) {
  await writeJson(tokenPath(email), { ...token, account_email: normalizeEmail(email), saved_at: new Date().toISOString() });
}

async function tokenStatus(email) {
  const token = await readToken(email);
  if (!token) {
    return {
      status: "missing",
      connected: false,
      needs_reconnect: true,
      token_path: tokenPath(email),
      next_action: "Run google_accounts.reconnect to authorize this account."
    };
  }
  const grantedScopes = new Set(String(token.scope || "").split(/\s+/).filter(Boolean));
  const missingScopes = token.scope
    ? SCOPES.filter((scope) => scope.startsWith("https://www.googleapis.com/auth/") && !grantedScopes.has(scope))
    : [];
  if (!token.refresh_token) {
    return {
      status: "missing_refresh_token",
      connected: false,
      needs_reconnect: true,
      token_path: tokenPath(email),
      saved_at: token.saved_at || null,
      missing_scopes: missingScopes,
      next_action: "Run google_accounts.reconnect to get a new refresh token."
    };
  }
  if (missingScopes.length) {
    return {
      status: "missing_scopes",
      connected: true,
      needs_reconnect: true,
      token_path: tokenPath(email),
      saved_at: token.saved_at || null,
      expires_at: token.expires_at ? new Date(token.expires_at).toISOString() : null,
      missing_scopes: missingScopes,
      next_action: "Run google_accounts.reconnect to authorize the added Google API scopes."
    };
  }
  if (!token.access_token || !token.expires_at || token.expires_at < Date.now() + 60_000) {
    return {
      status: "needs_refresh",
      connected: true,
      needs_reconnect: false,
      token_path: tokenPath(email),
      saved_at: token.saved_at || null,
      expires_at: token.expires_at ? new Date(token.expires_at).toISOString() : null,
      missing_scopes: missingScopes,
      next_action: "The server will refresh this token automatically on the next Gmail call."
    };
  }
  return {
    status: "available",
    connected: true,
    needs_reconnect: false,
    token_path: tokenPath(email),
    saved_at: token.saved_at || null,
    expires_at: new Date(token.expires_at).toISOString(),
    missing_scopes: missingScopes
  };
}

function isRevokedTokenError(error) {
  const message = String(error?.message || "");
  return message.includes("invalid_grant")
    || message.includes("invalid_token")
    || message.includes('"error":"invalid_grant"')
    || message.includes('"error": "invalid_grant"')
    || message.includes("401");
}

function isInsufficientScopeError(error) {
  const message = String(error?.message || "");
  return message.includes("insufficient authentication scopes")
    || message.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")
    || message.includes("insufficientPermissions")
    || message.includes("insufficient_scope");
}

function reconnectError(email, cause) {
  const error = new Error(`Google authorization for ${email} is missing, expired, revoked, or lacks required scopes. Run google_accounts.reconnect for this project/account and authorize the returned URL. Cause: ${cause.message}`);
  error.code = "GOOGLE_ACCOUNT_RECONNECT_REQUIRED";
  error.account_email = email;
  error.next_tool = "google_accounts.reconnect";
  return error;
}

async function refreshToken(email, token) {
  if (!token?.refresh_token) throw reconnectError(email, new Error("No refresh_token is stored locally."));
  const client = await readOAuthClient();
  const body = new URLSearchParams({
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token"
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await res.json();
  if (!res.ok) {
    const cause = new Error(`Token refresh failed: ${JSON.stringify(data)}`);
    if (isRevokedTokenError(cause)) throw reconnectError(email, cause);
    throw cause;
  }
  const next = {
    ...token,
    ...data,
    refresh_token: data.refresh_token || token.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000
  };
  await saveToken(email, next);
  return next;
}

async function accessTokenFor(email) {
  let token = await readToken(email);
  if (!token) throw reconnectError(email, new Error("No local token exists."));
  if (!token.access_token || !token.expires_at || token.expires_at < Date.now() + 60_000) {
    token = await refreshToken(email, token);
  }
  return token.access_token;
}

async function googleFetch(email, url, options = {}) {
  const accessToken = await accessTokenFor(email);
  const headers = {
    authorization: `Bearer ${accessToken}`,
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const cause = new Error(`Google API error ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    if (isRevokedTokenError(cause)) throw reconnectError(email, cause);
    if (isInsufficientScopeError(cause)) throw reconnectError(email, cause);
    throw cause;
  }
  return data;
}

function calendarId(value = "primary") {
  return encodeURIComponent(String(value || "primary"));
}

function calendarDateValue(value, timeZone) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { date: text };
  return {
    dateTime: text,
    ...(timeZone ? { timeZone } : {})
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function simplifyCalendar(calendar) {
  return {
    id: calendar.id,
    summary: calendar.summary || "",
    description: calendar.description || "",
    time_zone: calendar.timeZone || "",
    access_role: calendar.accessRole || "",
    primary: Boolean(calendar.primary),
    selected: Boolean(calendar.selected),
    hidden: Boolean(calendar.hidden),
    background_color: calendar.backgroundColor || "",
    foreground_color: calendar.foregroundColor || ""
  };
}

function simplifyEvent(event) {
  return {
    id: event.id,
    calendar_id: event.organizer?.email || "",
    status: event.status || "",
    html_link: event.htmlLink || "",
    summary: event.summary || "",
    description: event.description || "",
    location: event.location || "",
    start: event.start || null,
    end: event.end || null,
    creator: event.creator || null,
    organizer: event.organizer || null,
    attendees: event.attendees || [],
    hangout_link: event.hangoutLink || "",
    conference_data: event.conferenceData || null,
    updated: event.updated || "",
    recurring_event_id: event.recurringEventId || ""
  };
}

function eventPayload(args, base = {}) {
  const payload = { ...base };
  for (const key of ["summary", "description", "location"]) {
    if (args[key] !== undefined) payload[key] = args[key];
  }
  if (args.start !== undefined) payload.start = calendarDateValue(args.start, args.time_zone);
  if (args.end !== undefined) payload.end = calendarDateValue(args.end, args.time_zone);
  if (args.attendees !== undefined) {
    payload.attendees = (args.attendees || []).map((email) => ({ email: normalizeEmail(email) })).filter((item) => item.email);
  }
  return payload;
}

function driveFileFields() {
  return "id,name,mimeType,description,parents,webViewLink,webContentLink,createdTime,modifiedTime,owners(emailAddress,displayName),lastModifyingUser(emailAddress,displayName),size,trashed,starred,shared";
}

function simplifyDriveFile(file) {
  return {
    id: file.id,
    name: file.name || "",
    mime_type: file.mimeType || "",
    description: file.description || "",
    parents: file.parents || [],
    web_view_link: file.webViewLink || "",
    web_content_link: file.webContentLink || "",
    created_time: file.createdTime || "",
    modified_time: file.modifiedTime || "",
    owners: file.owners || [],
    last_modifying_user: file.lastModifyingUser || null,
    size: file.size || "",
    trashed: Boolean(file.trashed),
    starred: Boolean(file.starred),
    shared: Boolean(file.shared)
  };
}

function escapeDriveQuery(value = "") {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function driveSearchQuery(args = {}) {
  if (args.query) {
    if (args.include_trashed) return args.query;
    return `(${args.query}) and trashed = false`;
  }
  if (args.text) {
    const text = escapeDriveQuery(args.text);
    const query = `(name contains '${text}' or fullText contains '${text}')`;
    return args.include_trashed ? query : `${query} and trashed = false`;
  }
  return args.include_trashed ? "" : "trashed = false";
}

async function projectDriveFolderId(projectPath, explicitParentId) {
  if (explicitParentId) return explicitParentId;
  const config = await getProjectConfig(projectPath);
  return config.drive_default_folder_id || "root";
}

function multipartUploadBody({ metadata, content, contentMimeType = "text/plain" }) {
  const boundary = `codex-${randomBytes(12).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`, "utf8"),
    Buffer.from(`--${boundary}\r\nContent-Type: ${contentMimeType}; charset=UTF-8\r\n\r\n`, "utf8"),
    Buffer.from(String(content), "utf8"),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
  ]);
  return { body, boundary };
}

async function createDriveFile(account, args) {
  const parentId = await projectDriveFolderId(args.project_path, args.parent_id);
  const metadata = {
    name: args.name,
    mimeType: args.mime_type,
    parents: [parentId]
  };
  const fields = driveFileFields();
  if (args.content !== undefined) {
    const upload = multipartUploadBody({
      metadata,
      content: args.content,
      contentMimeType: args.content_mime_type || "text/plain"
    });
    const qs = new URLSearchParams({
      uploadType: "multipart",
      fields,
      supportsAllDrives: "true"
    });
    const file = await googleFetch(account, `https://www.googleapis.com/upload/drive/v3/files?${qs}`, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${upload.boundary}` },
      body: upload.body
    });
    return simplifyDriveFile(file);
  }

  const qs = new URLSearchParams({
    fields,
    supportsAllDrives: "true"
  });
  const file = await googleFetch(account, `https://www.googleapis.com/drive/v3/files?${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(metadata)
  });
  return simplifyDriveFile(file);
}

function defaultExportMimeType(mimeType = "") {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
      return "text/markdown";
    case "application/vnd.google-apps.spreadsheet":
      return "text/csv";
    case "application/vnd.google-apps.presentation":
      return "text/plain";
    case "application/vnd.google-apps.drawing":
      return "image/png";
    default:
      return "";
  }
}

function parseDriveResponse(data, mimeType) {
  if (Buffer.isBuffer(data)) {
    const isText = mimeType.startsWith("text/")
      || mimeType.includes("json")
      || mimeType.includes("csv")
      || mimeType.includes("xml")
      || mimeType.includes("markdown");
    return isText ? data.toString("utf8") : data.toString("base64");
  }
  return data;
}

async function googleFetchRaw(email, url, options = {}) {
  const accessToken = await accessTokenFor(email);
  const headers = {
    authorization: `Bearer ${accessToken}`,
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!res.ok) {
    let data;
    try { data = JSON.parse(buffer.toString("utf8")); } catch { data = buffer.toString("utf8"); }
    const cause = new Error(`Google API error ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    if (isRevokedTokenError(cause)) throw reconnectError(email, cause);
    if (isInsufficientScopeError(cause)) throw reconnectError(email, cause);
    throw cause;
  }
  return buffer;
}

function decodeBase64Url(value = "") {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function headersToObject(headers = []) {
  const out = {};
  for (const h of headers) out[h.name.toLowerCase()] = h.value;
  return out;
}

function extractBody(payload) {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  const parts = payload.parts || [];
  const plain = parts.find((p) => p.mimeType === "text/plain");
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);
  const html = parts.find((p) => p.mimeType === "text/html");
  if (html?.body?.data) return decodeBase64Url(html.body.data);
  for (const part of parts) {
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return "";
}

function simplifyMessage(message) {
  const h = headersToObject(message.payload?.headers);
  return {
    id: message.id,
    thread_id: message.threadId,
    labels: message.labelIds || [],
    from: h.from || "",
    to: h.to || "",
    cc: h.cc || "",
    subject: h.subject || "",
    date: h.date || "",
    snippet: message.snippet || "",
    body: extractBody(message.payload)
  };
}

function encodeHeaderValue(value = "") {
  const text = String(value);
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

async function getReplyContext(account, replyMessageId) {
  if (!replyMessageId) return {};
  const msg = await googleFetch(account, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${replyMessageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`);
  const headers = headersToObject(msg.payload?.headers);
  const messageId = headers["message-id"];
  const references = headers.references
    ? `${headers.references} ${messageId || ""}`.trim()
    : messageId;
  return {
    threadId: msg.threadId,
    inReplyTo: messageId,
    references
  };
}

function uniqueAddresses(value = "") {
  const seen = new Set();
  const addresses = [];
  for (const item of String(value || "").split(",")) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = normalizeEmail((trimmed.match(/<([^>]+)>/)?.[1] || trimmed).replace(/^['"]|['"]$/g, ""));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    addresses.push(trimmed);
  }
  return addresses;
}

function addressKey(value = "") {
  return normalizeEmail((String(value).match(/<([^>]+)>/)?.[1] || value).replace(/^['"]|['"]$/g, ""));
}

function mergeCc({ exclude = [], values = [] } = {}) {
  const excluded = new Set(exclude.map(addressKey).filter(Boolean));
  return uniqueAddresses(values.filter(Boolean).join(", "))
    .filter((address) => !excluded.has(addressKey(address)))
    .join(", ");
}

function replySubject(subject = "") {
  const text = String(subject || "").trim();
  if (!text) return "";
  return /^re:/i.test(text) ? text : `Re: ${text}`;
}

async function getLatestThreadReply(account, threadId) {
  const thread = await googleFetch(account, `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`);
  const messages = thread.messages || [];
  if (!messages.length) throw new Error(`Thread ${threadId} has no messages.`);
  const accountKey = addressKey(account);
  const latest = [...messages].reverse().find((message) => {
    const headers = headersToObject(message.payload?.headers);
    return addressKey(headers.from || "") !== accountKey;
  }) || messages[messages.length - 1];
  const headers = headersToObject(latest.payload?.headers);
  const messageId = headers["message-id"];
  const references = headers.references
    ? `${headers.references} ${messageId || ""}`.trim()
    : messageId;
  return {
    threadId: thread.id,
    latestMessageId: latest.id,
    to: headers.from || "",
    cc: headers.cc || "",
    subject: replySubject(headers.subject || ""),
    replyContext: {
      threadId: thread.id,
      inReplyTo: messageId,
      references
    }
  };
}

function makeRawEmail({ to, subject, body, cc, bcc, replyContext = {} }) {
  const lines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${encodeHeaderValue(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    replyContext.inReplyTo ? `In-Reply-To: ${replyContext.inReplyTo}` : null,
    replyContext.references ? `References: ${replyContext.references}` : null,
    "",
    body
  ].filter((line) => line !== null);
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

async function listenOnAvailablePort(server, preferredPort) {
  const attempts = [preferredPort, 0];
  let lastError;
  for (const port of attempts) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      });
      const address = server.address();
      return typeof address === "object" && address ? address.port : port;
    } catch (error) {
      lastError = error;
      if (error.code !== "EADDRINUSE" || port === 0) throw error;
    }
  }
  throw lastError;
}

async function startOAuth({ account_email, project_path, reconnect = false }) {
  await ensureHome();
  const account = normalizeEmail(account_email || await getBoundAccount(project_path));
  if (!account) throw new Error("account_email is required when the project is not bound yet.");
  const client = await readOAuthClient();
  const preferredPort = Number(process.env.PROJECT_GOOGLE_ACCOUNTS_OAUTH_PORT || 53682);
  let redirectUri;
  const state = randomBytes(16).toString("hex");

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      if (url.searchParams.get("state") !== state) throw new Error("OAuth state mismatch.");
      const code = url.searchParams.get("code");
      if (!code) throw new Error(`Missing code: ${url.searchParams.get("error") || "unknown error"}`);
      const tokenBody = new URLSearchParams({
        client_id: client.client_id,
        client_secret: client.client_secret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      });
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: tokenBody
      });
      const token = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(`Token exchange failed: ${JSON.stringify(token)}`);
      await saveToken(account, {
        ...token,
        refresh_token: token.refresh_token,
        expires_at: Date.now() + (token.expires_in || 3600) * 1000
      });
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Connected ${account}. You can close this tab and return to Codex.`);
      setTimeout(() => server.close(), 500);
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`OAuth failed: ${error.message}`);
      setTimeout(() => server.close(), 500);
    }
  });
  const port = await listenOnAvailablePort(server, preferredPort);
  redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  server.setTimeout(10 * 60 * 1000, () => server.close());
  const closeTimer = setTimeout(() => server.close(), 10 * 60 * 1000);
  closeTimer.unref?.();

  const authUrl = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    login_hint: account,
    state
  });

  return {
    account_email: account,
    authorization_url: `https://accounts.google.com/o/oauth2/v2/auth?${authUrl.toString()}`,
    redirect_uri: redirectUri,
    reconnect,
    token_path: tokenPath(account),
    note: "Open authorization_url in a browser, approve access, and wait for the localhost success page."
  };
}

async function callTool(name, args = {}) {
  await ensureHome();
  switch (name) {
    case "google_accounts.project_status": {
      const key = projectKey(args.project_path);
      const account = await getBoundAccount(args.project_path);
      const projectConfig = await getProjectConfig(args.project_path);
      return {
        project_path: key,
        account_email: account,
        token: account ? await tokenStatus(account) : null,
        connected: account ? existsSync(tokenPath(account)) : false,
        data_home: DATA_HOME,
        project_hint_path: projectAccountConfigPath(args.project_path),
        drive_default_folder: {
          id: projectConfig.drive_default_folder_id || null,
          name: projectConfig.drive_default_folder_name || null,
          web_view_link: projectConfig.drive_default_folder_web_view_link || null
        }
      };
    }
    case "google_accounts.bind_project": {
      const account = normalizeEmail(args.account_email);
      if (!account.includes("@")) throw new Error("account_email must be an email address.");
      return await withRegistryLock(async () => {
        const registry = await readRegistry();
        const key = projectKey(args.project_path);
        registry.projects[key] = account;
        await writeJson(REGISTRY_PATH, registry);
        await updateProjectConfig(args.project_path, {
          account_email: account,
          token_storage: DATA_HOME
        });
        return { project_path: key, account_email: account, connected: existsSync(tokenPath(account)) };
      });
    }
    case "google_accounts.start_oauth":
      return await startOAuth(args);
    case "google_accounts.reconnect":
      return await startOAuth({ ...args, reconnect: true });
    case "google_accounts.disconnect_local": {
      const account = normalizeEmail(args.account_email || await requireBoundAccount(args.project_path));
      await rm(tokenPath(account), { force: true });
      return {
        account_email: account,
        disconnected_local_token: true,
        binding_kept: true,
        project_path: projectKey(args.project_path),
        next_action: "Run google_accounts.reconnect if you want to authorize this account again."
      };
    }
    case "gmail.profile": {
      const account = await requireBoundAccount(args.project_path);
      return await googleFetch(account, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
    }
    case "gmail.search": {
      const account = await requireBoundAccount(args.project_path);
      const qs = new URLSearchParams({ q: args.query, maxResults: String(args.max_results || 10) });
      const list = await googleFetch(account, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${qs}`);
      const messages = [];
      for (const item of list.messages || []) {
        const msg = await googleFetch(account, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`);
        const h = headersToObject(msg.payload?.headers);
        messages.push({ id: msg.id, thread_id: msg.threadId, from: h.from || "", to: h.to || "", cc: h.cc || "", subject: h.subject || "", date: h.date || "", snippet: msg.snippet || "", labels: msg.labelIds || [] });
      }
      return { result_count: messages.length, messages, next_page_token: list.nextPageToken || null };
    }
    case "gmail.read_thread": {
      const account = await requireBoundAccount(args.project_path);
      const thread = await googleFetch(account, `https://gmail.googleapis.com/gmail/v1/users/me/threads/${args.thread_id}?format=full`);
      return { id: thread.id, history_id: thread.historyId, messages: (thread.messages || []).map(simplifyMessage) };
    }
    case "gmail.create_draft": {
      const account = await requireBoundAccount(args.project_path);
      const replyContext = await getReplyContext(account, args.reply_message_id);
      const raw = makeRawEmail({ ...args, replyContext });
      const message = replyContext.threadId ? { raw, threadId: replyContext.threadId } : { raw };
      return await googleFetch(account, "https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message })
      });
    }
    case "gmail.send": {
      const account = await requireBoundAccount(args.project_path);
      const replyContext = await getReplyContext(account, args.reply_message_id);
      const raw = makeRawEmail({ ...args, replyContext });
      const message = replyContext.threadId ? { raw, threadId: replyContext.threadId } : { raw };
      return await googleFetch(account, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message)
      });
    }
    case "gmail.reply_thread_latest": {
      const account = await requireBoundAccount(args.project_path);
      const latest = await getLatestThreadReply(account, args.thread_id);
      const to = args.to || latest.to;
      const raw = makeRawEmail({
        to,
        subject: args.subject || latest.subject,
        body: args.body,
        cc: args.cc !== undefined ? args.cc : mergeCc({ values: [latest.cc], exclude: [account, to] }),
        bcc: args.bcc,
        replyContext: latest.replyContext
      });
      const sent = await googleFetch(account, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw, threadId: latest.threadId })
      });
      return {
        ...sent,
        replied_to_message_id: latest.latestMessageId,
        expected_thread_id: latest.threadId,
        thread_ok: sent.threadId === latest.threadId
      };
    }
    case "calendar.list_calendars": {
      const account = await requireBoundAccount(args.project_path);
      const qs = new URLSearchParams(compactObject({
        minAccessRole: args.min_access_role,
        showHidden: args.show_hidden === undefined ? undefined : String(Boolean(args.show_hidden))
      }));
      const suffix = qs.toString() ? `?${qs}` : "";
      const list = await googleFetch(account, `https://www.googleapis.com/calendar/v3/users/me/calendarList${suffix}`);
      return {
        result_count: (list.items || []).length,
        calendars: (list.items || []).map(simplifyCalendar),
        next_page_token: list.nextPageToken || null
      };
    }
    case "calendar.list_events": {
      const account = await requireBoundAccount(args.project_path);
      const qs = new URLSearchParams(compactObject({
        timeMin: args.time_min || new Date().toISOString(),
        timeMax: args.time_max,
        q: args.query,
        maxResults: String(args.max_results || 10),
        singleEvents: args.single_events === undefined ? "true" : String(Boolean(args.single_events)),
        orderBy: args.order_by || "startTime",
        showDeleted: args.show_deleted === undefined ? undefined : String(Boolean(args.show_deleted))
      }));
      const list = await googleFetch(account, `https://www.googleapis.com/calendar/v3/calendars/${calendarId(args.calendar_id)}/events?${qs}`);
      return {
        calendar_id: args.calendar_id || "primary",
        result_count: (list.items || []).length,
        events: (list.items || []).map(simplifyEvent),
        next_page_token: list.nextPageToken || null
      };
    }
    case "calendar.read_event": {
      const account = await requireBoundAccount(args.project_path);
      const event = await googleFetch(account, `https://www.googleapis.com/calendar/v3/calendars/${calendarId(args.calendar_id)}/events/${encodeURIComponent(args.event_id)}`);
      return simplifyEvent(event);
    }
    case "calendar.create_event": {
      const account = await requireBoundAccount(args.project_path);
      const qs = new URLSearchParams(compactObject({
        sendUpdates: args.send_updates
      }));
      const suffix = qs.toString() ? `?${qs}` : "";
      const event = await googleFetch(account, `https://www.googleapis.com/calendar/v3/calendars/${calendarId(args.calendar_id)}/events${suffix}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eventPayload(args))
      });
      return simplifyEvent(event);
    }
    case "calendar.update_event": {
      const account = await requireBoundAccount(args.project_path);
      const current = await googleFetch(account, `https://www.googleapis.com/calendar/v3/calendars/${calendarId(args.calendar_id)}/events/${encodeURIComponent(args.event_id)}`);
      const qs = new URLSearchParams(compactObject({
        sendUpdates: args.send_updates
      }));
      const suffix = qs.toString() ? `?${qs}` : "";
      const event = await googleFetch(account, `https://www.googleapis.com/calendar/v3/calendars/${calendarId(args.calendar_id)}/events/${encodeURIComponent(args.event_id)}${suffix}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eventPayload(args, current))
      });
      return simplifyEvent(event);
    }
    case "calendar.delete_event": {
      const account = await requireBoundAccount(args.project_path);
      const qs = new URLSearchParams(compactObject({
        sendUpdates: args.send_updates
      }));
      const suffix = qs.toString() ? `?${qs}` : "";
      await googleFetch(account, `https://www.googleapis.com/calendar/v3/calendars/${calendarId(args.calendar_id)}/events/${encodeURIComponent(args.event_id)}${suffix}`, {
        method: "DELETE"
      });
      return {
        deleted: true,
        calendar_id: args.calendar_id || "primary",
        event_id: args.event_id
      };
    }
    case "calendar.freebusy": {
      const account = await requireBoundAccount(args.project_path);
      const body = {
        timeMin: args.time_min,
        timeMax: args.time_max,
        ...(args.time_zone ? { timeZone: args.time_zone } : {}),
        items: (args.calendar_ids?.length ? args.calendar_ids : ["primary"]).map((id) => ({ id }))
      };
      return await googleFetch(account, "https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
    }
    case "drive.search": {
      const account = await requireBoundAccount(args.project_path);
      const qs = new URLSearchParams(compactObject({
        q: driveSearchQuery(args),
        pageSize: String(args.max_results || 10),
        fields: `nextPageToken,files(${driveFileFields()})`,
        orderBy: "modifiedTime desc",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true"
      }));
      const list = await googleFetch(account, `https://www.googleapis.com/drive/v3/files?${qs}`);
      return {
        result_count: (list.files || []).length,
        files: (list.files || []).map(simplifyDriveFile),
        next_page_token: list.nextPageToken || null
      };
    }
    case "drive.list_folder": {
      const account = await requireBoundAccount(args.project_path);
      const folderId = await projectDriveFolderId(args.project_path, args.folder_id);
      const qs = new URLSearchParams(compactObject({
        q: `'${escapeDriveQuery(folderId)}' in parents and trashed = false`,
        pageSize: String(args.max_results || 50),
        fields: `nextPageToken,files(${driveFileFields()})`,
        orderBy: "folder,name",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true"
      }));
      const list = await googleFetch(account, `https://www.googleapis.com/drive/v3/files?${qs}`);
      return {
        folder_id: folderId,
        result_count: (list.files || []).length,
        files: (list.files || []).map(simplifyDriveFile),
        next_page_token: list.nextPageToken || null
      };
    }
    case "drive.ensure_project_folder": {
      const account = await requireBoundAccount(args.project_path);
      const folderName = args.name || path.basename(projectKey(args.project_path)).trim() || "Codex Project";
      const parentId = args.parent_id || "root";
      const query = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeDriveQuery(folderName)}' and '${escapeDriveQuery(parentId)}' in parents and trashed = false`;
      const searchQs = new URLSearchParams(compactObject({
        q: query,
        pageSize: "1",
        fields: `files(${driveFileFields()})`,
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true"
      }));
      const list = await googleFetch(account, `https://www.googleapis.com/drive/v3/files?${searchQs}`);
      let folder = (list.files || [])[0];
      let created = false;
      if (!folder) {
        const createQs = new URLSearchParams({
          fields: driveFileFields(),
          supportsAllDrives: "true"
        });
        folder = await googleFetch(account, `https://www.googleapis.com/drive/v3/files?${createQs}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentId]
          })
        });
        created = true;
      }
      await updateProjectConfig(args.project_path, {
        account_email: account,
        token_storage: DATA_HOME,
        drive_default_folder_id: folder.id,
        drive_default_folder_name: folder.name || folderName,
        drive_default_folder_web_view_link: folder.webViewLink || ""
      });
      return {
        created,
        project_path: projectKey(args.project_path),
        account_email: account,
        folder: simplifyDriveFile(folder)
      };
    }
    case "drive.get_metadata": {
      const account = await requireBoundAccount(args.project_path);
      const qs = new URLSearchParams({
        fields: driveFileFields(),
        supportsAllDrives: "true"
      });
      const file = await googleFetch(account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.file_id)}?${qs}`);
      return simplifyDriveFile(file);
    }
    case "drive.export_file": {
      const account = await requireBoundAccount(args.project_path);
      const metadataQs = new URLSearchParams({
        fields: driveFileFields(),
        supportsAllDrives: "true"
      });
      const file = await googleFetch(account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.file_id)}?${metadataQs}`);
      const exportMimeType = args.mime_type || defaultExportMimeType(file.mimeType);
      if (file.mimeType?.startsWith("application/vnd.google-apps.")) {
        if (!exportMimeType) throw new Error(`mime_type is required to export ${file.mimeType}`);
        const qs = new URLSearchParams({ mimeType: exportMimeType });
        const buffer = await googleFetchRaw(account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.file_id)}/export?${qs}`);
        return {
          file: simplifyDriveFile(file),
          mime_type: exportMimeType,
          encoding: exportMimeType.startsWith("text/") || exportMimeType.includes("json") || exportMimeType.includes("csv") || exportMimeType.includes("markdown") ? "utf8" : "base64",
          content: parseDriveResponse(buffer, exportMimeType)
        };
      }
      const buffer = await googleFetchRaw(account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.file_id)}?alt=media&supportsAllDrives=true`);
      const mimeType = args.mime_type || file.mimeType || "application/octet-stream";
      return {
        file: simplifyDriveFile(file),
        mime_type: mimeType,
        encoding: mimeType.startsWith("text/") || mimeType.includes("json") || mimeType.includes("csv") || mimeType.includes("markdown") ? "utf8" : "base64",
        content: parseDriveResponse(buffer, mimeType)
      };
    }
    case "drive.create_folder": {
      const account = await requireBoundAccount(args.project_path);
      const parentId = await projectDriveFolderId(args.project_path, args.parent_id);
      const body = {
        name: args.name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId]
      };
      const qs = new URLSearchParams({
        fields: driveFileFields(),
        supportsAllDrives: "true"
      });
      const file = await googleFetch(account, `https://www.googleapis.com/drive/v3/files?${qs}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      return simplifyDriveFile(file);
    }
    case "drive.create_file": {
      const account = await requireBoundAccount(args.project_path);
      return await createDriveFile(account, args);
    }
    case "drive.create_google_doc": {
      const account = await requireBoundAccount(args.project_path);
      return await createDriveFile(account, {
        ...args,
        mime_type: "application/vnd.google-apps.document",
        content_mime_type: args.content_mime_type || "text/plain"
      });
    }
    case "drive.update_metadata": {
      const account = await requireBoundAccount(args.project_path);
      const body = compactObject({ name: args.name });
      const qs = new URLSearchParams(compactObject({
        fields: driveFileFields(),
        addParents: args.add_parent_id,
        removeParents: args.remove_parent_id,
        supportsAllDrives: "true"
      }));
      const file = await googleFetch(account, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.file_id)}?${qs}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      return simplifyDriveFile(file);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function writeRpc(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRpc(request) {
  if (!request.method) return;
  try {
    if (request.method === "initialize") {
      writeRpc({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "project-google-accounts", version: "0.1.2" } } });
      return;
    }
    if (request.method === "tools/list") {
      writeRpc({ jsonrpc: "2.0", id: request.id, result: { tools: TOOLS } });
      return;
    }
    if (request.method === "tools/call") {
      const result = await callTool(request.params?.name, request.params?.arguments || {});
      writeRpc({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
      return;
    }
    if (request.id !== undefined) {
      writeRpc({ jsonrpc: "2.0", id: request.id, result: {} });
    }
  } catch (error) {
    writeRpc({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error.message } });
  }
}

let buffer = "";
let rpcQueue = Promise.resolve();
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    try {
      const request = JSON.parse(line);
      rpcQueue = rpcQueue.then(() => handleRpc(request));
    } catch (error) {
      writeRpc({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } });
    }
  }
});
