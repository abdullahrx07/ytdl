import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

const AUTH_URL = "https://eta.etacloud.org/api/v1/auth";
const INIT_URL = "https://eta.etacloud.org/api/v1/init";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CONVERT_REDIRECTS = 3;
const MAX_PROGRESS_POLLS = 30;
const PROGRESS_POLL_INTERVAL_MS = 1_000;
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
  if (initialResult.downloadURL || !initialResult.progressURL) {
    return initialResult;
  }

  let result = initialResult;
  for (let attempt = 0; attempt < MAX_PROGRESS_POLLS; attempt += 1) {
    await new Promise((resolve) =>
      setTimeout(resolve, PROGRESS_POLL_INTERVAL_MS),
    );
    result = (await fetchJson(initialResult.progressURL)) as ConversionResult;
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
    const conversion = await startConversion(videoId, format);
    const result = await waitForDownload(conversion);

    if (!result.downloadURL) {
      req.log.warn(
        {
          format,
          hasProgressUrl: Boolean(result.progressURL),
          upstreamError: result.error,
        },
        "Conversion completed without a download URL",
      );
      res.status(502).json({
        error: "The upstream converter did not return a download URL",
      });
      return;
    }

    res.json({
      author: "rX",
      title: result.title ?? "",
      format,
      downloadUrl: buildDownloadUrl(result.downloadURL, videoId, format),
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