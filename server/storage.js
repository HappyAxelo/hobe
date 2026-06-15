// Object storage adapter. Two modes, chosen automatically:
//
//   'local' (default)  — files live on disk under data/videos and data/avatars,
//                        served by the app. This is the original behaviour and
//                        what the test suite and `npm start` use. No env needed.
//
//   'r2'               — files live in a Cloudflare R2 bucket (S3-compatible).
//                        Switched on by setting the four R2_* env vars below.
//                        Keeps the project's zero-npm-dependency rule: the S3
//                        SigV4 signature is built with node:crypto and uploads
//                        use the built-in fetch(). No aws-sdk.
//
// Why R2: the free tier is 10 GB with zero egress fees, so video bandwidth
// doesn't cost anything, and the app box no longer needs a big disk.
import crypto from 'node:crypto';

const R2 = {
  accountId: process.env.R2_ACCOUNT_ID || '',
  accessKey: process.env.R2_ACCESS_KEY_ID || '',
  secretKey: process.env.R2_SECRET_ACCESS_KEY || '',
  bucket: process.env.R2_BUCKET || '',
  // Public base URL for the bucket (r2.dev dev URL or a custom domain). When
  // set, media requests are 302-redirected here so bandwidth never touches the
  // app server. When empty, the app proxies bytes itself (uses app egress).
  publicBase: (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, ''),
  region: 'auto',
  service: 's3',
};

export const storageMode =
  R2.accountId && R2.accessKey && R2.secretKey && R2.bucket ? 'r2' : 'local';

const host = () => `${R2.accountId}.r2.cloudflarestorage.com`;
const hmac = (key, str) => crypto.createHmac('sha256', key).update(str).digest();
const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Build an AWS Signature V4 request for the given key. Returns the absolute URL
// and the headers to send. The canonical URI is reused verbatim for the actual
// request so the signature always matches.
function sign({ method, key, body = Buffer.alloc(0), contentType, range }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = method === 'GET' ? 'UNSIGNED-PAYLOAD' : sha256hex(body);

  const headers = {
    host: host(),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  if (range) headers['range'] = range;

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join('');

  // Keys are plain ASCII (vNNN.mp4, uNN-NNN.jpg), but encode each segment to be safe.
  const canonicalUri =
    `/${R2.bucket}/` + key.split('/').map(encodeURIComponent).join('/');

  const canonicalRequest = [
    method,
    canonicalUri,
    '', // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${R2.region}/${R2.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256hex(Buffer.from(canonicalRequest)),
  ].join('\n');

  let signingKey = hmac('AWS4' + R2.secretKey, dateStamp);
  signingKey = hmac(signingKey, R2.region);
  signingKey = hmac(signingKey, R2.service);
  signingKey = hmac(signingKey, 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${R2.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: `https://${host()}${canonicalUri}`, headers };
}

export async function putObject(key, body, contentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const { url, headers } = sign({ method: 'PUT', key, body: buf, contentType });
  const res = await fetch(url, { method: 'PUT', headers, body: buf });
  if (!res.ok) throw new Error(`R2 PUT ${key} failed: ${res.status} ${await res.text()}`);
}

export async function deleteObject(key) {
  const { url, headers } = sign({ method: 'DELETE', key });
  const res = await fetch(url, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 DELETE ${key} failed: ${res.status}`);
  }
}

// Returns the public URL for a key, or null if no public base is configured.
export function publicUrl(key) {
  return R2.publicBase ? `${R2.publicBase}/${key.split('/').map(encodeURIComponent).join('/')}` : null;
}

// Signed GET, optionally with a Range header for video seeking. Returns the raw
// fetch Response so the caller can stream it through.
export async function getObject(key, range) {
  const { url, headers } = sign({ method: 'GET', key, range });
  return fetch(url, { method: 'GET', headers });
}
