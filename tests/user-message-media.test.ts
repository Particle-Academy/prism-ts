import { describe, expect, it } from 'vitest';
import {
  Audio,
  Document,
  Image,
  PrismError,
  Text,
  UserMessage,
  Video,
  messageFromObject,
  partFromObject,
} from '../src/index.js';
import { mapMessages as mapAnthropic } from '../src/providers/anthropic/maps/message-map.js';
import { mapMessages as mapMistral } from '../src/providers/mistral/maps/message-map.js';
import { mapMessages as mapOpenAI } from '../src/providers/openai/maps/message-map.js';

// base64 of the five bytes "hello" — the payload every part in this file
// carries, whatever kind it is dressed as.
const HELLO = 'aGVsbG8=';

function image(): Image {
  return Image.fromBase64(HELLO, 'image/png');
}

describe('UserMessage parts', () => {
  it('separates the part kinds, and text() reads only the text', () => {
    const message = new UserMessage('look at this', [
      image(),
      Document.fromUrl('https://example.test/spec.pdf'),
      Audio.fromUrl('https://example.test/clip.mp3'),
      Video.fromUrl('https://example.test/clip.mp4'),
    ]);

    // The turn's own content is the only text part, appended last by the
    // constructor. A `.map(part => part.text)` over everything would put the
    // string "undefined" in front of the model for each of the other four.
    expect(message.text()).toBe('look at this');
    expect(message.images()).toHaveLength(1);
    expect(message.documents()).toHaveLength(1);
    expect(message.audios()).toHaveLength(1);
    expect(message.videos()).toHaveLength(1);
  });

  it('media() returns every non-text part, images and documents included', () => {
    // Reads narrower than it is, and matches the reference: its filter tests
    // `Audio || Video || Media` and the first two are redundant, because both
    // extend Media. So "media" means "not text".
    const message = new UserMessage('hi', [image(), Document.fromUrl('https://example.test/a.pdf')]);

    expect(message.media()).toHaveLength(2);
    expect(message.media().every((part) => !(part instanceof Text))).toBe(true);
  });

  it('keeps several text parts in the order they were given, with the content last', () => {
    const message = new UserMessage('and this', [new Text('first '), image()]);

    expect(message.text()).toBe('first and this');
  });
});

describe('part serialization', () => {
  it('leaves a text part exactly as the reference and the corpus pin it', () => {
    // No `kind`. The conformance corpus (rtp-0001, every openai-text-response
    // row) pins this byte for byte and the PHP reference emits the same, so a
    // discriminator here would break parity on the one part type all three
    // implementations share.
    expect(new Text('hi').toObject()).toEqual({ text: 'hi' });
  });

  it('discriminates the payload kinds, which are otherwise identical', () => {
    expect(image().toObject()).toMatchObject({ kind: 'image' });
    expect(Audio.fromBase64(HELLO, 'audio/mpeg').toObject()).toMatchObject({ kind: 'audio' });
    expect(Video.fromBase64(HELLO, 'video/mp4').toObject()).toMatchObject({ kind: 'video' });
    expect(Document.fromUrl('https://example.test/a.pdf').toObject()).toMatchObject({ kind: 'document' });
  });

  it('reads a part with no kind as text, so already-stored messages still load', () => {
    expect(partFromObject({ text: 'stored before media existed' })).toBeInstanceOf(Text);
  });

  it('refuses a part with neither a kind nor text rather than guessing', () => {
    expect(() => partFromObject({ url: 'https://example.test/a.png' })).toThrowError(PrismError);
    expect(() => partFromObject({ kind: 'hologram' })).toThrowError(/hologram/);
  });

  it('serializes raw bytes as base64, so a local file survives the round trip', () => {
    // `toObject()` calls `base64()` rather than reading the field. A payload
    // built from raw content has bytes and an empty base64 field until
    // something asks, so reading the field would store a full image as
    // `base64: null` and rehydrate an empty one — silently.
    const raw = Image.fromRawContent(new TextEncoder().encode('hello'), 'image/png');

    expect(raw.toObject().base64).toBe(HELLO);
  });

  it('round-trips a user message carrying every part kind', () => {
    const original = new UserMessage('describe these', [
      Image.fromUrl('https://example.test/a.png', 'image/png'),
      Document.fromChunks(['one', 'two'], 'Notes'),
      Audio.fromFileId('file_123'),
    ]);

    const restored = messageFromObject(original.toObject());

    expect(restored).toBeInstanceOf(UserMessage);
    expect(restored.toObject()).toEqual(original.toObject());

    const message = restored as UserMessage;
    expect(message.text()).toBe('describe these');
    expect(message.images()[0]?.url).toBe('https://example.test/a.png');
    expect(message.documents()[0]?.chunks()).toEqual(['one', 'two']);
    expect(message.documents()[0]?.documentTitle()).toBe('Notes');
    expect(message.audios()[0]?.fileId()).toBe('file_123');
  });

  it('does not duplicate the turn text when a media part is last', () => {
    // The constructor appends `Text(content)`, so `fromObject` drops a trailing
    // text part that matches. It must not drop a trailing MEDIA part, and the
    // old check — which compared `.text` on whatever was last — read undefined
    // off an image and kept it by accident rather than by rule.
    const original = new UserMessage('hi', [image()]);
    const restored = messageFromObject(original.toObject()) as UserMessage;

    expect(restored.text()).toBe('hi');
    expect(restored.images()).toHaveLength(1);
    expect(restored.additionalContent).toHaveLength(2);
  });
});

