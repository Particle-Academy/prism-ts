import type { JsonObject } from '../../json.js';
import { Media } from './media.js';

/** An audio payload — a recording to transcribe, or speech that was generated. */
export class Audio extends Media {
  readonly kind = 'audio' as const;

  static fromObject(object: JsonObject): Audio {
    return Audio.restoreInto(new Audio(...Audio.constructorArgs(object)), object);
  }
}
