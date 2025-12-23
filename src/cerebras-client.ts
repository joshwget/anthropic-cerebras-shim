import * as Cerebras from "./types/cerebras.js";
import { clientLog } from "./logger.js";

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";

export interface CerebrasClientConfig {
  apiKey: string;
}

export class CerebrasClient {
  private apiKey: string;

  constructor(config: CerebrasClientConfig) {
    this.apiKey = config.apiKey;
  }

  async createCompletion(
    request: Cerebras.ChatCompletionsRequest
  ): Promise<Cerebras.ChatCompletionsResponse> {
    const startTime = Date.now();

    // Log the actual request being sent for debugging
    clientLog.debug("Sending completion request", {
      model: request.model,
      messageCount: request.messages.length,
      maxTokens: request.max_completion_tokens,
      hasTools: (request.tools?.length ?? 0) > 0,
    });

    // Create a clean request object with only known fields
    const cleanRequest: Cerebras.ChatCompletionsRequest = {
      model: request.model,
      messages: request.messages,
      stream: false,
    };
    if (request.max_completion_tokens !== undefined) cleanRequest.max_completion_tokens = request.max_completion_tokens;
    if (request.temperature !== undefined) cleanRequest.temperature = request.temperature;
    if (request.top_p !== undefined) cleanRequest.top_p = request.top_p;
    if (request.stop !== undefined) cleanRequest.stop = request.stop;
    if (request.seed !== undefined) cleanRequest.seed = request.seed;
    if (request.tools && request.tools.length > 0) {
      cleanRequest.tools = request.tools;
      cleanRequest.tool_choice = request.tool_choice;
      cleanRequest.parallel_tool_calls = request.parallel_tool_calls;
    }

    const response = await fetch(CEREBRAS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(cleanRequest),
    });

    if (!response.ok) {
      const error = await response.text();
      clientLog.error("API request failed", {
        status: response.status,
        error,
        durationMs: Date.now() - startTime,
      });
      throw new Error(`Cerebras API error: ${response.status} - ${error}`);
    }

    const result = await response.json() as Cerebras.ChatCompletionsResponse;
    const durationMs = Date.now() - startTime;

    clientLog.info("Completion received", {
      durationMs,
      promptTokens: result.usage?.prompt_tokens,
      completionTokens: result.usage?.completion_tokens,
      finishReason: result.choices[0]?.finish_reason,
      hasToolCalls: (result.choices[0]?.message?.tool_calls?.length ?? 0) > 0,
    });

    return result;
  }

  async *createCompletionStream(
    request: Cerebras.ChatCompletionsRequest
  ): AsyncGenerator<Cerebras.ChatCompletionsChunk> {
    const startTime = Date.now();

    clientLog.debug("Starting stream request", {
      model: request.model,
      messageCount: request.messages.length,
      maxTokens: request.max_completion_tokens,
      hasTools: (request.tools?.length ?? 0) > 0,
    });

    // Create a clean request object with only known fields
    const cleanRequest: Cerebras.ChatCompletionsRequest = {
      model: request.model,
      messages: request.messages,
      stream: true,
    };
    if (request.max_completion_tokens !== undefined) cleanRequest.max_completion_tokens = request.max_completion_tokens;
    if (request.temperature !== undefined) cleanRequest.temperature = request.temperature;
    if (request.top_p !== undefined) cleanRequest.top_p = request.top_p;
    if (request.stop !== undefined) cleanRequest.stop = request.stop;
    if (request.seed !== undefined) cleanRequest.seed = request.seed;
    if (request.tools && request.tools.length > 0) {
      cleanRequest.tools = request.tools;
      cleanRequest.tool_choice = request.tool_choice;
      cleanRequest.parallel_tool_calls = request.parallel_tool_calls;
    }

    const response = await fetch(CEREBRAS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(cleanRequest),
    });

    if (!response.ok) {
      const error = await response.text();
      clientLog.error("Stream request failed", {
        status: response.status,
        error,
        durationMs: Date.now() - startTime,
      });
      throw new Error(`Cerebras API error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      clientLog.error("No response body received");
      throw new Error("No response body");
    }

    const ttfb = Date.now() - startTime;
    clientLog.debug("Stream connected", { ttfbMs: ttfb });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let chunkCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) {
            continue;
          }

          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            const totalDuration = Date.now() - startTime;
            clientLog.info("Stream completed", {
              durationMs: totalDuration,
              chunkCount,
            });
            return;
          }

          try {
            const chunk = JSON.parse(data) as Cerebras.ChatCompletionsChunk;
            chunkCount++;
            yield chunk;
          } catch (parseError) {
            clientLog.warn("Failed to parse stream chunk", {
              data: data.slice(0, 100),
              error: parseError instanceof Error ? parseError.message : String(parseError),
            });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
