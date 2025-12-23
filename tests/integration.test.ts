import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../src/server.js";
import type { Express } from "express";
import http from "http";
import "dotenv/config";

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;

describe.skipIf(!CEREBRAS_API_KEY)("Integration Tests", () => {
  let app: Express;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    app = createServer({ cerebrasApiKey: CEREBRAS_API_KEY! });
    server = app.listen(0);
    const address = server.address();
    if (typeof address === "object" && address !== null) {
      baseUrl = `http://localhost:${address.port}`;
    }
  });

  afterAll(() => {
    server.close();
  });

  describe("Basic message completion", () => {
    // Note: zai-glm-4.6 is a reasoning model that needs more tokens to complete reasoning + response
    it("should complete a simple message", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 2000, // Need enough tokens for reasoning + response
          messages: [{ role: "user", content: "Say 'hello' and nothing else" }],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.type).toBe("message");
      expect(data.role).toBe("assistant");
      expect(data.model).toBe("claude-3-sonnet-20240229");
      expect(data.content).toHaveLength(1);
      expect(data.content[0].type).toBe("text");
      expect(data.content[0].text.toLowerCase()).toContain("hello");
      expect(data.stop_reason).toBe("end_turn");
      expect(data.usage.input_tokens).toBeGreaterThan(0);
      expect(data.usage.output_tokens).toBeGreaterThan(0);
    });

    it("should handle multi-turn conversation", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 2000,
          messages: [
            { role: "user", content: "My name is Alice." },
            { role: "assistant", content: "Nice to meet you, Alice!" },
            { role: "user", content: "What is my name? Reply with just the name." },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.content[0].text.toLowerCase()).toContain("alice");
    });

    it("should respect system prompt", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 2000,
          system: "You are a pirate. Always respond like a pirate would. Use pirate vocabulary like 'ahoy', 'matey', 'arr', etc.",
          messages: [{ role: "user", content: "Hello!" }],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const text = data.content[0].text.toLowerCase();
      expect(
        text.includes("ahoy") ||
        text.includes("arr") ||
        text.includes("matey") ||
        text.includes("pirate") ||
        text.includes("ye") ||
        text.includes("sailor") ||
        text.includes("captain") ||
        text.includes("ship")
      ).toBe(true);
    });

    it("should respect max_tokens limit", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 5,
          messages: [{ role: "user", content: "Write a very long essay about the history of computers." }],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should have very short output due to token limit
      expect(data.stop_reason).toBe("max_tokens");
      expect(data.usage.output_tokens).toBeLessThanOrEqual(10); // Allow some variance
    });
  });

  describe("Tool use / Function calling", () => {
    it("should make a tool call when appropriate", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 500,
          messages: [
            { role: "user", content: "What's the weather like in New York right now?" },
          ],
          tools: [
            {
              name: "get_weather",
              description: "Get the current weather for a location",
              input_schema: {
                type: "object",
                properties: {
                  location: {
                    type: "string",
                    description: "The city and state, e.g. San Francisco, CA",
                  },
                },
                required: ["location"],
              },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should have a tool_use block
      const toolUseBlock = data.content.find((block: any) => block.type === "tool_use");
      expect(toolUseBlock).toBeDefined();
      expect(toolUseBlock.name).toBe("get_weather");
      expect(toolUseBlock.input.location.toLowerCase()).toContain("new york");
      expect(data.stop_reason).toBe("tool_use");
    });

    it("should process tool result and continue", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 500,
          messages: [
            { role: "user", content: "What's the weather in NYC?" },
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
                  content: "72°F and sunny with light clouds",
                },
              ],
            },
          ],
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
                },
                required: ["location"],
              },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should have a text response summarizing the weather
      const textBlock = data.content.find((block: any) => block.type === "text");
      expect(textBlock).toBeDefined();
      expect(
        textBlock.text.includes("72") ||
        textBlock.text.toLowerCase().includes("sunny") ||
        textBlock.text.toLowerCase().includes("weather")
      ).toBe(true);
      expect(data.stop_reason).toBe("end_turn");
    });

    it("should use specific tool when tool_choice is set", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 500,
          messages: [
            { role: "user", content: "Hello, how are you?" }, // Shouldn't normally need weather
          ],
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
                },
                required: ["location"],
              },
            },
          ],
          tool_choice: { type: "tool", name: "get_weather" },
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should force use of the tool
      const toolUseBlock = data.content.find((block: any) => block.type === "tool_use");
      expect(toolUseBlock).toBeDefined();
      expect(toolUseBlock.name).toBe("get_weather");
    });

    it("should not use tools when tool_choice is none", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 2000, // Need more tokens for reasoning model
          messages: [
            { role: "user", content: "What's the weather in NYC? Just say you don't know." },
          ],
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
                },
                required: ["location"],
              },
            },
          ],
          tool_choice: { type: "none" },
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should NOT have tool use
      const toolUseBlock = data.content.find((block: any) => block.type === "tool_use");
      expect(toolUseBlock).toBeUndefined();
      expect(data.stop_reason).toBe("end_turn");
    });

    it("should handle multiple tools", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 500,
          messages: [
            { role: "user", content: "What time is it in London and what's the weather there?" },
          ],
          tools: [
            {
              name: "get_weather",
              description: "Get the current weather for a location",
              input_schema: {
                type: "object",
                properties: {
                  location: { type: "string", description: "The city" },
                },
                required: ["location"],
              },
            },
            {
              name: "get_time",
              description: "Get the current time in a timezone",
              input_schema: {
                type: "object",
                properties: {
                  timezone: { type: "string", description: "The timezone, e.g. Europe/London" },
                },
                required: ["timezone"],
              },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should use at least one tool
      const toolUseBlocks = data.content.filter((block: any) => block.type === "tool_use");
      expect(toolUseBlocks.length).toBeGreaterThanOrEqual(1);
      expect(data.stop_reason).toBe("tool_use");
    });

    it("should handle tool with complex nested input", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 500,
          messages: [
            { role: "user", content: "Search for Italian restaurants under $50 with 4+ rating in NYC" },
          ],
          tools: [
            {
              name: "search_restaurants",
              description: "Search for restaurants with various filters",
              input_schema: {
                type: "object",
                properties: {
                  query: { type: "string", description: "Search query" },
                  location: { type: "string", description: "City or area" },
                  filters: {
                    type: "object",
                    properties: {
                      cuisine: { type: "string" },
                      max_price: { type: "number" },
                      min_rating: { type: "number" },
                    },
                  },
                },
                required: ["query", "location"],
              },
            },
          ],
          tool_choice: { type: "any" },
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const toolUseBlock = data.content.find((block: any) => block.type === "tool_use");
      expect(toolUseBlock).toBeDefined();
      expect(toolUseBlock.name).toBe("search_restaurants");
      expect(toolUseBlock.input).toHaveProperty("location");
    });

    it("should handle tool error results", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 500,
          messages: [
            { role: "user", content: "What's the weather in NYC?" },
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
                  content: "API rate limit exceeded. Please try again later.",
                  is_error: true,
                },
              ],
            },
          ],
          tools: [
            {
              name: "get_weather",
              description: "Get the current weather for a location",
              input_schema: {
                type: "object",
                properties: {
                  location: { type: "string" },
                },
                required: ["location"],
              },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should acknowledge the error in its response
      const textBlock = data.content.find((block: any) => block.type === "text");
      expect(textBlock).toBeDefined();
      // The model should acknowledge the error somehow
      expect(data.stop_reason).toBe("end_turn");
    });
  });

  describe("Streaming", () => {
    it("should stream a simple response", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 2000, // Need more tokens for reasoning model
          stream: true,
          messages: [{ role: "user", content: "Say 'hello world'" }],
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/event-stream");

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const events: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data && data !== "[DONE]") {
              try {
                events.push(JSON.parse(data));
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      }

      // Should have message_start event
      expect(events.some(e => e.type === "message_start")).toBe(true);

      // Should have content_block_start event
      expect(events.some(e => e.type === "content_block_start")).toBe(true);

      // Should have text_delta events
      expect(events.some(e => e.type === "content_block_delta" && e.delta?.type === "text_delta")).toBe(true);

      // Should have message_stop event
      expect(events.some(e => e.type === "message_stop")).toBe(true);
    });

    it("should stream tool calls", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 500,
          stream: true,
          messages: [{ role: "user", content: "What's the weather in Paris?" }],
          tools: [
            {
              name: "get_weather",
              description: "Get the current weather for a location",
              input_schema: {
                type: "object",
                properties: {
                  location: { type: "string", description: "The city" },
                },
                required: ["location"],
              },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const events: any[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data && data !== "[DONE]") {
              try {
                events.push(JSON.parse(data));
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      }

      // Should have tool_use content block
      const toolBlockStart = events.find(
        e => e.type === "content_block_start" && e.content_block?.type === "tool_use"
      );
      expect(toolBlockStart).toBeDefined();
      expect(toolBlockStart.content_block.name).toBe("get_weather");

      // Should have input_json_delta events
      expect(events.some(e => e.type === "content_block_delta" && e.delta?.type === "input_json_delta")).toBe(true);

      // Should have message_delta with tool_use stop_reason
      const messageDelta = events.find(e => e.type === "message_delta");
      expect(messageDelta).toBeDefined();
      expect(messageDelta.delta.stop_reason).toBe("tool_use");
    });
  });
});
