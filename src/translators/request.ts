import * as Anthropic from "../types/anthropic.js";
import * as Cerebras from "../types/cerebras.js";
import { requestLog } from "../logger.js";

const CEREBRAS_MODEL = "zai-glm-4.6";

export function translateRequest(
  anthropicRequest: Anthropic.MessagesRequest
): Cerebras.ChatCompletionsRequest {
  requestLog.debug("Translating Anthropic request to Cerebras format", {
    anthropicModel: anthropicRequest.model,
    targetModel: CEREBRAS_MODEL,
  });

  const messages: Cerebras.ChatMessage[] = [];

  // Add system message if present
  if (anthropicRequest.system) {
    const systemContent = typeof anthropicRequest.system === "string"
      ? anthropicRequest.system
      : anthropicRequest.system.map(block => block.text).join("\n");

    messages.push({
      role: "system",
      content: systemContent,
    });
    requestLog.debug("Added system message", {
      length: systemContent.length,
    });
  }

  // Convert messages
  let userMsgCount = 0;
  let assistantMsgCount = 0;
  let toolResultCount = 0;
  let toolUseCount = 0;
  let imageCount = 0;

  for (const message of anthropicRequest.messages) {
    const converted = translateMessage(message);
    messages.push(...converted);

    // Count message types for logging
    if (message.role === "user") {
      userMsgCount++;
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === "tool_result") toolResultCount++;
          if (block.type === "image") imageCount++;
        }
      }
    } else if (message.role === "assistant") {
      assistantMsgCount++;
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === "tool_use") toolUseCount++;
        }
      }
    }
  }

  requestLog.debug("Translated messages", {
    inputMessages: anthropicRequest.messages.length,
    outputMessages: messages.length,
    userMessages: userMsgCount,
    assistantMessages: assistantMsgCount,
    toolResults: toolResultCount,
    toolUses: toolUseCount,
    images: imageCount,
  });

  // Build the request
  const request: Cerebras.ChatCompletionsRequest = {
    model: CEREBRAS_MODEL,
    messages,
    max_completion_tokens: anthropicRequest.max_tokens,
    stream: anthropicRequest.stream ?? false,
  };

  // Optional parameters
  if (anthropicRequest.temperature !== undefined) {
    request.temperature = anthropicRequest.temperature;
  }

  if (anthropicRequest.top_p !== undefined) {
    request.top_p = anthropicRequest.top_p;
  }

  if (anthropicRequest.stop_sequences) {
    request.stop = anthropicRequest.stop_sequences;
  }

  // Convert tools
  if (anthropicRequest.tools && anthropicRequest.tools.length > 0) {
    request.tools = anthropicRequest.tools.map(translateTool);
    request.tool_choice = translateToolChoice(anthropicRequest.tool_choice);

    // Handle parallel tool calls setting
    const disableParallel =
      anthropicRequest.tool_choice &&
      "disable_parallel_tool_use" in anthropicRequest.tool_choice &&
      anthropicRequest.tool_choice.disable_parallel_tool_use;

    request.parallel_tool_calls = !disableParallel;

    requestLog.debug("Translated tools", {
      toolCount: request.tools.length,
      toolNames: request.tools.map(t => t.function.name),
      toolChoice: typeof request.tool_choice === "string" ? request.tool_choice : request.tool_choice?.type,
      parallelToolCalls: request.parallel_tool_calls,
    });
  }

  requestLog.info("Request translation complete", {
    messageCount: messages.length,
    hasTools: (request.tools?.length ?? 0) > 0,
  });

  return request;
}

