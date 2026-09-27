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
  return {
    title: readString("title"),
    description: readString("description"),
    publicUrl: readString("publicUrl"),
    shareImageUrl: imageMatch[1] === "null" ? null : imageMatch[2],
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

function assertHtmlContract(html, config) {
  const htmlTag = tags(html, "html")[0];
  assert.ok(htmlTag, "HTML document tag is present");
  assert.equal(htmlTag.attributes.lang, "ja", "document language is Japanese");
  const title = html.match(/<title>([\s\S]*?)<\/title>/iu)?.[1];
  assert.equal(title, htmlEscape(config.title), "document title matches site.config.ts");
  assert.equal(metadataValue(html, "og:title"), htmlEscape(config.title), "OG title matches site.config.ts");
  assert.equal(metadataValue(html, "og:description"), htmlEscape(config.description), "OG description matches site.config.ts");
  assert.equal(metadataValue(html, "og:url"), htmlEscape(config.publicUrl), "OG URL matches site.config.ts");
  const description = tags(html, "meta").find(({ attributes }) => attributes.name === "description");
  assert.equal(description?.attributes.content, htmlEscape(config.description), "description matches site.config.ts");
  const image = metadataValue(html, "og:image");
  if (config.shareImageUrl === null) {
    assert.equal(image, undefined, "unconfigured share image is absent");
  } else {
    assert.equal(image, htmlEscape(config.shareImageUrl), "OG image matches site.config.ts");
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
  return { scripts, stylesheets, favicon: `${expectedBasePath}favicon.svg` };
}

function assertPublicUrl(config) {
  const publicUrl = new URL(config.publicUrl);
  assert.equal(publicUrl.protocol, "https:", "configured Pages URL uses HTTPS");
  assert.equal(publicUrl.pathname, expectedBasePath, "configured URL and Vite Pages base agree");
  return publicUrl;
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
  return [];
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

  const paths = [...resources.scripts, ...resources.stylesheets, resources.favicon]
    .map((path) => new URL(path, config.publicUrl).pathname);
  for (const path of paths) {
    await verifyLocalAsset(path, (assetPath) => expectedMime(assetPath).length > 0);
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

  const assets = [...resources.scripts, ...resources.stylesheets, resources.favicon];
  await Promise.all(assets.map(async (path) => {
    const assetUrl = new URL(path, publicUrl);
    const acceptedMime = expectedMime(assetUrl.pathname);
    await fetchWithRetry(`published asset ${assetUrl.pathname}`, assetUrl, async (response) => {
      assertMime(response, acceptedMime, `published asset ${assetUrl.pathname}`);
      const finalUrl = new URL(response.url);
      assert.equal(finalUrl.origin, publicUrl.origin, "asset remains on configured origin");
      assert.equal(finalUrl.pathname, assetUrl.pathname, "asset resolves at its base-prefixed path");
      const body = await response.arrayBuffer();
      assert.ok(body.byteLength > 0, "published asset is non-empty");
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
