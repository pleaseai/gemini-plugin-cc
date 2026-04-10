/**
 * @typedef {((update: string | { message: string, phase: string | null, threadId?: string | null, turnId?: string | null, stderrMessage?: string | null, logTitle?: string | null, logBody?: string | null }) => void)} ProgressReporter
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonFile } from "./fs.mjs";
import { runHeadlessGemini, buildProgressAdapter } from "./headless.mjs";
import { binaryAvailable } from "./process.mjs";

const GEMINI_OAUTH_CREDS_PATH = path.join(os.homedir(), ".gemini", "oauth_creds.json");

const TASK_THREAD_PREFIX = "Gemini Companion Task";
const DEFAULT_CONTINUE_PROMPT =
  "Continue from the current thread state. Pick the next highest-value step and follow through until the task is resolved.";

function cleanGeminiStderr(stderr) {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith("WARNING: proceeding, even though we could not update PATH:"))
    .join("\n");
}

function shorten(text, limit = 72) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function buildTaskThreadName(prompt) {
  const excerpt = shorten(prompt, 56);
  return excerpt ? `${TASK_THREAD_PREFIX}: ${excerpt}` : TASK_THREAD_PREFIX;
}

function extractTouchedFilesFromToolEvents(toolCalls) {
  const paths = new Set();
  for (const event of toolCalls) {
    if (event.type !== "tool_use") {
      continue;
    }
    const params = event.parameters ?? {};
    if (params.file_path) {
      paths.add(params.file_path);
    }
    if (params.path) {
      paths.add(params.path);
    }
  }
  return [...paths];
}

function extractFileChangesFromToolEvents(toolCalls) {
  const changes = [];
  for (const event of toolCalls) {
    if (event.type !== "tool_use") {
      continue;
    }
    const name = (event.tool_name ?? "").toLowerCase();
    if (name.includes("edit") || name.includes("write") || name.includes("patch") || name.includes("create")) {
      changes.push({
        type: "fileChange",
        status: "completed",
        changes: [{ path: event.parameters?.file_path ?? event.parameters?.path ?? null }].filter((c) => c.path)
      });
    }
  }
  return changes;
}

function extractCommandsFromToolEvents(toolCalls) {
  const commands = [];
  for (const event of toolCalls) {
    if (event.type !== "tool_use") {
      continue;
    }
    const name = (event.tool_name ?? "").toLowerCase();
    if (name.includes("shell") || name.includes("command") || name.includes("run") || name.includes("exec")) {
      commands.push({
        type: "commandExecution",
        status: "completed",
        command: event.parameters?.command ?? event.parameters?.input ?? "",
        exitCode: 0
      });
    }
  }
  return commands;
}

export function getGeminiAvailability(cwd) {
  return binaryAvailable("gemini", ["--version"], { cwd });
}

export function getSessionRuntimeStatus() {
  return {
    mode: "direct",
    label: "direct execution",
    detail: "Each Gemini invocation runs as an independent headless process.",
    endpoint: null
  };
}

/**
 * Detect Gemini CLI authentication without running the CLI.
 *
 * Gemini CLI has no `auth status` subcommand — any unknown subcommand is
 * interpreted as a prompt, which triggers a live model call (and slow quota
 * retries). Instead we inspect environment variables and the OAuth credential
 * cache directly.
 *
 * Auth methods (per https://geminicli.com/docs/get-started/authentication/):
 *   1. GEMINI_API_KEY (AI Studio)
 *   2. GOOGLE_API_KEY + GOOGLE_CLOUD_PROJECT (Vertex AI API key)
 *   3. GOOGLE_APPLICATION_CREDENTIALS + GOOGLE_CLOUD_PROJECT (Vertex SA key)
 *   4. Cached Google Sign-in (~/.gemini/oauth_creds.json)
 */
