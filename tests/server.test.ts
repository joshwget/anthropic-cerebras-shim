import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../src/server.js";
import type { Express } from "express";
import http from "http";

describe("Server", () => {
  let app: Express;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    app = createServer({ cerebrasApiKey: "test-api-key" });
    server = app.listen(0);
    const address = server.address();
    if (typeof address === "object" && address !== null) {
      baseUrl = `http://localhost:${address.port}`;
    }
  });

  afterAll(() => {
    server.close();
  });

  describe("Health endpoint", () => {
    it("should return ok status", async () => {
      const response = await fetch(`${baseUrl}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ status: "ok" });
    });
  });

  describe("Messages endpoint validation", () => {
    it("should require model field", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 1024,
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.type).toBe("error");
      expect(data.error.type).toBe("invalid_request_error");
      expect(data.error.message).toContain("model");
    });

    it("should require max_tokens field", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.type).toBe("error");
      expect(data.error.type).toBe("invalid_request_error");
      expect(data.error.message).toContain("max_tokens");
    });

    it("should require messages field", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 1024,
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.type).toBe("error");
      expect(data.error.type).toBe("invalid_request_error");
      expect(data.error.message).toContain("messages");
    });

    it("should require non-empty messages array", async () => {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-sonnet-20240229",
          max_tokens: 1024,
          messages: [],
        }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.type).toBe("error");
    });
  });
});
