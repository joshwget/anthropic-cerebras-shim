#!/usr/bin/env node

import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createServer } from "./server.js";
import chalk from "chalk";
import ora from "ora";
import readline from "readline";
import http from "http";
import "dotenv/config";

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;

if (!CEREBRAS_API_KEY) {
  console.error(chalk.red("Error: CEREBRAS_API_KEY environment variable is required"));
  console.error(chalk.gray("Set it in your .env file or export it in your shell"));
  process.exit(1);
}

// CLI state
let server: http.Server | null = null;
let baseUrl: string = "";

// Terminal colors
const colors = {
  user: chalk.cyan,
  assistant: chalk.white,
  tool: chalk.yellow,
  toolResult: chalk.gray,
  error: chalk.red,
  success: chalk.green,
  dim: chalk.dim,
  bold: chalk.bold,
  system: chalk.magenta,
};

// Format tool input for display
function formatToolInput(input: Record<string, unknown>): string {
  const formatted = JSON.stringify(input, null, 2);
  if (formatted.length > 200) {
    return formatted.slice(0, 200) + "...";
  }
  return formatted;
}

// Print a horizontal line
function printLine(char = "─", length = 60): void {
  console.log(colors.dim(char.repeat(length)));
}

// Print welcome message
function printWelcome(): void {
  console.log();
  console.log(colors.bold("  Cerebras Claude CLI"));
  console.log(colors.dim("  Powered by Anthropic Claude Agent SDK + Cerebras zai-glm-4.6"));
  console.log();
  printLine();
  console.log();
  console.log(colors.dim("  Commands:"));
  console.log(colors.dim("    /help     - Show this help"));
  console.log(colors.dim("    /clear    - Clear conversation (new session)"));
  console.log(colors.dim("    /exit     - Exit the CLI"));
  console.log(colors.dim("    /tools    - List available tools"));
  console.log();
  console.log(colors.dim("  Start typing to chat with the AI..."));
  console.log();
  printLine();
  console.log();
}

// Print tool list
function printTools(): void {
  console.log();
  console.log(colors.bold("Available Tools:"));
  console.log();
  const tools = [
    ["Read", "Read files from the filesystem"],
    ["Write", "Create new files"],
    ["Edit", "Edit existing files"],
    ["Bash", "Run shell commands"],
    ["Glob", "Find files by pattern"],
    ["Grep", "Search file contents"],
    ["WebSearch", "Search the web"],
    ["WebFetch", "Fetch web page content"],
  ];
  for (const [name, desc] of tools) {
    console.log(`  ${colors.tool(name.padEnd(12))} ${colors.dim(desc)}`);
  }
  console.log();
}

// Process a user message
async function processMessage(message: string): Promise<void> {
  const spinner = ora({
    text: "Thinking...",
    spinner: "dots",
  }).start();

  let assistantText = "";
  let currentToolName: string | null = null;
  let hasContent = false;

  try {
    const options: Parameters<typeof query>[0]["options"] = {
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Task"],
      permissionMode: "bypassPermissions",
      maxTurns: 20,
      cwd: process.cwd(),
    };

    for await (const msg of query({ prompt: message, options })) {

      // Handle assistant messages
      if (msg.type === "assistant" && msg.message?.content) {
        if (spinner.isSpinning) {
          spinner.stop();
        }

        for (const block of msg.message.content) {
          if ("text" in block && block.text) {
            // Print text content
            if (!hasContent) {
              console.log();
              hasContent = true;
            }
            // Stream text incrementally
            const newText = block.text.slice(assistantText.length);
            if (newText) {
              process.stdout.write(colors.assistant(newText));
              assistantText = block.text;
            }
          } else if ("name" in block) {
            // Tool use
            if (assistantText && !assistantText.endsWith("\n")) {
              console.log();
            }
            currentToolName = block.name;
            console.log();
            console.log(colors.tool(`  ▶ ${block.name}`));
            if (block.input && Object.keys(block.input).length > 0) {
              const inputStr = formatToolInput(block.input as Record<string, unknown>);
              for (const line of inputStr.split("\n")) {
                console.log(colors.dim(`    ${line}`));
              }
            }
            assistantText = "";
          }
        }
      }

      // Handle tool results
      if (msg.type === "user" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (typeof block === "object" && "type" in block && block.type === "tool_result") {
            const content = typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content);
            const truncated = content.length > 300
              ? content.slice(0, 300) + "..."
              : content;
            console.log(colors.toolResult(`    ← ${truncated.split("\n")[0]}`));
          }
        }
      }

      // Handle result
      if (msg.type === "result") {
        if (spinner.isSpinning) {
          spinner.stop();
        }
        if (msg.subtype === "error_during_execution") {
          console.log();
          console.log(colors.error(`Error: ${(msg as { result?: string }).result || "Unknown error"}`));
        }
      }
    }

    if (assistantText && !assistantText.endsWith("\n")) {
      console.log();
    }
    console.log();

  } catch (error) {
    spinner.stop();
    console.log();
    console.log(colors.error(`Error: ${error instanceof Error ? error.message : String(error)}`));
    console.log();
  }
}

// Main interactive loop
async function main(): Promise<void> {
  // Start the shim server
  const app = createServer({ cerebrasApiKey: CEREBRAS_API_KEY! });
  server = app.listen(0);
  const address = server.address();
  if (typeof address === "object" && address !== null) {
    baseUrl = `http://localhost:${address.port}`;
  }

  // Configure Agent SDK to use our shim
  process.env.ANTHROPIC_BASE_URL = baseUrl;
  process.env.ANTHROPIC_API_KEY = "shim-passthrough";

  // Suppress server logs for cleaner CLI output
  process.env.LOG_LEVEL = "error";

  printWelcome();

  // Set up readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question(colors.user("> "), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // Handle commands
      if (trimmed.startsWith("/")) {
        const cmd = trimmed.toLowerCase();

        if (cmd === "/exit" || cmd === "/quit" || cmd === "/q") {
          console.log();
          console.log(colors.dim("Goodbye!"));
          console.log();
          rl.close();
          server?.close();
          process.exit(0);
        }

        if (cmd === "/help" || cmd === "/h" || cmd === "/?") {
          printWelcome();
          prompt();
          return;
        }

        if (cmd === "/clear" || cmd === "/reset" || cmd === "/new") {
          console.log();
          console.log(colors.system("Starting fresh conversation."));
          console.log();
          prompt();
          return;
        }

        if (cmd === "/tools") {
          printTools();
          prompt();
          return;
        }

        console.log();
        console.log(colors.error(`Unknown command: ${trimmed}`));
        console.log(colors.dim("Type /help for available commands"));
        console.log();
        prompt();
        return;
      }

      // Process regular message
      // Pause readline during query to avoid stdin conflicts with subprocess
      rl.pause();
      await processMessage(trimmed);
      rl.resume();
      prompt();
    });
  };

  // Handle Ctrl+C gracefully
  rl.on("close", () => {
    console.log();
    console.log(colors.dim("Goodbye!"));
    server?.close();
    process.exit(0);
  });

  // Handle SIGINT
  process.on("SIGINT", () => {
    console.log();
    console.log(colors.dim("Goodbye!"));
    server?.close();
    process.exit(0);
  });

  prompt();
}

// Run
main().catch((error) => {
  console.error(colors.error(`Fatal error: ${error.message}`));
  server?.close();
  process.exit(1);
});
