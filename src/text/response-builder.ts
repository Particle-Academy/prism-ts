import { AssistantMessage } from '../value-objects/messages/index.js';
import { Usage } from '../value-objects/usage.js';
import { TextResponse } from './response.js';
import type { TextStep } from './step.js';

/**
 * Accumulates steps and folds them into one response.
 *
 * The response reports the FINAL step's text, finish reason and metadata, but
 * usage SUMMED across every step — a multi-step generation costs the sum of its
 * round trips, not the last one.
 */
export class ResponseBuilder {
  readonly #steps: TextStep[] = [];

  get steps(): readonly TextStep[] {
    return this.#steps;
  }

  addStep(step: TextStep): this {
    this.#steps.push(step);

    return this;
  }

  toResponse(): TextResponse {
    const finalStep = this.#steps.at(-1);

    if (finalStep === undefined) {
      throw new TypeError('Cannot build a response before any step has been added.');
    }

    // The conversation the caller gets back already includes the reply, so it
    // can be fed straight into the next request.
    const messages = [
      ...finalStep.messages,
      new AssistantMessage(finalStep.text, finalStep.toolCalls, finalStep.additionalContent),
    ];

    return new TextResponse({
      steps: [...this.#steps],
      text: finalStep.text,
      finishReason: finalStep.finishReason,
      toolCalls: finalStep.toolCalls,
      toolResults: finalStep.toolResults,
      usage: this.#totalUsage(),
      meta: finalStep.meta,
      messages,
      additionalContent: finalStep.additionalContent,
      raw: finalStep.raw,
    });
  }

  #totalUsage(): Usage {
    const sum = (pick: (step: TextStep) => number | null): number =>
      this.#steps.reduce((total, step) => total + (pick(step) ?? 0), 0);

    // A nullable total stays null unless at least one step reported the field:
    // summing "unreported" to zero would claim a fact nobody stated.
    const sumIfAnyReported = (pick: (step: TextStep) => number | null): number | null =>
      this.#steps.some((step) => pick(step) !== null) ? sum(pick) : null;

    return new Usage(
      sum((step) => step.usage.promptTokens),
      sum((step) => step.usage.completionTokens),
      sumIfAnyReported((step) => step.usage.cacheWriteInputTokens),
      sumIfAnyReported((step) => step.usage.cacheReadInputTokens),
      sumIfAnyReported((step) => step.usage.thoughtTokens),
      sumIfAnyReported((step) => step.usage.cost),
    );
  }
}
