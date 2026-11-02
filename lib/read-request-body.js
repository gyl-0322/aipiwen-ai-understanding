'use strict';

/**
 * Read a request body once.
 *
 * The production site runner consumes the incoming stream in attachBody and
 * stores it on req.rawBody / req.body before the handler runs. A later
 * req.on('data'/'end') listener never fires, so the handler hangs until nginx
 * returns 504. Prefer those fields. Read the stream only when neither is set
 * (Vercel and other hosts that leave the stream for the handler).
 */

function tooLarge() {
  return Object.assign(new Error('BODY_TOO_LARGE'), { statusCode: 413, code: 413 });
}

function encodingOf(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value);
  if (typeof value === 'object') {
    const text = JSON.stringify(value);
    if (typeof text !== 'string') return null;
    return Buffer.from(text);
  }
  return Buffer.from(String(value));
}

function preparsedBuffer(req) {
  if (!req) return null;
  const raw = encodingOf(req.rawBody);
  if (raw && raw.length) return raw;
  const body = encodingOf(req.body);
  if (body && body.length) return body;
  if (raw || body) return Buffer.alloc(0);
  return null;
}

function readStream(req, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!req || typeof req.on !== 'function') {
      reject(Object.assign(new Error('INVALID_REQUEST_BODY'), { statusCode: 400, code: 400 }));
      return;
    }
    // Already consumed and not copied onto req.body / req.rawBody.
    if (req.readableEnded) {
      resolve(Buffer.alloc(0));
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      if (typeof req.off === 'function') {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
      } else if (typeof req.removeListener === 'function') {
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
      }
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onData = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (maxBytes != null && size > maxBytes) {
        finish(reject, tooLarge());
        if (typeof req.destroy === 'function') req.destroy();
        return;
      }
      chunks.push(buf);
    };
    const onEnd = () => finish(resolve, Buffer.concat(chunks));
    const onError = (error) => finish(reject, error);

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

async function readRawBuffer(req, maxBytes) {
  const preparsed = preparsedBuffer(req);
  if (preparsed) {
    if (maxBytes != null && preparsed.length > maxBytes) throw tooLarge();
    return preparsed;
  }
  return readStream(req, maxBytes);
}

async function readRawText(req, maxBytes) {
  const buffer = await readRawBuffer(req, maxBytes);
  return buffer.toString('utf8');
}

module.exports = {
  preparsedBuffer,
  readRawBuffer,
  readRawText,
};
