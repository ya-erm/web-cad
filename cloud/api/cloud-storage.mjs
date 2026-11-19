import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, getSignedUrl } from './vendor.mjs';
import { CloudError } from './cloud-store.mjs';

/** @param {string} bucket @param {string} token @param {AbortSignal} signal */
export function createCloudStorage(bucket, token, signal) {
  const client = new S3Client({
    endpoint: 'https://storage.yandexcloud.net',
    region: 'ru-central1',
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? '' },
  });
  /** @param {string} user @param {any} upload @param {string} part @param {boolean} pending */
  const key = (user, upload, part, pending = false) =>
    `${pending ? 'uploads' : 'documents'}/${user}/${upload.documentId}/${upload.id}/${part}`;
  /** @param {string} object @param {string} method */
  const iam = async (object, method = 'HEAD') => {
    const response = await fetch(`https://storage.yandexcloud.net/${bucket}/${object}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new CloudError(409, 'upload_incomplete');
    }
    return response;
  };
  return {
    /** @param {string} user @param {any} upload */
    async prepare(user, upload) {
      const projectUrl = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket, Key: key(user, upload, 'project.gz', true), ContentLength: upload.size }),
        { expiresIn: 600 },
      );
      const thumbnailUrl = upload.thumbnailSize
        ? await getSignedUrl(
            client,
            new PutObjectCommand({ Bucket: bucket, Key: key(user, upload, 'thumbnail', true), ContentLength: upload.thumbnailSize }),
            { expiresIn: 600 },
          )
        : null;
      return { projectUrl, thumbnailUrl };
    },
    /** @param {string} user @param {any} upload */
    async seal(user, upload) {
      for (const [part, size] of [
        ['project.gz', upload.size],
        ['thumbnail', upload.thumbnailSize],
      ]) {
        if (!size) continue;
        const source = key(user, upload, /** @type {string} */ (part), true);
        const head = await iam(source);
        if (Number(head.headers.get('content-length')) !== size) throw new CloudError(409, 'upload_size_mismatch');
        // Copy out of the URL's writable prefix before publishing. Reusing the upload URL cannot alter the document.
        await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: key(user, upload, /** @type {string} */ (part)),
            CopySource: `${bucket}/${source}`,
            CopySourceIfMatch: head.headers.get('etag') ?? undefined,
          }),
          { abortSignal: signal },
        );
      }
    },
    /** @param {string} user @param {any} doc @param {boolean} thumbnail */
    async download(user, doc, thumbnail = false) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key(user, { documentId: doc.id, id: doc.revision }, thumbnail ? 'thumbnail' : 'project.gz'),
        }),
        { expiresIn: 600 },
      );
    },
    close() {
      client.destroy();
    },
  };
}
