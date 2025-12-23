import { describe, it, expect } from "vitest";
import {
  translateResponse,
  translateStreamChunk,
  createStreamState,
  createMessageStartEvent,
} from "../src/translators/response.js";
import * as Cerebras from "../src/types/cerebras.js";

describe("Response Translator", () => {
  describe("Non-streaming response translation", () => {
    it("should translate a simple text response", () => {
      const cerebrasResponse: Cerebras.ChatCompletionsResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello! How can I help you today?",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      const result = translateResponse(cerebrasResponse, "claude-3-sonnet-20240229");

      expect(result.id).toBe("msg_chatcmpl-123");
      expect(result.type).toBe("message");
      expect(result.role).toBe("assistant");
      expect(result.model).toBe("claude-3-sonnet-20240229");
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Hello! How can I help you today?",
      });
      expect(result.stop_reason).toBe("end_turn");
      expect(result.usage).toEqual({
        input_tokens: 10,
        output_tokens: 20,
      });
    });

    it("should translate stop reason: length to max_tokens", () => {
      const cerebrasResponse: Cerebras.ChatCompletionsResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "This is a truncated response...",
            },
            finish_reason: "length",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 100,
          total_tokens: 110,
        },
      };

      const result = translateResponse(cerebrasResponse, "claude-3-sonnet-20240229");

      expect(result.stop_reason).toBe("max_tokens");
    });

    it("should translate a response with tool calls", () => {
      const cerebrasResponse: Cerebras.ChatCompletionsResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "I'll check the weather for you.",
              tool_calls: [
                {
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"location": "New York, NY"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      const result = translateResponse(cerebrasResponse, "claude-3-sonnet-20240229");

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "I'll check the weather for you.",
      });
      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_123",
        name: "get_weather",
        input: { location: "New York, NY" },
      });
      expect(result.stop_reason).toBe("tool_use");
    });

    it("should translate a response with only tool calls (no text)", () => {
      const cerebrasResponse: Cerebras.ChatCompletionsResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"location": "NYC"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      const result = translateResponse(cerebrasResponse, "claude-3-sonnet-20240229");

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: "tool_use",
        id: "call_123",
        name: "get_weather",
        input: { location: "NYC" },
      });
      expect(result.stop_reason).toBe("tool_use");
    });

    it("should translate multiple parallel tool calls", () => {
      const cerebrasResponse: Cerebras.ChatCompletionsResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"location": "NYC"}',
                  },
                },
                {
                  id: "call_2",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"location": "LA"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      const result = translateResponse(cerebrasResponse, "claude-3-sonnet-20240229");

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "get_weather",
        input: { location: "NYC" },
      });
      expect(result.content[1]).toEqual({
        type: "tool_use",
        id: "call_2",
        name: "get_weather",
        input: { location: "LA" },
      });
    });

    it("should handle complex tool arguments", () => {
      const cerebrasResponse: Cerebras.ChatCompletionsResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "search",
                    arguments: JSON.stringify({
                      query: "best restaurants",
                      filters: {
                        price_range: ["$$", "$$$"],
                        rating: 4.5,
                        open_now: true,
                      },
                      limit: 10,
                    }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      const result = translateResponse(cerebrasResponse, "claude-3-sonnet-20240229");

      expect(result.content[0]).toEqual({
        type: "tool_use",
        id: "call_123",
        name: "search",
        input: {
          query: "best restaurants",
          filters: {
            price_range: ["$$", "$$$"],
            rating: 4.5,
            open_now: true,
          },
          limit: 10,
        },
      });
    });

    it("should add empty text block when response has no content", () => {
      const cerebrasResponse: Cerebras.ChatCompletionsResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      };

      const result = translateResponse(cerebrasResponse, "claude-3-sonnet-20240229");

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "",
      });
    });

    it("should throw error when no choices in response", () => {
      const cerebrasResponse: Cerebras.ChatCompletionsResponse = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      };

      expect(() => translateResponse(cerebrasResponse, "claude-3-sonnet-20240229")).toThrow(
        "No choices in Cerebras response"
      );
    });
  });

  describe("Stream state management", () => {
    it("should create stream state with unique message ID", () => {
      const state1 = createStreamState("claude-3-sonnet-20240229");
      const state2 = createStreamState("claude-3-sonnet-20240229");

      expect(state1.messageId).toMatch(/^msg_[a-zA-Z0-9]+$/);
      expect(state2.messageId).toMatch(/^msg_[a-zA-Z0-9]+$/);
      expect(state1.messageId).not.toBe(state2.messageId);
    });

    it("should create message start event", () => {
      const state = createStreamState("claude-3-sonnet-20240229");
      const event = createMessageStartEvent(state);

      expect(event.type).toBe("message_start");
      expect(event.message.id).toBe(state.messageId);
      expect(event.message.type).toBe("message");
      expect(event.message.role).toBe("assistant");
      expect(event.message.model).toBe("claude-3-sonnet-20240229");
      expect(event.message.content).toEqual([]);
      expect(event.message.stop_reason).toBeNull();
    });
  });

  describe("Streaming response translation", () => {
    it("should translate text content chunks", () => {
      const state = createStreamState("claude-3-sonnet-20240229");

      const chunk1: Cerebras.ChatCompletionsChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: "Hello",
            },
            finish_reason: null,
          },
        ],
      };

      const events1 = translateStreamChunk(chunk1, state);

      expect(events1).toHaveLength(2);
      expect(events1[0]).toEqual({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "text",
          text: "",
        },
      });
      expect(events1[1]).toEqual({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: "Hello",
        },
      });

      // Second chunk
      const chunk2: Cerebras.ChatCompletionsChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            delta: {
              content: " world!",
            },
            finish_reason: null,
          },
        ],
      };

      const events2 = translateStreamChunk(chunk2, state);

      expect(events2).toHaveLength(1);
      expect(events2[0]).toEqual({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: " world!",
        },
      });
    });

    it("should translate tool call chunks", () => {
      const state = createStreamState("claude-3-sonnet-20240229");

      // First chunk with tool call start
      const chunk1: Cerebras.ChatCompletionsChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: "",
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };

      const events1 = translateStreamChunk(chunk1, state);

      expect(events1).toHaveLength(1);
      expect(events1[0]).toEqual({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "call_123",
          name: "get_weather",
          input: {},
        },
      });

      // Second chunk with arguments
      const chunk2: Cerebras.ChatCompletionsChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: '{"location":',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };

      const events2 = translateStreamChunk(chunk2, state);

      expect(events2).toHaveLength(1);
      expect(events2[0]).toEqual({
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: '{"location":',
        },
      });
    });

    it("should handle finish reason in stream", () => {
      const state = createStreamState("claude-3-sonnet-20240229");
      state.textBlockStarted = true;
      state.textBuffer = "Hello";
      state.currentBlockIndex = 0;

      const finishChunk: Cerebras.ChatCompletionsChunk = {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1677652288,
        model: "zai-glm-4.6",
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      };

      const events = translateStreamChunk(finishChunk, state);

      expect(events).toContainEqual({
        type: "content_block_stop",
        index: 0,
      });
      expect(events).toContainEqual({
        type: "message_delta",
        delta: {
          stop_reason: "end_turn",
          stop_sequence: null,
        },
        usage: {
          output_tokens: 0,
        },
      });
      expect(events).toContainEqual({
        type: "message_stop",
      });
    });
  });
});
