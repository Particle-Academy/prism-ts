import type { JsonObject } from '../json.js';
import { Image } from './media/image.js';

/**
 * An image a provider generated, and what it generated from.
 *
 * EXTENDS `Image` now that a Media base exists. It previously restated the
 * url / base64 / mimeType triple itself, which was correct while it was the
 * only binary type in the port and wrong the moment audio arrived — three
 * standalone copies is how a package ends up with three answers to "is this a
 * file". This was the first, so it moved first.
 *
 * What it adds is the one thing a generated image has and a supplied one does
 * not: the prompt the provider actually used.
 */
export class GeneratedImage extends Image {
  constructor(
    url: string | null = null,
    base64: string | null = null,
    /**
     * What the provider actually generated from.
     *
     * OpenAI rewrites prompts for safety and quality, often substantially. Kept
     * because a caller comparing an image against its prompt is comparing it
     * against THIS one, not the one they typed.
     */
    readonly revisedPrompt: string | null = null,
    mimeType: string | null = null,
  ) {
    super(url, base64, mimeType);
  }

  hasRevisedPrompt(): boolean {
    return this.revisedPrompt !== null;
  }

  override toObject(): JsonObject {
    return { ...super.toObject(), revised_prompt: this.revisedPrompt };
  }
}
