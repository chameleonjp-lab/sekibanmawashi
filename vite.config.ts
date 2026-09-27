import { defineConfig } from "vite";
import { siteConfig } from "./site.config.ts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

const siteMetadata = {
  title: escapeHtml(siteConfig.title),
  description: escapeHtml(siteConfig.description),
  publicUrl: escapeHtml(siteConfig.publicUrl),
  labUrl: escapeHtml(siteConfig.labUrl),
  twitterCard: siteConfig.shareImageUrl ? "summary_large_image" : "summary",
  ogImage: siteConfig.shareImageUrl
    ? [
      `<meta property="og:image" content="${escapeHtml(siteConfig.shareImageUrl)}" />`,
      `<meta property="og:image:alt" content="${escapeHtml(siteConfig.shareImageAlt)}" />`,
      `<meta property="og:image:type" content="${escapeHtml(siteConfig.shareImageType)}" />`,
      `<meta property="og:image:width" content="${siteConfig.shareImageWidth}" />`,
      `<meta property="og:image:height" content="${siteConfig.shareImageHeight}" />`,
    ].join("\n    ")
    : "",
  twitterImage: siteConfig.shareImageUrl
    ? `<meta name="twitter:image" content="${escapeHtml(siteConfig.shareImageUrl)}" />\n    <meta name="twitter:image:alt" content="${escapeHtml(siteConfig.shareImageAlt)}" />`
    : "",
};

const metadataPlugin = {
  name: "sekibanmawashi-site-metadata",
  transformIndexHtml(html: string): string {
    return html
      .replaceAll("%SITE_TITLE%", siteMetadata.title)
      .replaceAll("%SITE_DESCRIPTION%", siteMetadata.description)
      .replaceAll("%SITE_URL%", siteMetadata.publicUrl)
      .replaceAll("%SITE_LAB_URL%", siteMetadata.labUrl)
      .replaceAll("%SITE_OG_IMAGE%", siteMetadata.ogImage)
      .replaceAll("%SITE_TWITTER_CARD%", siteMetadata.twitterCard)
      .replaceAll("%SITE_TWITTER_IMAGE%", siteMetadata.twitterImage);
  },
};

// Local development and CI keep the root URL.  A deliberate R6 Pages build
// opts in to the repository subpath; no workflow calls this automatically.
export default defineConfig({
  base: process.env.PAGES_BUILD === "1" ? "/sekibanmawashi/" : "/",
  build: {
    target: "es2022",
  },
  plugins: [metadataPlugin],
});