describe('rehydrating a stored part', () => {
  it('drops a field that is not a string rather than carrying it to the provider', () => {
    // What arrives here is whatever a CONSUMER stored — a database row, a
    // replayed thread — so it is not this package's own output by the time it
    // comes back. An unchecked `file_id` of the wrong type would reach the
    // provider payload unexamined.
    const restored = partFromObject({
      kind: 'image',
      url: { evil: true },
      file_id: 42,
      mime_type: ['image/png'],
    }) as Image;

    expect(restored.url).toBeNull();
    expect(restored.fileId()).toBeNull();
    expect(restored.mimeType()).toBeNull();
  });
});

describe('Document', () => {
  it('takes a title through titled(), not through a factory argument', () => {
    // The reference threads the title as the second positional argument of
    // every factory, where the Media base means the mime type — so
    // `Document::fromUrl($url, 'application/pdf')` sets the TITLE to
    // "application/pdf". Both are strings, so nothing catches it.
    const document = Document.fromUrl('https://example.test/a.pdf', 'application/pdf').titled('Spec');

    expect(document.mimeType()).toBe('application/pdf');
    expect(document.documentTitle()).toBe('Spec');
  });

  it('carries text as a text/plain document', () => {
    const document = Document.fromText('hello', 'Greeting');

    expect(document.mimeType()).toBe('text/plain');
    expect(document.base64()).toBe(HELLO);
    expect(document.isChunks()).toBe(false);
  });
});

