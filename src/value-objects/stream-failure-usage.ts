import type { JsonObject } from '../json.js';
import { Usage } from './usage.js';

const usageFields: readonly string[] = [
  'prompt_tokens', 'completion_tokens', 'cache_write_input_tokens',
  'cache_read_input_tokens', 'thought_tokens', 'cost',
  'cache_write_5m_input_tokens', 'cache_write_1h_input_tokens',
];

/** A reported snapshot for one failed request, never a completed-turn total. */
export class StreamFailureUsage {
  readonly usage: Usage;

  readonly stepIndex: number;

  readonly reportedFields: readonly string[];

  readonly status = 'provisional';

  readonly scope = 'attempt';

  readonly includesCompletedSteps = false;

  constructor(usage: Usage, stepIndex: number, reportedFields: readonly string[]) {
    if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || reportedFields.length === 0
        || new Set(reportedFields).size !== reportedFields.length
        || reportedFields.some(field => !usageFields.includes(field))) {
      throw new TypeError('Invalid stream failure usage fields.');
    }
    this.usage = Object.freeze(new Usage(
      usage.promptTokens, usage.completionTokens, usage.cacheWriteInputTokens,
      usage.cacheReadInputTokens, usage.thoughtTokens, usage.cost,
      usage.cacheWrite5mInputTokens, usage.cacheWrite1hInputTokens,
    ));
    this.stepIndex = stepIndex;
    this.reportedFields = Object.freeze([...reportedFields]);
    Object.freeze(this);
  }

  toObject(): JsonObject {
    return {
      usage: this.usage.toObject(),
      status: this.status,
      scope: this.scope,
      step_index: this.stepIndex,
      reported_fields: [...this.reportedFields],
      includes_completed_steps: this.includesCompletedSteps,
    };
  }

  toJSON(): JsonObject {
    return this.toObject();
  }
}
