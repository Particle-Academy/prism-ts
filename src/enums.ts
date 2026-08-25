/**
 * Why a finish reason has a wire value and a tool choice does not.
 *
 * `FinishReason` is a BACKED enum in the reference: its values reach `toArray()`
 * and therefore reach anything that persists a response. They are pinned here.
 *
 * `ToolChoice` is a PURE enum in the reference — the members carry no value at
 * all, and the mapping to a wire string lives in each provider (OpenAI turns
 * `Any` into `"required"`). Modelling it as a string enum here would invite a
 * port to serialize the member directly and send `"any"`, which OpenAI rejects.
 * The numeric backing keeps the members opaque, and it is also what lets
 * `withToolChoice()` tell a tool NAME (a string) from a choice (a number).
 */

export enum FinishReason {
  Stop = 'stop',
  Length = 'length',
  ContentFilter = 'content-filter',
  ToolCalls = 'tool-calls',
  Pause = 'pause',
  Refusal = 'refusal',
  Error = 'error',
  Other = 'other',
  Unknown = 'unknown',
}

export enum ToolChoice {
  Auto = 1,
  Any = 2,
  None = 3,
}

const FINISH_REASONS: readonly FinishReason[] = Object.values(FinishReason);

/** Rebuild a `FinishReason` from its wire value; unknown values become `Unknown`. */
export function finishReasonFromValue(value: unknown): FinishReason {
  return FINISH_REASONS.find((reason) => reason === value) ?? FinishReason.Unknown;
}

/** Rebuild a `ToolChoice` from its member NAME (`"Auto"`, `"Any"`, `"None"`). */
export function toolChoiceFromName(name: string): ToolChoice {
  switch (name) {
    case 'Auto':
      return ToolChoice.Auto;
    case 'Any':
      return ToolChoice.Any;
    case 'None':
      return ToolChoice.None;
    default:
      throw new TypeError(`Unknown ToolChoice case ${name}.`);
  }
}
