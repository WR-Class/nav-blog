// 1. Import utilities from `astro:content`
import { z, defineCollection } from 'astro:content';

// 2. Define your collection(s)
const blogCollection = defineCollection({
  schema: z.object({
    draft: z.boolean(),
    title: z.string(),
    snippet: z.string(),
    image: z.object({
      src: z.string(),
      alt: z.string(),
    }),
    publishDate: z.coerce.date(),
    author: z.string().default('Astroship'),
    category: z.string(),
    tags: z.array(z.string()),
  }),
});

// 3. Export a single `collections` object to register your collection(s)
//    博客内容已于 2026-08-08 迁移到 Cloudflare KV（见 functions/api/blog.js）
//    src/content/blog/ 和 src/content/blog-en/ 下的 md 文件迁移后应删除
//    此处保留集合定义仅为兼容性，迁移完成后可安全删除整个 content 目录
export const collections = {
  'blog': blogCollection,
  'blog-en': blogCollection,
};
