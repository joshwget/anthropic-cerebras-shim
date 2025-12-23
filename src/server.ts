import express, { Request, Response, NextFunction } from "express";
import { CerebrasClient } from "./cerebras-client.js";
import {
  translateRequest,
  translateResponse,
  translateStreamChunk,
  createStreamState,
  createMessageStartEvent,
} from "./translators/index.js";
import * as Anthropic from "./types/anthropic.js";
import { serverLog, streamLog } from "./logger.js";

export interface ServerConfig {
  cerebrasApiKey: string;
  port?: number;
}

export function createServer(config: ServerConfig) {
  const app = express();
  const client = new CerebrasClient({ apiKey: config.cerebrasApiKey });

  app.use(express.json({ limit: "50mb" }));

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Messages endpoint - the main Anthropic API endpoint
  app.post("/v1/messages", async (req: Request, res: Response, next: NextFunction) => {
    const requestId = generateRequestId();
    const startTime = Date.now();

    try {
      const anthropicRequest = req.body as Anthropic.MessagesRequest;

      serverLog.info("Incoming request", {
        requestId,
        model: anthropicRequest.model,
        stream: anthropicRequest.stream ?? false,
        messageCount: anthropicRequest.messages?.length ?? 0,
        maxTokens: anthropicRequest.max_tokens,
        hasTools: (anthropicRequest.tools?.length ?? 0) > 0,
        toolCount: anthropicRequest.tools?.length,
      });

      serverLog.debug("Request details", {
        requestId,
        temperature: anthropicRequest.temperature,
        topP: anthropicRequest.top_p,
        stopSequences: anthropicRequest.stop_sequences,
        toolChoice: anthropicRequest.tool_choice,
        systemPromptLength: typeof anthropicRequest.system === "string"
          ? anthropicRequest.system.length
          : anthropicRequest.system?.map(b => b.text).join("").length,
      });

      // Validate required fields
      if (!anthropicRequest.model) {
        serverLog.warn("Validation failed: model is required", { requestId });
        res.status(400).json({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "model is required",
          },
        });
        return;
      }

      if (!anthropicRequest.max_tokens) {
        serverLog.warn("Validation failed: max_tokens is required", { requestId });
        res.status(400).json({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "max_tokens is required",
          },
        });
        return;
      }

      if (!anthropicRequest.messages || anthropicRequest.messages.length === 0) {
        serverLog.warn("Validation failed: messages is required", { requestId });
        res.status(400).json({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "messages is required and must not be empty",
          },
        });
        return;
      }

      // Translate request to Cerebras format
      const cerebrasRequest = translateRequest(anthropicRequest);

      if (anthropicRequest.stream) {
        // Handle streaming response
        serverLog.info("Starting streaming response", { requestId });
        await handleStreamingResponse(res, client, cerebrasRequest, anthropicRequest.model, requestId);
        const duration = Date.now() - startTime;
        serverLog.info("Streaming response completed", { requestId, durationMs: duration });
      } else {
        // Handle non-streaming response
        serverLog.debug("Sending non-streaming request to Cerebras", { requestId });
        const cerebrasResponse = await client.createCompletion(cerebrasRequest);
        const anthropicResponse = translateResponse(cerebrasResponse, anthropicRequest.model);
        const duration = Date.now() - startTime;
        serverLog.info("Request completed", {
          requestId,
          durationMs: duration,
          inputTokens: anthropicResponse.usage.input_tokens,
          outputTokens: anthropicResponse.usage.output_tokens,
          stopReason: anthropicResponse.stop_reason,
        });
        res.json(anthropicResponse);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      serverLog.error("Request failed", {
        requestId,
        durationMs: duration,
        error: error instanceof Error ? error.message : String(error),
      });
      next(error);
    }
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    serverLog.error("Unhandled error", {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({
      type: "error",
      error: {
        type: "api_error",
        message: err.message || "Internal server error",
      },
    });
  });

  return app;
}

async function handleStreamingResponse(
  res: Response,
  client: CerebrasClient,
  cerebrasRequest: import("./types/cerebras.js").ChatCompletionsRequest,
  originalModel: string,
  requestId: string
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const state = createStreamState(originalModel);
  let chunkCount = 0;
  let eventCount = 0;

  streamLog.debug("Setting up SSE stream", { requestId, messageId: state.messageId });

  // Send initial message_start event
  const messageStartEvent = createMessageStartEvent(state);
  res.write(`event: message_start\ndata: ${JSON.stringify(messageStartEvent)}\n\n`);
  eventCount++;

  // Send ping
  res.write(`event: ping\ndata: {"type": "ping"}\n\n`);
  eventCount++;

  try {
    for await (const chunk of client.createCompletionStream(cerebrasRequest)) {
      chunkCount++;
      const events = translateStreamChunk(chunk, state);

      for (const event of events) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        eventCount++;

        if (event.type === "message_stop") {
          streamLog.debug("Stream completed", {
            requestId,
            chunkCount,
            eventCount,
            contentBlocks: state.contentBlocks.length,
          });
        }
      }
    }
  } catch (error) {
    streamLog.error("Stream error", {
      requestId,
      chunkCount,
      error: error instanceof Error ? error.message : String(error),
    });
    const errorEvent: Anthropic.ErrorEvent = {
      type: "error",
      error: {
        type: "api_error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
    };
    res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
  }

  res.end();
}

export function startServer(config: ServerConfig): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolve) => {
    const app = createServer(config);
    const port = config.port ?? 3000;

    app.listen(port, () => {
      serverLog.info("Server started", { port, endpoint: "/v1/messages" });
      resolve(app);
    });
  });
}

function generateRequestId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "req_";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
