import { v2 as cloudinary } from 'cloudinary';
import { APP_CONFIG } from './config/appConfig';

const cloudName = APP_CONFIG.CLOUDINARY_CLOUD_NAME;
const apiKey = APP_CONFIG.CLOUDINARY_API_KEY;
const apiSecret = APP_CONFIG.CLOUDINARY_API_SECRET;

export const isCloudinaryConfigured = !!(cloudName && apiKey && apiSecret);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
}

function getPublicIdFromUrl(url: string): string | null {
  try {
    const parts = url.split('/');
    const uploadIndex = parts.indexOf('upload');
    if (uploadIndex === -1) return null;
    
    const filePart = parts.slice(uploadIndex + 1);
    if (filePart[0] && (filePart[0].startsWith('v') || /^\d+$/.test(filePart[0]))) {
      filePart.shift();
    }
    const publicIdWithExt = filePart.join('/');
    const publicId = publicIdWithExt.substring(0, publicIdWithExt.lastIndexOf('.'));
    return publicId || null;
  } catch (e) {
    return null;
  }
}

export async function deleteFromCloudinary(avatarUrl: string | null | undefined): Promise<void> {
  if (!avatarUrl || !isCloudinaryConfigured) return;
  const publicId = getPublicIdFromUrl(avatarUrl);
  if (publicId) {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      console.error('Failed to delete from Cloudinary:', error);
    }
  }
}

export async function processAvatarUpload(avatarUrl: string, existingAvatarUrl?: string | null): Promise<string> {
  if (!isCloudinaryConfigured) {
    return avatarUrl;
  }

  try {
    const uploadResult = await cloudinary.uploader.upload(avatarUrl, {
      folder: 'avatars',
      resource_type: 'image',
    });

    if (existingAvatarUrl) {
      await deleteFromCloudinary(existingAvatarUrl);
    }

    return uploadResult.secure_url;
  } catch (error) {
    console.error('Failed to process avatar upload:', error);
    return avatarUrl;
  }
}

export async function uploadImageAttachment(imageBase64: string, folder = 'task_attachments'): Promise<string> {
  if (!isCloudinaryConfigured) {
    return imageBase64;
  }

  try {
    const uploadResult = await cloudinary.uploader.upload(imageBase64, {
      folder,
      resource_type: 'image',
      quality: 70, // 30% compression
      transformation: [{ quality: 70 }],
    });

    return uploadResult.secure_url;
  } catch (error) {
    console.error('Failed to upload image attachment to Cloudinary:', error);
    return imageBase64;
  }
}
