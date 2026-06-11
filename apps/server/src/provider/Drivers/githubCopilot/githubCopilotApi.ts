/**
 * githubCopilotApi — stateless HTTP calls + schemas for the GitHub Copilot
 * OAuth device flow, token exchange, model catalog, and chat completions.
 *
 * Pipeline (all functions require only `HttpClient.HttpClient`):
 *   1. {@link requestDeviceCode}      POST github.com/login/device/code
 *   2. {@link pollDeviceAccessToken}  POST github.com/login/oauth/access_token
 *                                     (grant_type=urn:...:device_code) → ghu_ token
 *   3. {@link exchangeCopilotToken}   GET  api.github.com/copilot_internal/v2/token
 *                                     (Authorization: token ghu_…) → session token
 *   4. {@link fetchCopilotModels}     GET  api.githubcopilot.com/models
 *   5. {@link createChatCompletion}   POST api.githubcopilot.com/chat/completions
 *
 * The Copilot entitlement is tied to the OAuth *client id*, not to a GitHub
 * scope — `Iv1.b507a08c87ecfe98` is GitHub's own first-party Copilot client.
 * We request `read:user` (the value GitHub's editors send); the granted
 * Copilot session token comes from the v2/token exchange in step 3.
 *
 * @module provider/Drivers/githubCopilot/githubCopilotApi
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

// ── Endpoints + constants ─────────────────────────────────────────────

/** GitHub's first-party Copilot OAuth client id (public, used by every editor). */
export const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
/** Copilot entitlement rides on the client id; this is the scope editors send. */
export const COPILOT_OAUTH_SCOPE = "read:user";

export const DEVICE_CODE_URL = "https://github.com/login/device/code";
export const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const COPILOT_TOKEN_EXCHANGE_URL = "https://api.github.com/copilot_internal/v2/token";
export const COPILOT_API_BASE = "https://api.githubcopilot.com";
export const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/**
 * Editor-identification headers the Copilot backend expects. The values
 * mirror what the VS Code Copilot Chat extension sends so the API treats us
 * as a supported integration.
 */
export const COPILOT_EDITOR_HEADERS: Readonly<Record<string, string>> = {
  "Editor-Version": "vscode/1.96.0",
  "Editor-Plugin-Version": "copilot-chat/0.23.0",
  "Copilot-Integration-Id": "vscode-chat",
  "User-Agent": "GitHubCopilotChat/0.23.0",
};

const applyHeaders =
  (headers: Readonly<Record<string, string>>) => (request: HttpClientRequest.HttpClientRequest) =>
    Object.entries(headers).reduce(
      (acc, [key, value]) => HttpClientRequest.setHeader(key, value)(acc),
      request,
    );

// ── Schemas ───────────────────────────────────────────────────────────

export const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  expires_in: Schema.Number,
  interval: Schema.Number,
});
export type DeviceCodeResponse = typeof DeviceCodeResponse.Type;

/**
 * GitHub returns HTTP 200 for both the pending and success states of the
 * device-code poll, distinguished by which fields are present. We decode a
 * permissive union of optionals and branch in {@link pollDeviceAccessToken}.
 */
export const DeviceAccessTokenResponse = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  token_type: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
  interval: Schema.optional(Schema.Number),
});
export type DeviceAccessTokenResponse = typeof DeviceAccessTokenResponse.Type;

export const CopilotTokenResponse = Schema.Struct({
  token: Schema.String,
  /** Unix seconds at which the session token expires. */
  expires_at: Schema.optional(Schema.Number),
  /** Seconds after which the client should proactively refresh. */
  refresh_in: Schema.optional(Schema.Number),
});
export type CopilotTokenResponse = typeof CopilotTokenResponse.Type;

export const CopilotModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  vendor: Schema.optional(Schema.String),
});
export type CopilotModel = typeof CopilotModel.Type;

export const CopilotModelsResponse = Schema.Struct({
  data: Schema.Array(CopilotModel),
});
export type CopilotModelsResponse = typeof CopilotModelsResponse.Type;

export const ChatCompletionMessage = Schema.Struct({
  role: Schema.String,
  content: Schema.NullOr(Schema.String),
});
export type ChatCompletionMessage = typeof ChatCompletionMessage.Type;

export const ChatCompletionChoice = Schema.Struct({
  index: Schema.optional(Schema.Number),
  message: Schema.optional(ChatCompletionMessage),
  finish_reason: Schema.optional(Schema.NullOr(Schema.String)),
});

export const ChatCompletionResponse = Schema.Struct({
  id: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  choices: Schema.Array(ChatCompletionChoice),
});
export type ChatCompletionResponse = typeof ChatCompletionResponse.Type;

