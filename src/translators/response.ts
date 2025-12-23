import * as Anthropic from "../types/anthropic.js";
import * as Cerebras from "../types/cerebras.js";
import { responseLog } from "../logger.js";

export function translateResponse(
  cerebrasResponse: Cerebras.ChatCompletionsResponse,
  originalModel: string
): Anthropic.MessagesResponse {
  responseLog.debug("Translating Cerebras response to Anthropic format", {
    cerebrasId: cerebrasResponse.id,
  });

  const choice = cerebrasResponse.choices[0];
  if (!choice) {
    responseLog.error("No choices in Cerebras response");
    throw new Error("No choices in Cerebras response");
  }

  const content: Anthropic.ContentBlock[] = [];

  // Add text content if present
  if (choice.message.content) {
    content.push({
      type: "text",
      text: choice.message.content,
    });
  }

  // Add tool use blocks if present
  if (choice.message.tool_calls) {
    for (const toolCall of choice.message.tool_calls) {
      content.push({
        type: "tool_use",
        id: toolCall.id,
        name: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments),
      });
    }
    responseLog.debug("Translated tool calls", {
      count: choice.message.tool_calls.length,
      names: choice.message.tool_calls.map(tc => tc.function.name),
    });
  }

  // If no content at all, add empty text block
  if (content.length === 0) {
    content.push({
      type: "text",
      text: "",
    });
  }

  const result: Anthropic.MessagesResponse = {
    id: `msg_${cerebrasResponse.id}`,
    type: "message",
    role: "assistant",
    model: originalModel,
    content,
    stop_reason: translateStopReason(choice.finish_reason, choice.message.tool_calls),
    stop_sequence: null,
    usage: {
      input_tokens: cerebrasResponse.usage.prompt_tokens,
      output_tokens: cerebrasResponse.usage.completion_tokens,
    },
  };

  responseLog.info("Response translation complete", {
    messageId: result.id,
    contentBlocks: content.length,
    hasText: content.some(c => c.type === "text" && c.text),
    hasToolUse: content.some(c => c.type === "tool_use"),
    stopReason: result.stop_reason,
    inputTokens: result.usage.input_tokens,
    outputTokens: result.usage.output_tokens,
  });

  return result;
}

function translateStopReason(
  finishReason: Cerebras.Choice["finish_reason"],
  toolCalls?: Cerebras.ToolCall[]
): Anthropic.StopReason | null {
  // If there are tool calls, always return "tool_use"
  if (toolCalls && toolCalls.length > 0) {
    return "tool_use";
  }

  switch (finishReason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      return "end_turn";
    default:
      return null;
  }
}

// Streaming response translation
export interface StreamState {
  messageId: string;
  model: string;
  contentBlocks: Anthropic.ContentBlock[];
  currentBlockIndex: number;
  toolCallStates: Map<number, {
    id: string;
    name: string;
    argumentsBuffer: string;
    startEventSent: boolean;
  }>;
  inputTokens: number;
  outputTokens: number;
  textBuffer: string;
  textBlockStarted: boolean;
}

export function createStreamState(originalModel: string): StreamState {
  return {
    messageId: `msg_${generateId()}`,
    model: originalModel,
    contentBlocks: [],
    currentBlockIndex: -1,
    toolCallStates: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    textBuffer: "",
    textBlockStarted: false,
  };
}

export function translateStreamChunk(
  chunk: Cerebras.ChatCompletionsChunk,
  state: StreamState
): Anthropic.StreamEvent[] {
  const events: Anthropic.StreamEvent[] = [];
  const choice = chunk.choices[0];

  if (!choice) {
    return events;
  }

  const delta = choice.delta;

  // Handle text content
  if (delta.content) {
    if (!state.textBlockStarted) {
      state.textBlockStarted = true;
      state.currentBlockIndex++;
      events.push({
        type: "content_block_start",
        index: state.currentBlockIndex,
        content_block: {
          type: "text",
          text: "",
        },
      });
    }

    state.textBuffer += delta.content;
    events.push({
      type: "content_block_delta",
      index: state.currentBlockIndex,
      delta: {
        type: "text_delta",
        text: delta.content,
      },
    });
  }

  // Handle tool calls
  if (delta.tool_calls) {
    // Close text block if needed
    if (state.textBlockStarted && state.textBuffer) {
      events.push({
        type: "content_block_stop",
        index: state.currentBlockIndex,
      });
      state.contentBlocks.push({
        type: "text",
        text: state.textBuffer,
      });
      state.textBlockStarted = false;
      state.textBuffer = "";
    }

    for (const toolCall of delta.tool_calls) {
      let toolState = state.toolCallStates.get(toolCall.index);

      // New tool call
      if (!toolState && toolCall.id) {
        state.currentBlockIndex++;
        toolState = {
          id: toolCall.id,
          name: toolCall.function?.name ?? "",
          argumentsBuffer: "",
          startEventSent: false,
        };
        state.toolCallStates.set(toolCall.index, toolState);
      }

      if (toolState) {
        // Update name if provided
        if (toolCall.function?.name) {
          toolState.name = toolCall.function.name;
        }

        // Send start event if not yet sent and we have enough info
        if (!toolState.startEventSent && toolState.id && toolState.name) {
          events.push({
            type: "content_block_start",
            index: state.currentBlockIndex,
            content_block: {
              type: "tool_use",
              id: toolState.id,
              name: toolState.name,
              input: {},
            },
          });
          toolState.startEventSent = true;
        }

        // Accumulate arguments
        if (toolCall.function?.arguments) {
          toolState.argumentsBuffer += toolCall.function.arguments;
          events.push({
            type: "content_block_delta",
            index: state.currentBlockIndex,
            delta: {
              type: "input_json_delta",
              partial_json: toolCall.function.arguments,
            },
          });
        }
      }
    }
  }

  // Handle finish
  if (choice.finish_reason) {
    // Close any open text block
    if (state.textBlockStarted) {
      events.push({
        type: "content_block_stop",
        index: state.currentBlockIndex,
      });
      state.contentBlocks.push({
        type: "text",
        text: state.textBuffer,
      });
    }

    // Close any open tool call blocks
    for (const [index, toolState] of state.toolCallStates) {
      if (toolState.startEventSent) {
        events.push({
          type: "content_block_stop",
          index: state.currentBlockIndex - (state.toolCallStates.size - 1 - index),
        });
        state.contentBlocks.push({
          type: "tool_use",
          id: toolState.id,
          name: toolState.name,
          input: toolState.argumentsBuffer ? JSON.parse(toolState.argumentsBuffer) : {},
        });
      }
    }

    const hasToolCalls = state.toolCallStates.size > 0;
    const stopReason = translateStopReason(choice.finish_reason, hasToolCalls ? [{ id: "", type: "function", function: { name: "", arguments: "" } }] : undefined);
    events.push({
      type: "message_delta",
      delta: {
        stop_reason: stopReason ?? "end_turn",
        stop_sequence: null,
      },
      usage: {
        output_tokens: state.outputTokens,
      },
    });

    events.push({
      type: "message_stop",
    });
  }

  return events;
}

export function createMessageStartEvent(state: StreamState): Anthropic.MessageStartEvent {
  return {
    type: "message_start",
    message: {
      id: state.messageId,
      type: "message",
      role: "assistant",
      model: state.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: state.inputTokens,
        output_tokens: 0,
      },
    },
  };
}

function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
