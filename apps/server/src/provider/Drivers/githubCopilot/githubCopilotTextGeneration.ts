/**
 * githubCopilotTextGeneration — commit-message / PR / branch / title
 * generation for the Copilot driver, backed by a single chat completion.
 *
 * @module provider/Drivers/githubCopilot/githubCopilotTextGeneration
 */
import { TextGenerationError } from "@vipercode/contracts";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";

import type { TextGenerationShape } from "../../../textGeneration/TextGeneration.ts";
import { createChatCompletion } from "./githubCopilotApi.ts";
import type { GitHubCopilotAuthShape } from "./githubCopilotAuth.ts";

type Operation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

const slugifyBranch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "viper-change";

export const makeGitHubCopilotTextGeneration = (input: {
  readonly auth: GitHubCopilotAuthShape;
  readonly model: string;
}): Effect.Effect<TextGenerationShape, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;

    const complete = (operation: Operation, prompt: string): Effect.Effect<string, TextGenerationError> =>
      input.auth.getSessionToken.pipe(
        Effect.flatMap((token) =>
          createChatCompletion(token, {
            model: input.model,
            messages: [{ role: "user", content: prompt }],
          }),
        ),
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.map(
          (response) =>
            response.choices.find((choice) => choice.message?.content)?.message?.content?.trim() ??
            "",
        ),
        Effect.catchAll(() =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: "GitHub Copilot text generation failed.",
            }),
          ),
        ),
      );

    return {
      generateCommitMessage: (request) =>
        complete(
          "generateCommitMessage",
          `Write a concise Conventional Commit message for these staged changes. ` +
            `Reply with the subject line, then a blank line, then an optional body.\n\n` +
            `Summary:\n${request.stagedSummary}\n\nDiff:\n${request.stagedPatch}`,
        ).pipe(
          Effect.map((text) => {
            const [subject = "", ...rest] = text.split("\n");
            return { subject: subject.trim(), body: rest.join("\n").trim() };
          }),
        ),
      generatePrContent: (request) =>
        complete(
          "generatePrContent",
          `Write a pull request title and body for the change from ${request.baseBranch} to ` +
            `${request.headBranch}. First line is the title, the rest is the body.\n\n` +
            `Commits:\n${request.commitSummary}\n\nDiff summary:\n${request.diffSummary}`,
        ).pipe(
          Effect.map((text) => {
            const [title = "", ...rest] = text.split("\n");
            return { title: title.trim(), body: rest.join("\n").trim() };
          }),
        ),
      generateBranchName: (request) =>
        complete(
          "generateBranchName",
          `Suggest a short kebab-case git branch name (no spaces) for: ${request.message}`,
        ).pipe(Effect.map((text) => ({ branch: slugifyBranch(text.split("\n")[0] ?? text) }))),
      generateThreadTitle: (request) =>
        complete(
          "generateThreadTitle",
          `Write a 3-6 word title (no quotes) summarizing this request: ${request.message}`,
        ).pipe(Effect.map((text) => ({ title: text.split("\n")[0]?.trim() || "New thread" }))),
    } satisfies TextGenerationShape;
  });
