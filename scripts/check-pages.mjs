import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const mode = process.argv[2];
const distRoot = resolve("dist");
const expectedBasePath = "/sekibanmawashi/";
const retryDelaysMs = [0, 1_000, 2_000, 4_000];

function htmlEscape(value) {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function parseSiteConfig(source) {
  const readString = (key) => {
    const match = source.match(new RegExp(`${key}:\\s*"([^"]+)"`, "u"));
    assert.ok(match, `site.config.ts must define ${key}`);
    return match[1];
  };
  const imageMatch = source.match(/shareImageUrl:\s*(null|"([^"]+)")/u);
  assert.ok(imageMatch, "site.config.ts must define shareImageUrl");
  const shareImageUrl = imageMatch[1] === "null" ? null : imageMatch[2];
  const imageAlt = shareImageUrl === null ? null : source.match(/shareImageAlt:\s*"([^"]+)"/u);
  const imageType = shareImageUrl === null ? null : source.match(/shareImageType:\s*"([^"]+)"/u);
  if (shareImageUrl !== null) {
    assert.ok(imageAlt, "site.config.ts must define shareImageAlt");
    assert.ok(imageType, "site.config.ts must define shareImageType");
  }
  const readNumber = (key) => {
    const match = source.match(new RegExp(`${key}:\\s*(\\d+)`, "u"));
    assert.ok(match, `site.config.ts must define ${key}`);
    return Number(match[1]);
  };
  return {
    title: readString("title"),
    description: readString("description"),
    publicUrl: readString("publicUrl"),
    shareImageUrl,
    shareImageAlt: imageAlt?.[1] ?? null,
    shareImageWidth: shareImageUrl === null ? null : readNumber("shareImageWidth"),
    shareImageHeight: shareImageUrl === null ? null : readNumber("shareImageHeight"),
    shareImageType: imageType?.[1] ?? null,
  };
}

async function readSiteConfig() {
  const configPath = resolve(process.env.PAGES_SITE_CONFIG ?? "site.config.ts");
  return parseSiteConfig(await readFile(configPath, "utf8"));
}

function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/\b([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function tags(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "giu"))]
    .map(([tag]) => ({ raw: tag, attributes: parseAttributes(tag) }));
}

function metadataValue(html, property) {
  const meta = tags(html, "meta").find(({ attributes }) => attributes.property === property);
  return meta?.attributes.content;
}

function namedMetadataValue(html, name) {
  const meta = tags(html, "meta").find(({ attributes }) => attributes.name === name);
  return meta?.attributes.content;
}

