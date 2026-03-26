/**
 * 图片URL工具函数
 */

/**
 * 修复图片URL，处理相对路径和绝对路径
 */
export function fixImageUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http") || url.startsWith("data:")) return url;
  return `${import.meta.env.VITE_API_BASE_URL || ""}${url}`;
}

/**
 * 获取图片URL，优先使用 image_url（COS/CDN 完整 URL）
 * @param item 包含 image_url 或 local_path 的对象
 * @returns 处理后的图片URL
 */
export function getImageUrl(item: any): string {
  if (!item) return "";

  // 优先使用 image_url（可能是完整的 COS/CDN URL）
  if (item.image_url) {
    return fixImageUrl(item.image_url);
  }

  // 回退到 local_path（本地存储模式）
  if (item.local_path) {
    if (item.local_path.startsWith("http")) {
      return item.local_path;
    }
    return `/static/${item.local_path}`;
  }

  return "";
}

/**
 * 检查是否有图片
 */
export function hasImage(item: any): boolean {
  return !!(item?.local_path || item?.image_url);
}

/**
 * 获取视频URL，优先使用 local_path
 * @param item 包含 local_path 或 video_url 或 url 的对象
 * @returns 处理后的视频URL
 */
export function getVideoUrl(item: any): string {
  if (!item) return "";

  // 优先使用 video_url（可能是完整的 COS/CDN URL）
  if (item.video_url) {
    return fixImageUrl(item.video_url);
  }

  // 回退到 url（用于 assets）
  if (item.url) {
    return fixImageUrl(item.url);
  }

  // 回退到 local_path（本地存储模式）
  if (item.local_path) {
    if (item.local_path.startsWith("http")) {
      return item.local_path;
    }
    return `/static/${item.local_path}`;
  }

  return "";
}

/**
 * 检查是否有视频
 */
export function hasVideo(item: any): boolean {
  return !!(item?.local_path || item?.video_url || item?.url);
}
