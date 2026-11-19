// Dependency facade for local development. Packaging replaces this file with the bundled SDKs.
// Business logic remains in the adjacent source files, unchanged and readable in the cloud editor.
export { Driver } from '@ydbjs/core';
export { AccessTokenCredentialsProvider } from '@ydbjs/auth/access-token';
export { query } from '@ydbjs/query';
export { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
export { getSignedUrl } from '@aws-sdk/s3-request-presigner';