function assertHtmlContract(html, config) {
  const htmlTag = tags(html, "html")[0];
  assert.ok(htmlTag, "HTML document tag is present");
  assert.equal(htmlTag.attributes.lang, "ja", "document language is Japanese");
  const title = html.match(/<title>([\s\S]*?)<\/title>/iu)?.[1];
  assert.equal(title, htmlEscape(config.title), "document title matches site.config.ts");
  assert.equal(metadataValue(html, "og:title"), htmlEscape(config.title), "OG title matches site.config.ts");
  assert.equal(metadataValue(html, "og:description"), htmlEscape(config.description), "OG description matches site.config.ts");
  assert.equal(metadataValue(html, "og:url"), htmlEscape(config.publicUrl), "OG URL matches site.config.ts");
  const twitterTitle = namedMetadataValue(html, "twitter:title");
  const twitterDescription = namedMetadataValue(html, "twitter:description");
  if (twitterTitle !== undefined) assert.equal(twitterTitle, htmlEscape(config.title), "Twitter title matches site.config.ts");
  if (twitterDescription !== undefined) assert.equal(twitterDescription, htmlEscape(config.description), "Twitter description matches site.config.ts");
  const description = tags(html, "meta").find(({ attributes }) => attributes.name === "description");
  assert.equal(description?.attributes.content, htmlEscape(config.description), "description matches site.config.ts");
  const image = metadataValue(html, "og:image");
  if (config.shareImageUrl === null) {
    assert.equal(image, undefined, "unconfigured share image is absent");
    assert.equal(namedMetadataValue(html, "twitter:image"), undefined, "unconfigured Twitter image is absent");
    assert.equal(namedMetadataValue(html, "twitter:card"), "summary", "unconfigured Twitter card uses the summary format");
  } else {
    assert.equal(image, htmlEscape(config.shareImageUrl), "OG image matches site.config.ts");
    assert.equal(metadataValue(html, "og:image:alt"), htmlEscape(config.shareImageAlt), "OG image alt text matches site.config.ts");
    assert.equal(metadataValue(html, "og:image:type"), config.shareImageType, "OG image MIME type matches site.config.ts");
    assert.equal(metadataValue(html, "og:image:width"), String(config.shareImageWidth), "OG image width matches site.config.ts");
    assert.equal(metadataValue(html, "og:image:height"), String(config.shareImageHeight), "OG image height matches site.config.ts");
    assert.equal(namedMetadataValue(html, "twitter:image"), htmlEscape(config.shareImageUrl), "Twitter image matches site.config.ts");
    assert.equal(namedMetadataValue(html, "twitter:image:alt"), htmlEscape(config.shareImageAlt), "Twitter image alt text matches site.config.ts");
    assert.equal(namedMetadataValue(html, "twitter:card"), "summary_large_image", "configured Twitter image uses the large-image card format");
  }

  const scripts = tags(html, "script")
    .filter(({ attributes }) => attributes.type === "module" && attributes.src)
    .map(({ attributes }) => attributes.src);
  const links = tags(html, "link").map(({ attributes }) => attributes);
  const stylesheets = links
    .filter(({ rel }) => rel?.split(/\s+/u).includes("stylesheet"))
    .map(({ href }) => href)
    .filter(Boolean);
  const favicons = links
    .filter(({ rel }) => rel?.split(/\s+/u).includes("icon"))
    .map(({ href }) => href)
    .filter(Boolean);

  assert.ok(scripts.length > 0, "module JavaScript is referenced");
  assert.ok(stylesheets.length > 0, "CSS stylesheet is referenced");
  assert.ok(favicons.includes(`${expectedBasePath}favicon.svg`), "base-prefixed SVG favicon is referenced");
  for (const path of [...scripts, ...stylesheets, ...favicons]) {
    assert.ok(path.startsWith(expectedBasePath), `local asset uses Pages base path: ${path}`);
  }
  assert.ok(scripts.some((path) => path.startsWith(`${expectedBasePath}assets/`) && /\.js$/u.test(new URL(path, config.publicUrl).pathname)), "bundled JavaScript uses the asset directory");
  assert.ok(stylesheets.some((path) => path.startsWith(`${expectedBasePath}assets/`) && /\.css$/u.test(new URL(path, config.publicUrl).pathname)), "bundled CSS uses the asset directory");
  const shareImage = assertShareImageUrl(config);
  return { scripts, stylesheets, favicon: `${expectedBasePath}favicon.svg`, shareImage };
}

function assertPublicUrl(config) {
  const publicUrl = new URL(config.publicUrl);
  assert.equal(publicUrl.protocol, "https:", "configured Pages URL uses HTTPS");
  assert.equal(publicUrl.pathname, expectedBasePath, "configured URL and Vite Pages base agree");
  return publicUrl;
}

function assertShareImageUrl(config) {
  if (config.shareImageUrl === null) return null;
  const publicUrl = new URL(config.publicUrl);
  const imageUrl = new URL(config.shareImageUrl);
  assert.equal(imageUrl.origin, publicUrl.origin, "share image uses the configured public origin");
  assert.ok(imageUrl.pathname.startsWith(expectedBasePath), "share image uses the Pages base path");
  assert.equal(imageUrl.search, "", "share image URL has no cache-busting query");
  assert.equal(imageUrl.hash, "", "share image URL has no fragment");
  assert.equal(config.shareImageType, "image/png", "share image is a PNG");
  assert.match(imageUrl.pathname, /\.png$/u, "share image path has a PNG extension");
  return imageUrl.pathname;
}

