import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const AUTH_URL = "https://eta.etacloud.org/api/v1/auth";
const INIT_URL = "https://eta.etacloud.org/api/v1/init";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CONVERT_REDIRECTS = 3;
const MAX_PROGRESS_POLLS = 30;
const PROGRESS_POLL_INTERVAL_MS = 1_000;
const MAX_VERIFY_RETRIES = 5; // ✅ downloadURL "not-actually-ready" hole koybar retry korbe
const UPSTREAM_HEADERS = {
  Accept: "application/json",
  Origin: "https://y2mate.gs",
  Referer: "https://y2mate.gs/",
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
};

type DownloadFormat = "mp3" | "mp4";
type JsonRecord = Record<string, unknown>;

type ConversionResult = {
  error?: number | string;
  redirect?: number;
  redirectURL?: string;
  progressURL?: string;
  downloadURL?: string;
  title?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

// ✅ upstream error code non-zero/truthy hole eta treat kora hoy as real failure,
// even jodi downloadURL field thakeo (etacloud majhe majhe dutai ekshathe pathay)
function hasUpstreamError(result: ConversionResult): boolean {
  const err = result.error;
  if (err === undefined || err === null) return false;
  if (typeof err === "number") return err !== 0;
  if (typeof err === "string") return err.trim() !== "" && err.trim() !== "0";
  return Boolean(err);
}

function getLink(req: Request): string | undefined {
  const queryLink = req.query["link"];
  if (typeof queryLink === "string" && queryLink.trim()) {
    return queryLink.trim();
  }

  const pathMatch = req.path.match(/^\/dl=(.+)$/);
  if (!pathMatch?.[1]) {
    return undefined;
  }

  try {
    return decodeURIComponent(pathMatch[1]).trim() || undefined;
  } catch {
    return undefined;
  }
}

function getFormat(req: Request): DownloadFormat | undefined {
  const rawFormat = req.query["format"];
  if (rawFormat === undefined) {
    return "mp4";
  }

  if (typeof rawFormat !== "string") {
    return undefined;
  }

  const format = rawFormat.trim().toLowerCase();
  return format === "mp3" || format === "mp4"
    ? format
    : undefined;
}

function getYoutubeVideoId(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }

  const hostname = url.hostname.toLowerCase();
  const isYoutubeHost =
    hostname === "youtube.com" ||
    hostname.endsWith(".youtube.com") ||
    hostname === "youtu.be" ||
    hostname.endsWith(".youtu.be");
  if (!isYoutubeHost) {
    return undefined;
  }

  if (hostname === "youtu.be" || hostname.endsWith(".youtu.be")) {
    return url.pathname.split("/").filter(Boolean)[0];
  }

  const queryId = url.searchParams.get("v");
  if (queryId) {
    return queryId;
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (
    (pathParts[0] === "shorts" ||
      pathParts[0] === "embed" ||
      pathParts[0] === "live") &&
    pathParts[1]
  ) {
    return pathParts[1];
  }

  return undefined;
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<JsonRecord> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      ...UPSTREAM_HEADERS,
      ...init?.headers,
    },
  });

  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body)) {
    throw new Error(`Upstream returned HTTP ${response.status}`);
  }

  return body;
}

async function fetchYoutubeTitle(link: string): Promise<string | undefined> {
  try {
    const oembedUrl = new URL("https://www.youtube.com/oembed");
    oembedUrl.searchParams.set("url", link);
    oembedUrl.searchParams.set("format", "json");

    const metadata = await fetchJson(oembedUrl.toString());
    const title = metadata["title"];
    return typeof title === "string" && title.trim()
      ? title.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function buildConvertRequestUrl(
  convertUrl: string,
  videoId: string,
  format: DownloadFormat,
): string {
  const baseUrl = convertUrl.split("&v=")[0];
  const url = new URL(baseUrl);
  url.searchParams.set("v", videoId);
  url.searchParams.set("f", format);
  url.searchParams.set("_", String(Date.now()));
  return url.toString();
}

function buildDownloadUrl(
  downloadUrl: string,
  videoId: string,
  format: DownloadFormat,
): string {
  const url = new URL(downloadUrl);
  url.searchParams.set("v", videoId);
  url.searchParams.set("f", format);
  url.searchParams.set("r", "y2mate.gs");
  return url.toString();
}

// ✅ NEW: downloadURL asholei streamable media kina check kore —
// etacloud majhe majhe "downloadURL" field dey kintu hit korle actual e
// {"progress":0,"error":6} type status JSON ferot dey (conversion asholei ready na).
async function verifyDownloadUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: UPSTREAM_HEADERS,
    });

    const contentType = response.headers.get("content-type") || "";
    const looksLikeMedia =
      contentType.includes("video") ||
      contentType.includes("audio") ||
      contentType.includes("octet-stream");

    // body ta consume/cancel kore dilam, actual data client-side abar fresh fetch korbe
    try {
      await response.body?.cancel();
    } catch {
      /* ignore */
    }

    return looksLikeMedia;
  } catch {
    return false;
  }
}

