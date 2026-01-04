import { Storage } from '@google-cloud/storage';
import sharp from 'sharp';
import { err, getErrorMessage, ok, type Result } from '@intexuraos/common-core';
import type {
  ImageStorage,
  ImageUrls,
  StorageError,
  UploadOptions,
} from '../../domain/ports/index.js';

const THUMBNAIL_MAX_EDGE = 256;
const JPEG_QUALITY = 80;

export class GcsImageStorage implements ImageStorage {
  private readonly storage: Storage;
  private readonly bucketName: string;
  private readonly publicBaseUrl: string;

  constructor(bucketName: string, publicBaseUrl?: string) {
    this.storage = new Storage();
    this.bucketName = bucketName;
    this.publicBaseUrl = publicBaseUrl ?? `https://storage.googleapis.com/${bucketName}`;
  }

  async upload(
    id: string,
    imageData: Buffer,
    options?: UploadOptions
  ): Promise<Result<ImageUrls, StorageError>> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const { fullPath, thumbPath } = this.buildPaths(id, options?.slug);

      const fullFile = bucket.file(fullPath);
      await fullFile.save(imageData, {
        contentType: 'image/png',
        resumable: false,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });

      const thumbnailBuffer = await this.createThumbnail(imageData);

      const thumbFile = bucket.file(thumbPath);
      await thumbFile.save(thumbnailBuffer, {
        contentType: 'image/jpeg',
        resumable: false,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });

      return ok({
        thumbnailUrl: `${this.publicBaseUrl}/${thumbPath}`,
        fullSizeUrl: `${this.publicBaseUrl}/${fullPath}`,
      });
    } catch (error) {
      return err({
        code: 'STORAGE_ERROR',
        message: `Failed to upload image: ${getErrorMessage(error, 'Unknown GCS error')}`,
      });
    }
  }

  async delete(id: string, slug?: string): Promise<Result<void, StorageError>> {
    try {
      const bucket = this.storage.bucket(this.bucketName);
      const { fullPath, thumbPath } = this.buildPaths(id, slug);
      await Promise.all([
        bucket.file(fullPath).delete({ ignoreNotFound: true }),
        bucket.file(thumbPath).delete({ ignoreNotFound: true }),
      ]);
      return ok(undefined);
    } catch (error) {
      return err({
        code: 'STORAGE_ERROR',
        message: `Failed to delete image: ${getErrorMessage(error, 'Unknown GCS error')}`,
      });
    }
  }

  private buildPaths(id: string, slug?: string): { fullPath: string; thumbPath: string } {
    if (slug !== undefined) {
      return {
        fullPath: `images/${id}-${slug}.png`,
        thumbPath: `images/${id}-${slug}-thumb.jpg`,
      };
    }
    return {
      fullPath: `images/${id}/full.png`,
      thumbPath: `images/${id}/thumbnail.jpg`,
    };
  }

  private async createThumbnail(imageData: Buffer): Promise<Buffer> {
    const image = sharp(imageData);
    const metadata = await image.metadata();

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    const resizeOptions =
      width > height ? { width: THUMBNAIL_MAX_EDGE } : { height: THUMBNAIL_MAX_EDGE };

    return await image.resize(resizeOptions).jpeg({ quality: JPEG_QUALITY }).toBuffer();
  }
}

export function createGcsImageStorage(bucketName: string, publicBaseUrl?: string): ImageStorage {
  return new GcsImageStorage(bucketName, publicBaseUrl);
}
