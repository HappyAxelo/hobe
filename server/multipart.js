// Streaming multipart/form-data parser — just enough for one video file plus
// text fields, without buffering the whole upload in memory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function parseUpload(req, tmpDir, { maxBytes = 200 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const m = req.headers['content-type']?.match(/boundary=(?:"([^"]+)"|([^;]+))/);
    if (!m) return reject(Object.assign(new Error('Expected multipart/form-data'), { status: 400 }));
    const boundary = Buffer.from(`\r\n--${m[1] ?? m[2]}`);

    fs.mkdirSync(tmpDir, { recursive: true });
    const fields = {};
    let file = null;          // { path, filename, size, stream }
    let buf = Buffer.from('\r\n'); // prime so the first boundary (without leading CRLF) matches
    let current = null;       // { isFile, name, stream? , chunks? }
    let total = 0;
    let done = false;

    const fail = (err) => {
      if (done) return; done = true;
      current?.stream?.destroy();
      if (file) fs.rm(file.path, { force: true }, () => {});
      req.destroy();
      reject(err);
    };

    const finishPart = (data) => {
      if (!current) return;
      if (current.isFile) current.stream.write(data), current.stream.end(), file && (file.size += data.length);
      else fields[current.name] = Buffer.concat([...current.chunks, data]).toString('utf8');
      current = null;
    };

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) return fail(Object.assign(new Error('Upload too large'), { status: 413 }));
      buf = Buffer.concat([buf, chunk]);

      let idx;
      while ((idx = buf.indexOf(boundary)) !== -1) {
        finishPart(buf.subarray(0, idx));
        buf = buf.subarray(idx + boundary.length);
        if (buf.subarray(0, 2).toString() === '--') { done = true; break; } // final boundary
        const headerEnd = buf.indexOf('\r\n\r\n');
        if (headerEnd === -1) { buf = Buffer.concat([boundary, buf]); return; } // need more data
        const headers = buf.subarray(0, headerEnd).toString('utf8');
        buf = buf.subarray(headerEnd + 4);
        const name = headers.match(/name="([^"]*)"/)?.[1] ?? 'field';
        const filename = headers.match(/filename="([^"]*)"/)?.[1];
        if (filename !== undefined) {
          const tmpPath = path.join(tmpDir, `up-${crypto.randomUUID()}`);
          const stream = fs.createWriteStream(tmpPath);
          file = { path: tmpPath, filename, size: 0 };
          current = { isFile: true, name, stream };
        } else {
          current = { isFile: false, name, chunks: [] };
        }
      }
      // Stream the safe portion of the buffer (keep a boundary-length tail)
      if (!done && current && buf.length > boundary.length) {
        const safe = buf.subarray(0, buf.length - boundary.length);
        if (current.isFile) { current.stream.write(safe); file.size += safe.length; }
        else current.chunks.push(Buffer.from(safe));
        buf = buf.subarray(buf.length - boundary.length);
      }
    });

    req.on('end', () => {
      if (done || !current) {
        const finish = () => resolve({ fields, file });
        if (file?.path && current === null) finish();
        else if (current?.isFile) { current.stream.end(finish); current = null; }
        else { finishPart(Buffer.alloc(0)); finish(); }
      } else {
        fail(Object.assign(new Error('Truncated upload'), { status: 400 }));
      }
    });
    req.on('error', fail);
  });
}
