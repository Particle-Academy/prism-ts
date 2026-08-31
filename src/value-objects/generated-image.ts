import type { JsonObject } from '../json.js';

/**
 * One generated image.
 *
 * EITHER a url or base64, never both, and the type cannot say so — OpenAI
 * returns whichever the request asked for, and a caller has to check. The
 * reference models this as a `Media` subclass; this port has no Media
 * hierarchy yet, so it stands alone rather than inheriting a base that does
 * not exist. If Media arrives later, this is what moves under it.
 */
export class GeneratedImage {
  constructor(
    readonly url: string | null = null,
    readonly base64: string | null = null,
    /**
     * What the provider actually generated from.
     *
     * OpenAI rewrites prompts for safety and quality, and the rewrite is often
     * substantially different from what was asked for. Kept because a caller
     * comparing an image against its prompt is comparing it against THIS one,
     * not the one they typed.
     */
    readonly revisedPrompt: string | null = null,
    readonly mimeType: string | null = null,
  ) {}

  hasRevisedPrompt(): boolean {
    return this.revisedPrompt !== null;
  }

  toObject(): JsonObject {
    return {
      url: this.url,
      base64: this.base64,
      revised_prompt: this.revisedPrompt,
      mime_type: this.mimeType,
    };
  }
}