async function verifyLocalAsset(pathname, contentType) {
  assert.ok(pathname.startsWith(expectedBasePath), `asset stays beneath Pages base: ${pathname}`);
  const relativePath = decodeURIComponent(pathname.slice(expectedBasePath.length));
  const resolved = resolve(distRoot, relativePath);
  const escaped = relative(distRoot, resolved);
  assert.ok(escaped && escaped !== ".." && !escaped.startsWith(`..${sep}`), `asset resolves inside dist: ${pathname}`);
  const fileInfo = await stat(resolved);
  assert.ok(fileInfo.isFile() && fileInfo.size > 0, `built asset exists and is non-empty: ${pathname}`);
  assert.equal(contentType(pathname), true, `asset extension is supported: ${pathname}`);
}

function expectedMime(pathname) {
  if (/\.js$/u.test(pathname)) return ["text/javascript", "application/javascript", "application/ecmascript", "text/ecmascript"];
  if (/\.css$/u.test(pathname)) return ["text/css"];
  if (/\.svg$/u.test(pathname)) return ["image/svg+xml"];
  if (/\.png$/u.test(pathname)) return ["image/png"];
  return [];
}

function assertPngDimensions(content, width, height, label) {
  const bytes = Buffer.from(content);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${label} has the PNG signature`);
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR", `${label} has a PNG IHDR header`);
  assert.equal(bytes.readUInt32BE(16), width, `${label} width is ${width}px`);
  assert.equal(bytes.readUInt32BE(20), height, `${label} height is ${height}px`);
}

async function verifyArtifact(config) {
  const requestedSha = process.env.PAGES_REQUESTED_SHA
    ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.match(requestedSha, /^[0-9a-f]{40}$/u, "requested SHA is a full lowercase 40-character commit SHA");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.match(sourceSha, /^[0-9a-f]{40}$/u, "checked-out source is a full commit SHA");
  assert.equal(sourceSha, requestedSha, "checked-out source matches requested SHA");
  assertPublicUrl(config);

  const htmlPath = resolve(distRoot, "index.html");
  const html = await readFile(htmlPath, "utf8");
  const resources = assertHtmlContract(html, config);
  const version = { sourceSha, requestedSha };
  await writeFile(resolve(distRoot, "version.json"), `${JSON.stringify(version)}\n`, "utf8");
  const recordedVersion = JSON.parse(await readFile(resolve(distRoot, "version.json"), "utf8"));
  assert.deepEqual(recordedVersion, version, "version.json records source and requested SHA");

  const paths = [...resources.scripts, ...resources.stylesheets, resources.favicon, ...(resources.shareImage ? [resources.shareImage] : [])]
    .map((path) => new URL(path, config.publicUrl).pathname);
  for (const path of paths) {
    await verifyLocalAsset(path, (assetPath) => expectedMime(assetPath).length > 0);
  }
  if (resources.shareImage) {
    const imagePath = decodeURIComponent(resources.shareImage.slice(expectedBasePath.length));
    const image = await readFile(resolve(distRoot, imagePath));
    assertPngDimensions(image, config.shareImageWidth, config.shareImageHeight, "built share image");
  }
  await access(resolve(distRoot, "assets"));
  console.log(`Pages artifact verified: sourceSha=${sourceSha}, requestedSha=${requestedSha}, assets=${paths.length}`);
}

async function fetchWithRetry(label, url, validateResponse) {
  let lastError;
  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    const waitMs = retryDelaysMs[attempt];
    if (waitMs > 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(12_000),
      });
      assert.equal(response.status, 200, `${label} returned HTTP 200 (got ${response.status})`);
      return await validateResponse(response);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${label} did not pass after ${retryDelaysMs.length} attempts: ${lastError?.message ?? "unknown error"}`);
}

