import { describe, it, expect } from "vitest";
import { translateRequest } from "../src/translators/request.js";
import * as Anthropic from "../src/types/anthropic.js";

describe("Request Translator", () => {
  describe("Basic message translation", () => {
    it("should translate a simple text message", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [
          { role: "user", content: "Hello, world!" },
        ],
      };

      const result = translateRequest(request);

      expect(result.model).toBe("zai-glm-4.6");
      expect(result.max_completion_tokens).toBe(1024);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({
        role: "user",
        content: "Hello, world!",
      });
    });

    it("should translate a multi-turn conversation", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-opus-20240229",
        max_tokens: 2048,
        messages: [
          { role: "user", content: "What is 2+2?" },
          { role: "assistant", content: "2+2 equals 4." },
          { role: "user", content: "What about 3+3?" },
        ],
      };

      const result = translateRequest(request);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0]).toEqual({ role: "user", content: "What is 2+2?" });
      expect(result.messages[1]).toEqual({ role: "assistant", content: "2+2 equals 4." });
      expect(result.messages[2]).toEqual({ role: "user", content: "What about 3+3?" });
    });

    it("should include system message when provided as string", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        system: "You are a helpful assistant.",
        messages: [
          { role: "user", content: "Hi!" },
        ],
      };

      const result = translateRequest(request);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant.",
      });
    });

    it("should include system message when provided as array of text blocks", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        system: [
          { type: "text", text: "You are a helpful assistant." },
          { type: "text", text: "Be concise." },
        ],
        messages: [
          { role: "user", content: "Hi!" },
        ],
      };

      const result = translateRequest(request);

      expect(result.messages[0]).toEqual({
        role: "system",
        content: "You are a helpful assistant.\nBe concise.",
      });
    });
  });

  describe("Content block translation", () => {
    it("should translate user message with text blocks", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello" },
              { type: "text", text: " world!" },
            ],
          },
        ],
      };

      const result = translateRequest(request);

      expect(result.messages[0]).toEqual({
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "text", text: " world!" },
        ],
      });
    });

    it("should translate image blocks with base64 source", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "What is in this image?" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
                },
              },
            ],
          },
        ],
      };

      const result = translateRequest(request);

      expect(result.messages[0]).toEqual({
        role: "user",
        content: [
          { type: "text", text: "What is in this image?" },
          {
            type: "image_url",
            image_url: {
              url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
            },
          },
        ],
      });
    });

    it("should translate image blocks with URL source", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "url",
                  url: "https://example.com/image.png",
                },
              },
            ],
          },
        ],
      };

      const result = translateRequest(request);

      expect(result.messages[0]).toEqual({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: "https://example.com/image.png",
            },
          },
        ],
      });
    });
  });

  describe("Tool use translation", () => {
    it("should translate tool definitions", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Get the weather" }],
        tools: [
          {
            name: "get_weather",
            description: "Get the current weather for a location",
            input_schema: {
              type: "object",
              properties: {
                location: {
                  type: "string",
                  description: "The city and state",
                },
                unit: {
                  type: "string",
                  enum: ["celsius", "fahrenheit"],
                },
              },
              required: ["location"],
            },
          },
        ],
      };

      const result = translateRequest(request);

      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]).toEqual({
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the current weather for a location",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              location: {
                type: "string",
                description: "The city and state",
              },
              unit: {
                type: "string",
                enum: ["celsius", "fahrenheit"],
              },
            },
            required: ["location"],
          },
        },
      });
    });

    it("should translate tool choice auto", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Get the weather" }],
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
        ],
        tool_choice: { type: "auto" },
      };

      const result = translateRequest(request);

      expect(result.tool_choice).toBe("auto");
    });

    it("should translate tool choice any to required", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Get the weather" }],
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
        ],
        tool_choice: { type: "any" },
      };

      const result = translateRequest(request);

      expect(result.tool_choice).toBe("required");
    });

    it("should translate tool choice specific tool", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Get the weather" }],
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "get_weather" },
      };

      const result = translateRequest(request);

      expect(result.tool_choice).toEqual({
        type: "function",
        function: { name: "get_weather" },
      });
    });

    it("should translate tool choice none", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello" }],
        tools: [
          {
            name: "get_weather",
            description: "Get weather",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
        ],
        tool_choice: { type: "none" },
      };

      const result = translateRequest(request);

      expect(result.tool_choice).toBe("none");
    });

    it("should translate assistant message with tool use", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [
          { role: "user", content: "Get the weather in NYC" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "I'll check the weather for you." },
              {
                type: "tool_use",
                id: "toolu_123",
                name: "get_weather",
                input: { location: "New York, NY" },
              },
            ],
          },
        ],
      };

      const result = translateRequest(request);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1]).toEqual({
        role: "assistant",
        content: "I'll check the weather for you.",
        tool_calls: [
          {
            id: "toolu_123",
            type: "function",
            function: {
              name: "get_weather",
              arguments: JSON.stringify({ location: "New York, NY" }),
            },
          },
        ],
      });
    });

    it("should translate tool result in user message", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [
          { role: "user", content: "Get the weather in NYC" },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_123",
                name: "get_weather",
                input: { location: "New York, NY" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_123",
                content: "72°F and sunny",
              },
            ],
          },
        ],
      };

      const result = translateRequest(request);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[2]).toEqual({
        role: "tool",
        content: "72°F and sunny",
        tool_call_id: "toolu_123",
      });
    });

    it("should translate tool result with error flag", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_123",
                content: "API rate limit exceeded",
                is_error: true,
              },
            ],
          },
        ],
      };

      const result = translateRequest(request);

      expect(result.messages[0]).toEqual({
        role: "tool",
        content: "Error: API rate limit exceeded",
        tool_call_id: "toolu_123",
      });
    });

    it("should handle multiple parallel tool calls", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "get_weather",
                input: { location: "NYC" },
              },
              {
                type: "tool_use",
                id: "toolu_2",
                name: "get_weather",
                input: { location: "LA" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: "72°F",
              },
              {
                type: "tool_result",
                tool_use_id: "toolu_2",
                content: "85°F",
              },
            ],
          },
        ],
      };

      const result = translateRequest(request);

      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].role).toBe("assistant");
      expect((result.messages[0] as any).tool_calls).toHaveLength(2);
      expect(result.messages[1]).toEqual({
        role: "tool",
        content: "72°F",
        tool_call_id: "toolu_1",
      });
      expect(result.messages[2]).toEqual({
        role: "tool",
        content: "85°F",
        tool_call_id: "toolu_2",
      });
    });

    it("should handle disable_parallel_tool_use", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello" }],
        tools: [
          {
            name: "test_tool",
            description: "A test tool",
            input_schema: {
              type: "object",
              properties: {},
            },
          },
        ],
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
      };

      const result = translateRequest(request);

      expect(result.parallel_tool_calls).toBe(false);
    });
  });

  describe("Optional parameters", () => {
    it("should translate temperature", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.7,
      };

      const result = translateRequest(request);

      expect(result.temperature).toBe(0.7);
    });

    it("should translate top_p", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello" }],
        top_p: 0.9,
      };

      const result = translateRequest(request);

      expect(result.top_p).toBe(0.9);
    });

    it("should translate stop_sequences", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello" }],
        stop_sequences: ["STOP", "END"],
      };

      const result = translateRequest(request);

      expect(result.stop).toEqual(["STOP", "END"]);
    });

    it("should translate stream flag", () => {
      const request: Anthropic.MessagesRequest = {
        model: "claude-3-sonnet-20240229",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
      };

      const result = translateRequest(request);

      expect(result.stream).toBe(true);
    });
  });
});
