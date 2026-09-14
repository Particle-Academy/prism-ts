/**
 * A URL with every trailing slash removed, in one pass.
 *
 * Not `replace(/\/+$/, '')`. That pattern retries from every slash in a run and
 * rescans the rest of it each time, so a string of slashes followed by anything
 * else costs quadratic time: 40,000 slashes take about a second. The PHP
 * reference uses `rtrim($url, '/')`, which is linear.
 */
export function withoutTrailingSlashes(url: string): string {
  let end = url.length;

  while (end > 0 && url.charCodeAt(end - 1) === 0x2f) {
    end -= 1;
  }

  return url.slice(0, end);
}
