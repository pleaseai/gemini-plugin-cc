import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { writeExecutable } from "./helpers.mjs";

export function installFakeGemini(binDir, behavior = "review-ok") {
  const statePath = path.join(binDir, "fake-gemini-state.json");
  const scriptPath = path.join(binDir, "gemini");
  const source = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const STATE_PATH = ${JSON.stringify(statePath)};
const BEHAVIOR = ${JSON.stringify(behavior)};

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { runs: 0, lastPrompt: null, lastModel: null, lastResume: null, sessions: [] };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function now() {
  return new Date().toISOString();
}

function send(event) {
  process.stdout.write(JSON.stringify(event) + "\\n");
}

const args = process.argv.slice(2);

if (args[0] === "--version") {
  console.log("gemini-cli 0.36.0 (fake)");
  process.exit(0);
}

if (args[0] === "auth" && args[1] === "status") {
  if (BEHAVIOR === "logged-out") {
    console.error("not authenticated");
    process.exit(1);
  }
  console.log("logged in");
  process.exit(0);
}

if (args[0] === "auth") {
  process.exit(0);
}

if (args[0] === "--list-sessions") {
  const state = loadState();
  for (const session of state.sessions) {
    console.log(session.id + " " + (session.summary || ""));
  }
  process.exit(0);
}

// Headless mode: -p <prompt> --output-format stream-json
let prompt = null;
let model = null;
let resumeSessionId = null;
let outputFormat = "text";
let sandbox = false;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "-p" || args[i] === "--prompt") && args[i + 1]) {
    prompt = args[++i];
  } else if (args[i] === "--output-format" && args[i + 1]) {
    outputFormat = args[++i];
  } else if ((args[i] === "-m" || args[i] === "--model") && args[i + 1]) {
    model = args[++i];
  } else if (args[i] === "--resume" && args[i + 1]) {
    resumeSessionId = args[++i];
  } else if (args[i] === "--sandbox" || args[i] === "-s") {
    sandbox = true;
  } else if (args[i] === "--yolo" || args[i] === "-y") {
    // accepted, no-op for fake
  }
}

if (!prompt && outputFormat !== "stream-json") {
  process.exit(1);
}

const state = loadState();
state.runs = (state.runs || 0) + 1;

const sessionId = resumeSessionId || ("sess_" + state.runs);
state.lastPrompt = prompt;
state.lastModel = model;
state.lastResume = resumeSessionId;
state.lastTurnStart = { model, effort: null, prompt };

// Parse effort from prompt or flags
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--effort" && args[i + 1]) {
    state.lastTurnStart.effort = args[++i];
  }
}

state.sessions.push({ id: sessionId, summary: prompt ? prompt.slice(0, 50) : "" });
saveState(state);

if (outputFormat !== "stream-json") {
  // Simple JSON or text output
  const response = buildResponse(prompt, resumeSessionId);
  if (outputFormat === "json") {
    send({ session_id: sessionId, response, stats: {} });
  } else {
    process.stdout.write(response + "\\n");
  }
  process.exit(0);
}

// Stream JSON mode - emit JSONL events
send({ type: "init", timestamp: now(), session_id: sessionId, model: model || "gemini-3-flash-preview" });

const response = buildResponse(prompt, resumeSessionId);

// Emit tool calls for task behaviors
if (!prompt.includes("adversarial software review") && !prompt.includes("Code Review")) {
  send({
    type: "tool_use",
    timestamp: now(),
    tool_name: "read_file",
    tool_id: "tool_1",
    parameters: { file_path: "src/app.js" }
  });
  send({
    type: "tool_result",
    timestamp: now(),
    tool_id: "tool_1",
    status: "success",
    output: "file content"
  });
}

// Emit assistant message
send({
  type: "message",
  timestamp: now(),
  role: "assistant",
  content: response
});

// Emit result
send({
  type: "result",
  timestamp: now(),
  status: "success",
  stats: { total_tokens: 100, input_tokens: 50, output_tokens: 50, duration_ms: 1000, tool_calls: 1 }
});

process.exit(0);

function buildResponse(prompt, resume) {
  if (!prompt) {
    return "No prompt provided.";
  }

  // Stop-gate review behavior
  if (prompt.includes("Only review the work from the previous Claude turn")) {
    if (BEHAVIOR === "adversarial-clean") {
      return "ALLOW: No blocking issues found in the previous turn.";
    }
    return "BLOCK: Missing empty-state guard in src/app.js:4-6.";
  }

  // Structured review (adversarial) — requires schema output instruction
  if ((prompt.includes("adversarial software review") || prompt.includes("adversarial")) && (prompt.includes("Respond with valid JSON") && prompt.includes("verdict"))) {
    if (BEHAVIOR === "adversarial-clean") {
      return JSON.stringify({
        verdict: "approve",
        summary: "No material issues found.",
        findings: [],
        next_steps: []
      });
    }

    if (BEHAVIOR === "invalid-json") {
      return "not valid json";
    }

    return JSON.stringify({
      verdict: "needs-attention",
      summary: "One adversarial concern surfaced.",
      findings: [
        {
          severity: "high",
          title: "Missing empty-state guard",
          body: "The change assumes data is always present.",
          file: "src/app.js",
          line_start: 4,
          line_end: 6,
          confidence: 0.87,
          recommendation: "Handle empty collections before indexing."
        }
      ],
      next_steps: ["Add an empty-state test."]
    });
  }

  // Native review — adversarial template without JSON schema instruction
  if (prompt.includes("adversarial software review") && !prompt.includes("Respond with valid JSON")) {
    return "Reviewed uncommitted changes.\\nNo material issues found.";
  }

  // Resume behavior
  if (resume || prompt.includes("Continue from the current thread state") || prompt.includes("follow up")) {
    return "Resumed the prior run.\\nFollow-up prompt accepted.";
  }

  // Default task behavior
  return "Handled the requested task.\\nTask prompt accepted.";
}
`;
  writeExecutable(scriptPath, source);

  if (process.platform === "win32") {
    const cmdWrapper = `@echo off\r\nnode "%~dp0gemini" %*\r\n`;
    fs.writeFileSync(path.join(binDir, "gemini.cmd"), cmdWrapper, { encoding: "utf8" });
  }
}

export function buildEnv(binDir) {
  const sep = process.platform === "win32" ? ";" : ":";
  return {
    ...process.env,
    PATH: `${binDir}${sep}${process.env.PATH}`
  };
}
