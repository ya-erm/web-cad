// Runs from an extracted deployment ZIP, with no SDK packages installed beside it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const directory = path.resolve(process.argv[2]);
const requirePackage = createRequire(path.join(directory, 'index.js'));
const {handler} = requirePackage('./index.js');
let response = await handler({path:'/health',httpMethod:'GET'},{});
assert.equal(response.statusCode,200);
assert.deepEqual(JSON.parse(response.body),{status:'ok'});
response = await handler({path:'/auth/session',httpMethod:'GET'},{});
assert.equal(response.statusCode,200);
assert.deepEqual(JSON.parse(response.body),{user:null});
response = await handler({path:'/cloud/list',httpMethod:'GET'},{});
assert.equal(response.statusCode,401);
const sdk = await import(pathToFileURL(path.join(directory,'vendor.mjs')).href);
for (const name of ['Driver','AccessTokenCredentialsProvider','query','S3Client','getSignedUrl']) assert.equal(typeof sdk[name],'function',name);
const client = new sdk.S3Client({endpoint:'https://storage.yandexcloud.net',region:'ru-central1',
  credentials:{accessKeyId:'packaging-test',secretAccessKey:'local-test-only'},requestChecksumCalculation:'WHEN_REQUIRED'});
try {
  const signed = new URL(await sdk.getSignedUrl(client,new sdk.GetObjectCommand({Bucket:'webcad-documents',Key:'packaging-test'}),{expiresIn:600}));
  assert.equal(signed.searchParams.get('X-Amz-Algorithm'),'AWS4-HMAC-SHA256');
  assert.equal(signed.searchParams.get('X-Amz-Expires'),'600');
  assert.match(signed.searchParams.get('X-Amz-Signature'),/^[a-f0-9]{64}$/);
} finally {client.destroy();}
console.log('PASS isolated deployment package: entry point, health, session, authorization guard, SDK exports and S3 signing');
