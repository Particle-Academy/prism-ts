import { PrismError } from '../errors.js';
import { StructuredMode } from '../enums.js';
import type { Schema } from '../schema/index.js';
import { TextPendingRequest } from '../text/pending-request.js';
import { StructuredRequest } from './request.js';
import type { StructuredResponse } from './response.js';

export type StructuredResponseCallback = (
  pending: StructuredPendingRequest,
  response: StructuredResponse,
) => void | Promise<void>;

/**
 * The fluent builder for structured output.
 *
 * EXTENDS the text builder, so every method that shapes a request — `using`,
 * `withMessages`, `usingTemperature`, `withTools`, all of them — is the same
 * method with the same spelling, not a parallel set that drifts. A caller
 * moving a call from `Prism.text()` to `Prism.structured()` changes two lines.
 */
export class StructuredPendingRequest extends TextPendingRequest {
  #schema: Schema | null = null;

  #mode: StructuredMode = StructuredMode.Auto;

  withSchema(schema: Schema): this {
    this.#schema = schema;

    return this;
  }

  usingStructuredMode(mode: StructuredMode): this {
    this.#mode = mode;

    return this;
  }

  /**
   * @throws PrismError code `missing_schema` when no schema was set — a
   *   structured request without one is a text request that has not said so,
   *   and defaulting to "any object" would return something that parses and
   *   means nothing.
   */
  override toRequest(): StructuredRequest {
    if (this.#schema === null) {
      throw PrismError.missingSchema();
    }

    return new StructuredRequest({
      ...this.requestOptions(),
      schema: this.#schema,
      mode: this.#mode,
    });
  }

  async asStructured(callback?: StructuredResponseCallback): Promise<StructuredResponse> {
    const response = await this.provider().structured(this.toRequest());

    if (callback !== undefined) {
      await callback(this, response);
    }

    return response;
  }
}
