# 🚀 个人导航博客

一个结合**导航链接**和**博客功能**的现代化网站模板。

## ✨ 功能特点

- 📌 **导航链接** - 分类展示常用网站
- 📝 **博客系统** - Markdown 写作，自动分类
- 🎨 **响应式设计** - 手机、平板、电脑完美适配
- ⚡ **极速加载** - 静态生成，CDN 加速

## 📸 预览

![预览](https://via.placeholder.com/800x400/4F46E5/FFFFFF?text=Navigation+Blog)

## 🚀 快速部署

### Cloudflare Pages（推荐）

1. 克隆项目到 GitHub
2. 访问 https://dash.cloudflare.com/pages
3. 连接你的 GitHub 仓库
4. 构建命令：`npm run build`
5. 输出目录：`dist`

### Vercel

```bash
npx vercel
```

## 🛠️ 技术栈

- [Astro](https://astro.build/) - 静态站点生成器
- [Tailwind CSS](https://tailwindcss.com/) - 样式框架
- [astro-navbar](https://github.com/takamichi007/astro-navbar) - 导航组件

## 📝 自定义

### 修改导航链接

编辑 `src/pages/index.astro` 中的 `navLinks` 数组。

### 添加博客文章

在 `src/content/blog/` 创建新的 Markdown 文件。

## 📄 许可证

MIT
