import type { JsonObject } from '../../json.js';
import { Media } from './media.js';

export class Video extends Media {
  readonly kind = 'video' as const;

  static fromObject(object: JsonObject): Video {
    return Video.restoreInto(new Video(...Video.constructorArgs(object)), object);
  }
}
