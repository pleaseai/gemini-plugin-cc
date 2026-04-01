import { spawn } from "node:child_process";
import process from "node:process";
import readline from "node:readline";
import { terminateProcessTree } from "./process.mjs";

/**
 * @typedef {{
 *   type: "init",
 *   timestamp: string,
 *   session_id: string,
 *   model: string
 * } | {
 *   type: "message",
 *   timestamp: string,
 *   role: string,
 *   content: string,
 *   delta?: boolean
 * } | {
 *   type: "tool_use",
 *   timestamp: string,
 *   tool_name: string,
 *   tool_id: string,
 *   parameters: Record<string, unknown>
 * } | {
 *   type: "tool_result",
 *   timestamp: string,
 *   tool_id: string,
 *   status: string,
 *   output?: string,
 *   error?: { type: string, message: string }
 * } | {
 *   type: "error",
 *   timestamp: string,
 *   severity: "warning" | "error",
 *   message: string
 * } | {
 *   type: "result",
 *   timestamp: string,
 *   status: "success" | "error",
 *   error?: { type: string, message: string },
 *   stats?: Record<string, unknown>
 * }} HeadlessEvent
 */

/**
 * @typedef {{
 *   sessionId: string | null,
 *   status: "success" | "error",
 *   exitCode: number,
 *   lastAssistantMessage: string,
 *   messages: HeadlessEvent[],
 *   toolCalls: HeadlessEvent[],
 *   errors: HeadlessEvent[],
 *   stats: Record<string, unknown> | null,
 *   stderr: string
 * }} HeadlessRunResult
 */

function buildArgs(prompt, options) {
  const args = ["-p", prompt, "--output-format", "stream-json", "--yolo"];

  if (options.model) {
    args.push("--model", options.model);
  }

  if (options.effort) {
    args.push("--effort", options.effort);
  }

  if (options.sandbox === "read-only") {
    args.push("--sandbox");
  }

  if (options.resumeSessionId) {
    args.push("--resume", options.resumeSessionId);
  }

  return args;
}

function inferPhase(toolName) {
  if (!toolName) {
    return null;
  }
  const name = toolName.toLowerCase();
  if (name.includes("edit") || name.includes("write") || name.includes("file") || name.includes("patch")) {
    return "editing";
  }
  if (name.includes("shell") || name.includes("command") || name.includes("run") || name.includes("exec")) {
    return "running";
  }
  if (name.includes("search") || name.includes("glob") || name.includes("grep") || name.includes("read") || name.includes("list")) {
    return "investigating";
  }
  return "investigating";
}

/**
 * @param {string} cwd
 * @param {string} prompt
 * @param {{
 *   model?: string | null,
 *   sandbox?: string | null,
 *   resumeSessionId?: string | null,
 *   onEvent?: ((event: HeadlessEvent) => void) | null,
 *   env?: NodeJS.ProcessEnv
 * }} [options]
 * @returns {Promise<HeadlessRunResult>}
 */
export async function runHeadlessGemini(cwd, prompt, options = {}) {
  const args = buildArgs(prompt, options);

  const proc = spawn("gemini", args, {
    cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    windowsHide: true
  });

  let stderr = "";
  let sessionId = null;
  let resultStatus = "error";
  let resultStats = null;
  let lastAssistantMessage = "";
  const messages = [];
  const toolCalls = [];
  const errors = [];

  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const rl = readline.createInterface({ input: proc.stdout });

  rl.on("line", (line) => {
    if (!line.trim()) {
      return;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    options.onEvent?.(event);

    switch (event.type) {
      case "init":
        sessionId = event.session_id ?? null;
        break;
      case "message":
        messages.push(event);
        if (event.role === "assistant" && event.content && !event.delta) {
          lastAssistantMessage = event.content;
        }
        if (event.role === "assistant" && event.delta && event.content) {
          lastAssistantMessage += event.content;
        }
        break;
      case "tool_use":
      case "tool_result":
        toolCalls.push(event);
        break;
      case "error":
        errors.push(event);
        break;
      case "result":
        resultStatus = event.status ?? "error";
        resultStats = event.stats ?? null;
        break;
    }
  });

  const exitCode = await new Promise((resolve) => {
    proc.on("error", (error) => {
      if (error.code === "ENOENT") {
        errors.push({ type: "error", severity: "error", message: "gemini binary not found" });
      }
      resolve(1);
    });

    proc.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });

  rl.close();

  return {
    sessionId,
    status: resultStatus,
    exitCode,
    lastAssistantMessage,
    messages,
    toolCalls,
    errors,
    stats: resultStats,
    stderr
  };
}

export function buildProgressAdapter(onProgress) {
  if (!onProgress) {
    return null;
  }

  let assistantBuffer = "";

  return (event) => {
    switch (event.type) {
      case "init":
        onProgress({
          message: `Session started (${event.session_id}).`,
          phase: "starting",
          threadId: event.session_id
        });
        break;
      case "message":
        if (event.role === "assistant" && event.content) {
          if (event.delta) {
            assistantBuffer += event.content;
          } else {
            assistantBuffer = event.content;
          }
        }
        break;
      case "tool_use":
        onProgress({
          message: `Using tool: ${event.tool_name}`,
          phase: inferPhase(event.tool_name)
        });
        break;
      case "tool_result":
        onProgress({
          message: `Tool ${event.status}: ${event.tool_id}`,
          phase: event.status === "error" ? "failed" : null
        });
        break;
      case "error":
        onProgress({
          message: `Gemini ${event.severity}: ${event.message}`,
          phase: event.severity === "error" ? "failed" : null
        });
        break;
      case "result":
        onProgress({
          message: `Run ${event.status}.`,
          phase: "finalizing"
        });
        break;
    }
  };
}

export { inferPhase };
