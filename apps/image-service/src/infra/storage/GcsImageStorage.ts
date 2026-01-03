import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type { ImageStorage, ImageUrls, StorageError } from '../../domain/ports/index.js';

const THUMBNAIL_MAX_EDGE = 256;
const JPEG_QUALITY = 80;

export class GcsImageStorage implements ImageStorage {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(bucketName: string) {
    this.storage = new Storage();
    this.bucketName = bucketName;
  }

  async upload(id: string, imageData: Buffer): Promise<Result<ImageUrls, StorageError>> {
    try {
      const bucket = this.storage.bucket(this.bucketName);

      const fullPath = `images/${id}/full.png`;
      const fullFile = bucket.file(fullPath);
      await fullFile.save(imageData, {
        contentType: 'image/png',
        resumable: false,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });

      const thumbnailBuffer = await this.createThumbnail(imageData);

      const thumbPath = `images/${id}/thumbnail.jpg`;
      const thumbFile = bucket.file(thumbPath);
      await thumbFile.save(thumbnailBuffer, {
        contentType: 'image/jpeg',
        resumable: false,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });

      const baseUrl = `https://storage.googleapis.com/${this.bucketName}`;

      return ok({
        thumbnailUrl: `${baseUrl}/${thumbPath}`,
        fullSizeUrl: `${baseUrl}/${fullPath}`,
      });
    } catch (error) {
      return err({
        code: 'STORAGE_ERROR',
        message: `Failed to upload image: ${getErrorMessage(error, 'Unknown GCS error')}`,
      });
    }
  }

  private async createThumbnail(imageData: Buffer): Promise<Buffer> {
    const image = sharp(imageData);
    const metadata = await image.metadata();

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    const resizeOptions = width > height ? { width: THUMBNAIL_MAX_EDGE } : { height: THUMBNAIL_MAX_EDGE };

    return await image.resize(resizeOptions).jpeg({ quality: JPEG_QUALITY }).toBuffer();
  }
}

export function createGcsImageStorage(bucketName: string): ImageStorage {
  return new GcsImageStorage(bucketName);
}