/** OpenAI-compatible chat completion request payload. */
export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<{ readonly role: string; readonly content: string }>;
  readonly temperature?: number;
  readonly stream?: boolean;
  readonly [key: string]: unknown;
}

// ── Step 1: device code ───────────────────────────────────────────────

export const requestDeviceCode: Effect.Effect<
  DeviceCodeResponse,
  unknown,
  HttpClient.HttpClient
> = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const request = yield* HttpClientRequest.post(DEVICE_CODE_URL).pipe(
    HttpClientRequest.setHeader("Accept", "application/json"),
    applyHeaders(COPILOT_EDITOR_HEADERS),
    HttpClientRequest.bodyJson({
      client_id: COPILOT_CLIENT_ID,
      scope: COPILOT_OAUTH_SCOPE,
    }),
  );
  const response = yield* httpClient.execute(request);
  const ok = yield* HttpClientResponse.filterStatusOk(response);
  return yield* HttpClientResponse.schemaBodyJson(DeviceCodeResponse)(ok);
});

// ── Step 2: poll for the ghu_ OAuth token ─────────────────────────────

export type DevicePollResult =
  | { readonly _tag: "authorized"; readonly accessToken: string }
  | { readonly _tag: "pending" }
  | { readonly _tag: "slow_down"; readonly interval: number }
  | { readonly _tag: "error"; readonly error: string; readonly description: string | undefined };

export const pollDeviceAccessToken = (
  deviceCode: string,
): Effect.Effect<DevicePollResult, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const request = yield* HttpClientRequest.post(ACCESS_TOKEN_URL).pipe(
      HttpClientRequest.setHeader("Accept", "application/json"),
      applyHeaders(COPILOT_EDITOR_HEADERS),
      HttpClientRequest.bodyJson({
        client_id: COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: DEVICE_CODE_GRANT_TYPE,
      }),
    );
    const response = yield* httpClient.execute(request);
    const body = yield* HttpClientResponse.schemaBodyJson(DeviceAccessTokenResponse)(response);

    if (body.access_token) {
      return { _tag: "authorized", accessToken: body.access_token } as const;
    }
    switch (body.error) {
      case "authorization_pending":
        return { _tag: "pending" } as const;
      case "slow_down":
        return { _tag: "slow_down", interval: body.interval ?? 5 } as const;
      default:
        return {
          _tag: "error",
          error: body.error ?? "unknown_error",
          description: body.error_description,
        } as const;
    }
  });

// ── Step 3: exchange ghu_ token for a Copilot session token ───────────

export const exchangeCopilotToken = (
  githubOAuthToken: string,
): Effect.Effect<CopilotTokenResponse, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(COPILOT_TOKEN_EXCHANGE_URL).pipe(
      HttpClientRequest.setHeader("Authorization", `token ${githubOAuthToken}`),
      HttpClientRequest.setHeader("Accept", "application/json"),
      applyHeaders(COPILOT_EDITOR_HEADERS),
    );
    const response = yield* httpClient.execute(request);
    const ok = yield* HttpClientResponse.filterStatusOk(response);
    return yield* HttpClientResponse.schemaBodyJson(CopilotTokenResponse)(ok);
  });

// ── Step 4: model catalog ─────────────────────────────────────────────

export const fetchCopilotModels = (
  copilotToken: string,
): Effect.Effect<ReadonlyArray<CopilotModel>, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(`${COPILOT_API_BASE}/models`).pipe(
      HttpClientRequest.bearerToken(copilotToken),
      HttpClientRequest.setHeader("Accept", "application/json"),
      applyHeaders(COPILOT_EDITOR_HEADERS),
    );
    const response = yield* httpClient.execute(request);
    const ok = yield* HttpClientResponse.filterStatusOk(response);
    const body = yield* HttpClientResponse.schemaBodyJson(CopilotModelsResponse)(ok);
    return body.data;
  });

// ── Step 5: chat completion (non-streaming) ───────────────────────────

export const createChatCompletion = (
  copilotToken: string,
  payload: ChatCompletionRequest,
): Effect.Effect<ChatCompletionResponse, unknown, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const request = yield* HttpClientRequest.post(`${COPILOT_API_BASE}/chat/completions`).pipe(
      HttpClientRequest.bearerToken(copilotToken),
      HttpClientRequest.setHeader("Accept", "application/json"),
      applyHeaders(COPILOT_EDITOR_HEADERS),
      HttpClientRequest.bodyJson({ ...payload, stream: false }),
    );
    const response = yield* httpClient.execute(request);
    const ok = yield* HttpClientResponse.filterStatusOk(response);
    return yield* HttpClientResponse.schemaBodyJson(ChatCompletionResponse)(ok);
  });