async function startConversion(
  videoId: string,
  format: DownloadFormat,
): Promise<ConversionResult> {
  const auth = await fetchJson(`${AUTH_URL}?_=${Date.now()}`);
  const token = typeof auth["key"] === "string" ? auth["key"] : undefined;
  if (!token) {
    throw new Error("Upstream auth did not return a session key");
  }

  const init = await fetchJson(`${INIT_URL}?_=${Date.now()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const convertUrl =
    typeof init["convertURL"] === "string" ? init["convertURL"] : undefined;
  if (!convertUrl) {
    throw new Error("Upstream init did not return a conversion URL");
  }

  let result = await fetchJson(
    buildConvertRequestUrl(convertUrl, videoId, format),
  );
  for (let attempt = 0; attempt < MAX_CONVERT_REDIRECTS; attempt += 1) {
    const typedResult = result as ConversionResult;

    // ✅ error field thakle downloadURL thakleo eta ignore na kore throw kori
    if (hasUpstreamError(typedResult)) {
      throw new Error(
        `Upstream conversion error (code ${typedResult.error})`,
      );
    }

    if (typeof result["downloadURL"] === "string" && result["downloadURL"]) {
      return result as ConversionResult;
    }

    if (
      result["redirect"] !== 1 ||
      typeof result["redirectURL"] !== "string" ||
      !result["redirectURL"]
    ) {
      break;
    }

    result = await fetchJson(
      buildConvertRequestUrl(result["redirectURL"], videoId, format),
    );
  }

  return result as ConversionResult;
}

async function waitForDownload(
  initialResult: ConversionResult,
): Promise<ConversionResult> {
  // ✅ error thakle downloadURL thakleo eta "ready" dhora jabe na
  if (
    initialResult.downloadURL &&
    !hasUpstreamError(initialResult) &&
    !initialResult.progressURL
  ) {
    return initialResult;
  }

  if (!initialResult.progressURL) {
    return initialResult;
  }

  let result = initialResult;
  for (let attempt = 0; attempt < MAX_PROGRESS_POLLS; attempt += 1) {
    await new Promise((resolve) =>
      setTimeout(resolve, PROGRESS_POLL_INTERVAL_MS),
    );
    result = (await fetchJson(initialResult.progressURL)) as ConversionResult;

    if (hasUpstreamError(result)) {
      throw new Error(`Upstream conversion error (code ${result.error})`);
    }

    if (result.downloadURL) {
      return result;
    }
  }

  return result;
}

async function handleDownload(req: Request, res: Response): Promise<void> {
  const link = getLink(req);
  const format = getFormat(req);

  if (!link) {
    res.status(400).json({
      error: "Missing required query parameter: link",
    });
    return;
  }

  if (!format) {
    res.status(400).json({
      error: "format must be either mp4 or mp3",
    });
    return;
  }

  const videoId = getYoutubeVideoId(link);
  if (!videoId) {
    res.status(400).json({
      error: "link must be a valid YouTube URL",
    });
    return;
  }

  try {
    let finalUrl: string | undefined;
    let title = "";
    let lastError: unknown;

    // ✅ MAX_VERIFY_RETRIES bar full conversion retry kore, jotokkhon na actual
    // streamable media link paoa jai (etacloud majhe majhe fake-ready downloadURL dey)
    for (let attempt = 0; attempt < MAX_VERIFY_RETRIES; attempt += 1) {
      try {
        const conversion = await startConversion(videoId, format);
        const result = await waitForDownload(conversion);

        if (!result.downloadURL) {
          req.log.warn(
            {
              format,
              attempt,
              hasProgressUrl: Boolean(result.progressURL),
              upstreamError: result.error,
            },
            "Conversion completed without a download URL",
          );
          lastError = new Error(
            "The upstream converter did not return a download URL",
          );
          continue;
        }

        const candidateUrl = buildDownloadUrl(
          result.downloadURL,
          videoId,
          format,
        );

        const isReal = await verifyDownloadUrl(candidateUrl);
        if (!isReal) {
          req.log.warn(
            { format, attempt, candidateUrl },
            "downloadURL failed media verification, retrying conversion",
          );
          lastError = new Error(
            "Upstream returned a non-media downloadURL after verification",
          );
          continue;
        }

        finalUrl = candidateUrl;
        title =
          (typeof result.title === "string" ? result.title.trim() : "") ||
          "";
        break;
      } catch (err) {
        lastError = err;
        req.log.warn(
          { err, format, attempt },
          "Conversion attempt failed, retrying",
        );
      }
    }

    if (!finalUrl) {
      req.log.error(
        { err: lastError, format },
        "All conversion attempts exhausted without a valid download URL",
      );
      res.status(502).json({
        error:
          "Unable to generate a working download URL after multiple attempts",
      });
      return;
    }

    if (!title) {
      title = (await fetchYoutubeTitle(link)) || "";
    }

    res.json({
      author: "rX",
      title,
      format,
      downloadUrl: finalUrl,
    });
  } catch (error) {
    req.log.error({ err: error, format }, "Download URL generation failed");
    res.status(502).json({
      error: "Unable to generate a download URL",
    });
  }
}

router.get("/dl", handleDownload);
router.get(/^\/dl=(.+)$/, handleDownload);

export default router;