function assertMime(response, accepted, label) {
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  assert.ok(mime && accepted.includes(mime), `${label} has an expected Content-Type (got ${mime ?? "missing"})`);
}

async function verifyPublished(config) {
  const expectedSha = process.env.PAGES_EXPECTED_SHA;
  assert.match(expectedSha ?? "", /^[0-9a-f]{40}$/u, "expected SHA is supplied as a full lowercase 40-character SHA");
  const publicUrl = assertPublicUrl(config);
  const deploymentUrl = process.env.PAGES_DEPLOYMENT_URL;
  assert.ok(deploymentUrl, "Pages deployment output URL is required");
  const normalizedDeploymentUrl = new URL(deploymentUrl);
  assert.equal(normalizedDeploymentUrl.protocol, "https:", "Pages deployment output uses HTTPS");
  const normalizedPath = normalizedDeploymentUrl.pathname.endsWith("/")
    ? normalizedDeploymentUrl.pathname
    : `${normalizedDeploymentUrl.pathname}/`;
  assert.equal(`${normalizedDeploymentUrl.origin}${normalizedPath}`, publicUrl.href, "deployment URL matches site.config.ts publicUrl");

  const html = await fetchWithRetry("published HTML", publicUrl, async (response) => {
    assertMime(response, ["text/html", "application/xhtml+xml"], "published HTML");
    const finalUrl = new URL(response.url);
    assert.equal(finalUrl.origin, publicUrl.origin, "HTML remains on configured origin");
    assert.equal(finalUrl.pathname, publicUrl.pathname, "HTML remains on configured path");
    const body = await response.text();
    assertHtmlContract(body, config);
    return body;
  });
  const resources = assertHtmlContract(html, config);

  const versionUrl = new URL("version.json", publicUrl);
  versionUrl.searchParams.set("verify", expectedSha);
  await fetchWithRetry("published version.json", versionUrl, async (response) => {
    assertMime(response, ["application/json", "text/json"], "published version.json");
    const version = await response.json();
    assert.equal(version.sourceSha, expectedSha, "published source SHA matches requested SHA");
    assert.equal(version.requestedSha, expectedSha, "published requested SHA matches dispatch input");
  });

  const assets = [...resources.scripts, ...resources.stylesheets, resources.favicon, ...(resources.shareImage ? [resources.shareImage] : [])];
  await Promise.all(assets.map(async (path) => {
    const assetUrl = new URL(path, publicUrl);
    const acceptedMime = expectedMime(assetUrl.pathname);
    await fetchWithRetry(`published asset ${assetUrl.pathname}`, assetUrl, async (response) => {
      assertMime(response, acceptedMime, `published asset ${assetUrl.pathname}`);
      const finalUrl = new URL(response.url);
      assert.equal(finalUrl.origin, publicUrl.origin, "asset remains on configured origin");
      assert.equal(finalUrl.pathname, assetUrl.pathname, "asset resolves at its base-prefixed path");
      const body = Buffer.from(await response.arrayBuffer());
      assert.ok(body.byteLength > 0, "published asset is non-empty");
      if (path === resources.shareImage) {
        assertPngDimensions(body, config.shareImageWidth, config.shareImageHeight, "published share image");
      }
    });
  }));
  console.log(`Published HTTP smoke passed: ${publicUrl.href}; sourceSha=${expectedSha}; assets=${assets.length}`);
}

const config = await readSiteConfig();
if (mode === "artifact") {
  await verifyArtifact(config);
} else if (mode === "published") {
  await verifyPublished(config);
} else {
  throw new Error("Usage: node scripts/check-pages.mjs <artifact|published>");
}
