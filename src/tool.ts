import type { JsonObject, JsonValue } from './json.js';
import { getByPath } from './json.js';
import type { Schema } from './schema/index.js';
import { BooleanSchema, NumberSchema, StringSchema } from './schema/index.js';

export type ToolHandler = (args: JsonObject) => string | Promise<string>;

/**
 * A tool the model may call.
 *
 * Declaration ORDER matters twice over: the order parameters are added decides
 * the key order of the JSON Schema `properties` object, and the order tools are
 * added decides the order they reach the model, which influences selection.
 * Both are backed by insertion-ordered structures on purpose.
 */
export class Tool {
  #name = '';

  #description = '';

  #parameters = new Map<string, Schema>();

  #requiredParameters: string[] = [];

  #providerOptions: JsonObject = {};

  #handler: ToolHandler | null = null;

  as(name: string): this {
    this.#name = name;

    return this;
  }

  for(description: string): this {
    this.#description = description;

    return this;
  }

  using(handler: ToolHandler): this {
    this.#handler = handler;

    return this;
  }

  withParameter(parameter: Schema, required = true): this {
    this.#parameters.set(parameter.name, parameter);

    if (required) {
      this.#requiredParameters.push(parameter.name);
    }

    return this;
  }

  withStringParameter(name: string, description: string, required = true): this {
    return this.withParameter(new StringSchema(name, description), required);
  }

  withNumberParameter(name: string, description: string, required = true): this {
    return this.withParameter(new NumberSchema(name, description), required);
  }

  withBooleanParameter(name: string, description: string, required = true): this {
    return this.withParameter(new BooleanSchema(name, description), required);
  }

  withProviderOptions(options: JsonObject = {}): this {
    this.#providerOptions = { ...options };

    return this;
  }

  name(): string {
    return this.#name;
  }

  description(): string {
    return this.#description;
  }

  parameters(): ReadonlyMap<string, Schema> {
    return this.#parameters;
  }

  hasParameters(): boolean {
    return this.#parameters.size > 0;
  }

  requiredParameters(): readonly string[] {
    return this.#requiredParameters;
  }

  /** The `properties` block of the tool's JSON Schema, in declaration order. */
  parametersAsObject(): JsonObject {
    const properties: JsonObject = {};

    for (const [name, schema] of this.#parameters) {
      properties[name] = schema.toObject();
    }

    return properties;
  }

  providerOptions(): JsonObject;
  providerOptions(path: string): JsonValue | undefined;
  providerOptions(path?: string): JsonObject | JsonValue | undefined {
    return path === undefined ? this.#providerOptions : getByPath(this.#providerOptions, path);
  }

  hasHandler(): boolean {
    return this.#handler !== null;
  }

  async handle(args: JsonObject): Promise<string> {
    if (this.#handler === null) {
      throw new TypeError(`Tool handler not defined for tool: ${this.#name}`);
    }

    return this.#handler(args);
  }
}
