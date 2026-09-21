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
};

const metadataPlugin = {
  name: "sekibanmawashi-site-metadata",
  transformIndexHtml(html: string): string {
    return html
      .replaceAll("%SITE_TITLE%", siteMetadata.title)
      .replaceAll("%SITE_DESCRIPTION%", siteMetadata.description)
      .replaceAll("%SITE_URL%", siteMetadata.publicUrl)
      .replaceAll("%SITE_LAB_URL%", siteMetadata.labUrl);
  },
};

// Local development and CI keep the root URL.  A deliberate R6 Pages build
// opts in to the repository subpath; no workflow calls this automatically.
export default defineConfig({
  base: process.env.PAGES_BUILD === "1" ? "/sekibanmawashi/" : "/",
  plugins: [metadataPlugin],
});
