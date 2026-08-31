import { Media } from './media.js';

/**
 * An image.
 *
 * Adds nothing to `Media` but a name, deliberately: an image and an audio file
 * differ in what a provider does with them, not in what they are.
 */
export class Image extends Media {}
