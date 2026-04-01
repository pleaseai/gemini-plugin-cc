/**
 * @typedef {((update: string | { message: string, phase: string | null, threadId?: string | null, turnId?: string | null, stderrMessage?: string | null, logTitle?: string | null, logBody?: string | null }) => void)} ProgressReporter
 */
import { readJsonFile } from "./fs.mjs";
import { runHeadlessGemini, buildProgressAdapter } from "./headless.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";

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

export function getGeminiLoginStatus(cwd) {
  const availability = getGeminiAvailability(cwd);
  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      detail: availability.detail
    };
  }

  const result = runCommand("gemini", ["auth", "status"], { cwd });
  if (result.error) {
    return {
      available: true,
      loggedIn: false,
      detail: result.error.message
    };
  }

  if (result.status === 0) {
    return {
      available: true,
      loggedIn: true,
      detail: result.stdout.trim() || "authenticated"
    };
  }

  return {
    available: true,
    loggedIn: false,
    detail: result.stderr.trim() || result.stdout.trim() || "not authenticated"
  };
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