function translateMessage(message: Anthropic.Message): Cerebras.ChatMessage[] {
  const results: Cerebras.ChatMessage[] = [];

  if (message.role === "user") {
    // User message - handle content blocks
    if (typeof message.content === "string") {
      results.push({
        role: "user",
        content: message.content,
      });
    } else {
      // Check for tool results first - they need special handling
      const toolResults = message.content.filter(
        (block): block is Anthropic.ToolResultBlock => block.type === "tool_result"
      );

      const otherBlocks = message.content.filter(
        (block): block is Anthropic.TextBlock | Anthropic.ImageBlock =>
          block.type !== "tool_result"
      );

      // Add tool result messages
      for (const toolResult of toolResults) {
        const content = typeof toolResult.content === "string"
          ? toolResult.content
          : toolResult.content
              .filter((block): block is Anthropic.TextBlock => block.type === "text")
              .map(block => block.text)
              .join("\n");

        results.push({
          role: "tool",
          content: toolResult.is_error ? `Error: ${content}` : content,
          tool_call_id: toolResult.tool_use_id,
        });
      }

      // Add user content if there are other blocks
      if (otherBlocks.length > 0) {
        const parts: Cerebras.UserContentPart[] = [];

        for (const block of otherBlocks) {
          if (block.type === "text") {
            parts.push({
              type: "text",
              text: block.text,
            });
          } else if (block.type === "image") {
            // Convert image to URL format
            if (block.source.type === "base64" && block.source.data && block.source.media_type) {
              parts.push({
                type: "image_url",
                image_url: {
                  url: `data:${block.source.media_type};base64,${block.source.data}`,
                },
              });
            } else if (block.source.type === "url" && block.source.url) {
              parts.push({
                type: "image_url",
                image_url: {
                  url: block.source.url,
                },
              });
            }
          }
        }

        if (parts.length === 1 && parts[0].type === "text") {
          results.push({
            role: "user",
            content: parts[0].text!,
          });
        } else if (parts.length > 0) {
          results.push({
            role: "user",
            content: parts,
          });
        }
      }
    }
  } else if (message.role === "assistant") {
    // Assistant message - handle tool calls
    if (typeof message.content === "string") {
      results.push({
        role: "assistant",
        content: message.content,
      });
    } else {
      const textBlocks = message.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      const toolUseBlocks = message.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      const assistantMessage: Cerebras.AssistantMessage = {
        role: "assistant",
        content: textBlocks.length > 0
          ? textBlocks.map(b => b.text).join("\n")
          : null,
      };

      if (toolUseBlocks.length > 0) {
        assistantMessage.tool_calls = toolUseBlocks.map(block => ({
          id: block.id,
          type: "function" as const,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        }));
      }

      results.push(assistantMessage);
    }
  }

  return results;
}

function translateTool(tool: Anthropic.Tool): Cerebras.Tool {
  // Fields that Cerebras doesn't support in JSON Schema
  const UNSUPPORTED_SCHEMA_FIELDS = ["format", "pattern", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "const", "contentEncoding", "contentMediaType", "$schema", "$id", "$ref", "$defs", "definitions", "title", "examples", "default", "deprecated"];

  // Recursively clean schema and add additionalProperties: false to all object types
  const cleanSchema = (schema: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(schema)) {
      // Skip unsupported fields
      if (UNSUPPORTED_SCHEMA_FIELDS.includes(key)) {
        continue;
      }

      if (key === "properties" && typeof value === "object" && value !== null) {
        // Recursively clean nested property schemas
        const newProps: Record<string, unknown> = {};
        for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
          if (typeof propValue === "object" && propValue !== null) {
            newProps[propKey] = cleanSchema(propValue as Record<string, unknown>);
          } else {
            newProps[propKey] = propValue;
          }
        }
        result[key] = newProps;
      } else if (key === "items" && typeof value === "object" && value !== null) {
        // Recursively clean array item schemas
        result[key] = cleanSchema(value as Record<string, unknown>);
      } else if (key === "anyOf" && Array.isArray(value)) {
        // Recursively clean anyOf schemas
        result[key] = value.map((item: unknown) =>
          typeof item === "object" && item !== null
            ? cleanSchema(item as Record<string, unknown>)
            : item
        );
      } else if (key === "oneOf" && Array.isArray(value)) {
        // Recursively clean oneOf schemas
        result[key] = value.map((item: unknown) =>
          typeof item === "object" && item !== null
            ? cleanSchema(item as Record<string, unknown>)
            : item
        );
      } else if (key === "allOf" && Array.isArray(value)) {
        // Recursively clean allOf schemas
        result[key] = value.map((item: unknown) =>
          typeof item === "object" && item !== null
            ? cleanSchema(item as Record<string, unknown>)
            : item
        );
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        // Recursively clean other nested objects
        result[key] = cleanSchema(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }

    // Add additionalProperties: false to object types and ensure they have properties
    if (result.type === "object") {
      result.additionalProperties = false;
      // Ensure object types have at least empty properties
      if (!result.properties && !result.anyOf && !result.oneOf && !result.allOf) {
        result.properties = {};
      }
    }

    return result;
  };

  // Handle tools without input_schema or with empty schema
  const inputSchema = tool.input_schema;
  if (!inputSchema || !inputSchema.properties || Object.keys(inputSchema.properties).length === 0) {
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    };
  }

  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: cleanSchema({
        type: "object",
        properties: inputSchema.properties,
        required: inputSchema.required,
      }) as Cerebras.FunctionDefinition["parameters"],
    },
  };
}

function translateToolChoice(
  toolChoice?: Anthropic.ToolChoice
): Cerebras.ToolChoice {
  if (!toolChoice) {
    return "auto";
  }

  switch (toolChoice.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "tool":
      return {
        type: "function",
        function: {
          name: toolChoice.name,
        },
      };
    case "none":
      return "none";
    default:
      return "auto";
  }
}