export function getGeminiLoginStatus(cwd, env = process.env) {
  const availability = getGeminiAvailability(cwd);
  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      method: null,
      detail: availability.detail
    };
  }

  if (env.GEMINI_API_KEY) {
    return { available: true, loggedIn: true, method: "gemini-api-key", detail: "GEMINI_API_KEY is set" };
  }

  if (env.GOOGLE_API_KEY && env.GOOGLE_CLOUD_PROJECT) {
    return {
      available: true,
      loggedIn: true,
      method: "vertex-api-key",
      detail: "GOOGLE_API_KEY + GOOGLE_CLOUD_PROJECT are set"
    };
  }

  if (env.GOOGLE_APPLICATION_CREDENTIALS && env.GOOGLE_CLOUD_PROJECT) {
    const credsExist = fileExistsNonEmpty(env.GOOGLE_APPLICATION_CREDENTIALS);
    if (credsExist) {
      return {
        available: true,
        loggedIn: true,
        method: "vertex-service-account",
        detail: `GOOGLE_APPLICATION_CREDENTIALS=${env.GOOGLE_APPLICATION_CREDENTIALS}`
      };
    }
  }

  if (fileExistsNonEmpty(GEMINI_OAUTH_CREDS_PATH)) {
    return {
      available: true,
      loggedIn: true,
      method: "oauth-cache",
      detail: `cached Google Sign-in at ${GEMINI_OAUTH_CREDS_PATH}`
    };
  }

  return {
    available: true,
    loggedIn: false,
    method: null,
    detail: "no cached Google Sign-in or API key detected"
  };
}

function fileExistsNonEmpty(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export async function interruptAppServerTurn(_cwd, { threadId, turnId } = {}) {
  return {
    attempted: false,
    interrupted: false,
    transport: null,
    detail: "headless mode: use process termination to cancel"
  };
}

export async function runAppServerReview(cwd, options = {}) {
  const availability = getGeminiAvailability(cwd);
  if (!availability.available) {
    throw new Error("Gemini CLI is not installed. Install it and rerun `/gemini:setup`.");
  }

  const prompt = options.prompt;
  if (!prompt) {
    throw new Error("A review prompt is required.");
  }

  const onEvent = buildProgressAdapter(options.onProgress);
  const result = await runHeadlessGemini(cwd, prompt, {
    model: options.model,
    sandbox: "read-only",
    onEvent,
    env: options.env
  });

  return {
    status: result.exitCode === 0 ? 0 : 1,
    threadId: result.sessionId,
    sourceThreadId: result.sessionId,
    turnId: null,
    reviewText: result.lastAssistantMessage,
    reasoningSummary: [],
    turn: { id: result.sessionId ?? "headless", status: result.status === "success" ? "completed" : "failed" },
    error: result.errors.length > 0 ? { message: result.errors[0].message } : null,
    stderr: cleanGeminiStderr(result.stderr)
  };
}

export async function runAppServerTurn(cwd, options = {}) {
  const availability = getGeminiAvailability(cwd);
  if (!availability.available) {
    throw new Error("Gemini CLI is not installed. Install it and rerun `/gemini:setup`.");
  }

  const prompt = options.prompt?.trim() || options.defaultPrompt || "";
  if (!prompt && !options.resumeThreadId) {
    throw new Error("A prompt is required for this Gemini CLI run.");
  }

  const onEvent = buildProgressAdapter(options.onProgress);
  const result = await runHeadlessGemini(cwd, prompt || DEFAULT_CONTINUE_PROMPT, {
    model: options.model,
    effort: options.effort,
    sandbox: options.sandbox,
    resumeSessionId: options.resumeThreadId,
    onEvent,
    env: options.env
  });

  const fileChanges = extractFileChangesFromToolEvents(result.toolCalls);

  return {
    status: result.exitCode === 0 ? 0 : 1,
    threadId: result.sessionId,
    turnId: null,
    finalMessage: result.lastAssistantMessage,
    reasoningSummary: [],
    turn: { id: result.sessionId ?? "headless", status: result.status === "success" ? "completed" : "failed" },
    error: result.errors.length > 0 ? { message: result.errors[0].message } : null,
    stderr: cleanGeminiStderr(result.stderr),
    fileChanges,
    touchedFiles: extractTouchedFilesFromToolEvents(result.toolCalls),
    commandExecutions: extractCommandsFromToolEvents(result.toolCalls)
  };
}

export async function findLatestTaskThread(_cwd) {
  return null;
}

export function buildPersistentTaskThreadName(prompt) {
  return buildTaskThreadName(prompt);
}

export function parseStructuredOutput(rawOutput, fallback = {}) {
  if (!rawOutput) {
    return {
      parsed: null,
      parseError: fallback.failureMessage ?? "Gemini CLI did not return a final structured message.",
      rawOutput: rawOutput ?? "",
      ...fallback
    };
  }

  try {
    return {
      parsed: JSON.parse(rawOutput),
      parseError: null,
      rawOutput,
      ...fallback
    };
  } catch (error) {
    return {
      parsed: null,
      parseError: error.message,
      rawOutput,
      ...fallback
    };
  }
}

export function readOutputSchema(schemaPath) {
  return readJsonFile(schemaPath);
}

export { DEFAULT_CONTINUE_PROMPT, TASK_THREAD_PREFIX };
