# anthropic-cerebras-shim

An API shim that translates Anthropic Claude API requests to Cerebras API requests. This allows applications built for the Claude API to work seamlessly with Cerebras's models.

## Features

- Full Anthropic Messages API compatibility
- Streaming and non-streaming responses
- Tool/function calling support
- Image support (base64 and URL)
- Multi-turn conversation support
- Interactive CLI with agent capabilities

## Installation

```bash
npm install
npm run build
```

## Configuration

Create a `.env` file in the project root:

```
CEREBRAS_API_KEY=your_cerebras_api_key
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CEREBRAS_API_KEY` | Yes | - | Your Cerebras API key |
| `PORT` | No | 3000 | Server port (API mode) |
| `LOG_LEVEL` | No | info | Logging level (debug, info, warn, error) |

## CLI Usage

The CLI provides an interactive chat interface powered by Cerebras through the Anthropic API shim.

### Running the CLI

Development mode:
```bash
npm run cli
```

Production mode (after building):
```bash
npm run build
npx cerebras-claude
```

Or install globally:
```bash
npm link
cerebras-claude
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `/exit`, `/quit`, `/q` | Exit the CLI |
| `/help`, `/h`, `/?` | Show help message |
| `/clear`, `/reset`, `/new` | Start a fresh conversation |
| `/tools` | List available tools |

### Available Tools

The CLI exposes these tools to the agent:
- `Read` - Read files
- `Write` - Write files
- `Edit` - Edit files
- `Bash` - Execute shell commands
- `Glob` - Find files by pattern
- `Grep` - Search file contents
- `WebSearch` - Search the web
- `WebFetch` - Fetch web pages
- `Task` - Run background tasks

## API Server Usage

Run the shim as an HTTP server to proxy Anthropic API requests to Cerebras.

### Starting the Server

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

### API Endpoints

#### Health Check
```
GET /health
```
Returns `{"status": "ok"}`

#### Messages API
```
POST /v1/messages
```
Anthropic Messages API compatible endpoint. All Anthropic model names are automatically mapped to the Cerebras model.

### Example Usage

Point your Anthropic SDK to the shim:

```javascript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://localhost:3000",
  apiKey: "any-value", // Not validated by the shim
});

const response = await client.messages.create({
  model: "claude-sonnet-4-20250514", // Mapped to Cerebras model
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
```

## Running Tests

The test suite uses Vitest and includes unit tests, integration tests, and agent SDK tests.

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Test Structure

| File | Description |
|------|-------------|
| `tests/server.test.ts` | Server endpoint and validation tests |
| `tests/request-translator.test.ts` | Request translation unit tests |
| `tests/response-translator.test.ts` | Response translation unit tests |
| `tests/integration.test.ts` | End-to-end API integration tests |
| `tests/agent-sdk.test.ts` | Anthropic Agent SDK integration tests |

### Integration Tests

Integration tests require a valid `CEREBRAS_API_KEY` in your environment. Tests are automatically skipped if the key is not set.

## Project Structure

```
├── src/
│   ├── index.ts              # Server entry point
│   ├── cli.ts                # CLI entry point
│   ├── server.ts             # Express HTTP server
│   ├── cerebras-client.ts    # Cerebras API client
│   ├── logger.ts             # Structured logging
│   └── translators/
│       ├── request.ts        # Anthropic → Cerebras translation
│       └── response.ts       # Cerebras → Anthropic translation
├── tests/                    # Test files
├── dist/                     # Compiled output
└── package.json
```

## License

ISC