describe('Mistral media mapping', () => {
  it('wraps an image url in an object, the chat-completions shape', () => {
    const [message] = mapMistral([new UserMessage('what is this', [Image.fromUrl('https://example.test/a.png')])], []);

    expect(message?.content).toEqual([
      { type: 'text', text: 'what is this' },
      { type: 'image_url', image_url: { url: 'https://example.test/a.png' } },
    ]);
  });

  it('inlines bytes as a data uri', () => {
    const [message] = mapMistral([new UserMessage('what is this', [image()])], []);

    expect(message?.content).toContainEqual({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${HELLO}` },
    });
  });

  it('sends a document as a url and its name', () => {
    const document = Document.fromUrl('https://example.test/spec.pdf').titled('Spec');
    const [message] = mapMistral([new UserMessage('read this', [document])], []);

    expect(message?.content).toContainEqual({
      type: 'document_url',
      document_url: 'https://example.test/spec.pdf',
      document_name: 'Spec',
    });
  });

  it('refuses a document that is only bytes, because Mistral fetches it itself', () => {
    const document = Document.fromText('hello', 'Notes');

    expect(() => mapMistral([new UserMessage('read this', [document])], [])).toThrowError(/url only/);
  });

  it('refuses an image with no mime type rather than sending data:;base64,', () => {
    // Accepted by the provider, then rejected as the wrong kind of file — the
    // failure lands far from its cause.
    const untyped = Image.fromRawContent(new TextEncoder().encode('hello'));

    expect(() => mapMistral([new UserMessage('what is this', [untyped])], [])).toThrowError(/mime type/);
  });
});

describe('OpenAI media mapping', () => {
  it('sends an image url as a bare string, not an object', () => {
    const items = mapOpenAI([new UserMessage('what is this', [Image.fromUrl('https://example.test/a.png')])]);

    expect(items[0]).toMatchObject({
      content: [
        { type: 'input_text', text: 'what is this' },
        { type: 'input_image', image_url: 'https://example.test/a.png' },
      ],
    });
  });

  it('prefers a file id over a url', () => {
    const items = mapOpenAI([new UserMessage('what is this', [Image.fromFileId('file_1')])]);

    expect(items[0]).toMatchObject({ content: [{}, { type: 'input_image', file_id: 'file_1' }] });
  });

  it('names an inline document, since OpenAI parses by the filename extension', () => {
    const items = mapOpenAI([new UserMessage('read this', [Document.fromText('hello', 'notes.txt')])]);

    expect(items[0]).toMatchObject({
      content: [{}, { type: 'input_file', filename: 'notes.txt', file_data: `data:text/plain;base64,${HELLO}` }],
    });
  });

  it('falls back to the name "document" when there is no title', () => {
    const items = mapOpenAI([new UserMessage('read this', [Document.fromText('hello')])]);

    expect(items[0]).toMatchObject({ content: [{}, { filename: 'document' }] });
  });

  it('refuses chunks, which only Anthropic can carry', () => {
    const chunked = Document.fromChunks(['one'], 'Notes');

    expect(() => mapOpenAI([new UserMessage('read this', [chunked])])).toThrowError(/not pre-split chunks/);
  });
});

describe('Anthropic media mapping', () => {
  it('nests the payload in a source block whose own type says where it came from', () => {
    const items = mapAnthropic([new UserMessage('what is this', [image()])]);

    expect(items[0]).toMatchObject({
      content: [
        { type: 'text', text: 'what is this' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: HELLO } },
      ],
    });
  });

  it('sends a url image as a url source, not as fetched bytes', () => {
    const items = mapAnthropic([new UserMessage('what is this', [Image.fromUrl('https://example.test/a.png')])]);

    expect(items[0]).toMatchObject({
      content: [{}, { type: 'image', source: { type: 'url', url: 'https://example.test/a.png' } }],
    });
  });

  it('sends chunks as a content source, one text block each', () => {
    const items = mapAnthropic([new UserMessage('read this', [Document.fromChunks(['one', 'two'], 'Notes')])]);

    expect(items[0]).toMatchObject({
      content: [
        {},
        {
          type: 'document',
          title: 'Notes',
          source: {
            type: 'content',
            content: [
              { type: 'text', text: 'one' },
              { type: 'text', text: 'two' },
            ],
          },
        },
      ],
    });
  });

  it('sends a text document as text, so citations point at readable content', () => {
    const items = mapAnthropic([new UserMessage('read this', [Document.fromText('hello', 'Notes')])]);

    expect(items[0]).toMatchObject({
      content: [{}, { source: { type: 'text', media_type: 'text/plain', data: 'hello' } }],
    });
  });

  it('refuses a text document whose bytes are not valid UTF-8, by name', () => {
    // The default TextDecoder replaces every invalid byte with U+FFFD, so this
    // would have reached the model as text peppered with replacement characters
    // — and Anthropic cites INTO that content. `prism-py` raised on the same
    // input, so the two ports disagreed on one stored document.
    const notUtf8 = Document.fromRawContent(new Uint8Array([0xff, 0xfe, 0x00]), 'text/plain');

    expect(() => mapAnthropic([new UserMessage('read this', [notUtf8])])).toThrowError(/valid UTF-8/);
  });

  it('omits the title rather than sending null', () => {
    const items = mapAnthropic([new UserMessage('read this', [Document.fromUrl('https://example.test/a.pdf')])]);
    const block = (items[0] as { content: Record<string, unknown>[] }).content[1];

    expect(block).not.toHaveProperty('title');
  });
});

describe('every provider maps the same message', () => {
  it('carries an image to all three, in three different spellings', () => {
    // The point of G-16: the gap was in the MESSAGE TYPES, so closing it lights
    // up three providers at once. Each spells an image differently, which is
    // exactly why the maps could not be shared.
    const message = new UserMessage('what is this', [Image.fromUrl('https://example.test/a.png')]);

    const mistral = JSON.stringify(mapMistral([message], []));
    const openai = JSON.stringify(mapOpenAI([message]));
    const anthropic = JSON.stringify(mapAnthropic([message]));

    expect(mistral).toContain('"image_url":{"url":"https://example.test/a.png"}');
    expect(openai).toContain('"image_url":"https://example.test/a.png"');
    expect(anthropic).toContain('"source":{"type":"url","url":"https://example.test/a.png"}');
  });
});
