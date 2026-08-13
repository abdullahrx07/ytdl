# YouTube MP4/MP3 Download URL API

This project's API server generates a temporary MP4 or MP3 download URL from a YouTube video URL. Bot-side code calls the API and uses the returned `downloadUrl` to download the video or audio.

## Bot API

### MP4 download URL

```http
GET /api/dl?link=<youtube-url>&format=mp4
```

The `link` URL must be sent URL-encoded.

#### cURL example

```bash
curl "http://localhost:80/api/dl?link=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DVIDEO_ID&format=mp4"
```

#### JavaScript bot example

```js
const videoUrl = "https://www.youtube.com/watch?v=VIDEO_ID";
const response = await fetch(
  `/api/dl?link=${encodeURIComponent(videoUrl)}&format=mp4`,
);

const data = await response.json();

if (!response.ok) {
  throw new Error(data.error || "Could not create a download URL");
}

console.log(data.downloadUrl);
```

### Default format

If `format` is not provided, `mp4` is used by default:

```http
GET /api/dl?link=<youtube-url>
```

### MP3 support

To get an audio-only URL, pass `format=mp3`:

```http
GET /api/dl?link=<youtube-url>&format=mp3
```

## Successful response

```json
{
  "author": "rX",
  "title": "Video title",
  "format": "mp4",
  "downloadUrl": "https://temporary-download-url"
}
```

### Response fields

| Field | Type | Description |
| --- | --- | --- |
| `author` | string | API response author identifier |
| `title` | string | Converted video's title, when provided by the converter |
| `format` | `"mp4"` \| `"mp3"` | Requested output format |
| `downloadUrl` | string | Temporary signed URL for downloading the converted file |

## Supported YouTube URLs

- `youtube.com/watch?v=...`
- `www.youtube.com/watch?v=...`
- `youtu.be/...`
- `youtube.com/shorts/...`
- `youtube.com/embed/...`
- `youtube.com/live/...`

Only YouTube URLs are accepted. Other websites or unsupported URL formats return a `400` response.

## Error responses

### Missing URL

```http
400 Bad Request
```

```json
{
  "error": "Missing required query parameter: link"
}
```

### Invalid format

```json
{
  "error": "format must be either mp4 or mp3"
}
```

### Invalid YouTube URL

```json
{
  "error": "link must be a valid YouTube URL"
}
```

### Converter failure

```http
502 Bad Gateway
```

```json
{
  "error": "Unable to generate a download URL"
}
```

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/healthz` | Server health check |
| `GET` | `/api/dl?link=<url>&format=mp4` | Generate a temporary MP4 URL |
| `GET` | `/api/dl?link=<url>&format=mp3` | Generate a temporary MP3 URL |
| `GET` | `/api/project.zip` | Download the complete updated project ZIP |

## Development

### Start the API server

```bash
pnpm --filter @workspace/api-server run dev
```

### Typecheck

```bash
pnpm run typecheck
```

### Regenerate API clients and schemas

Run codegen whenever the OpenAPI source file changes:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Source of truth for the OpenAPI contract:

```text
lib/api-spec/openapi.yaml
```

## Implementation map

- `artifacts/api-server/src/routes/download.ts` — YouTube URL validation, MP4/MP3 conversion flow, progress polling, and response handling
- `artifacts/api-server/src/routes/project.ts` — Complete project ZIP download route
- `artifacts/api-server/src/routes/index.ts` — API route registration
- `lib/api-spec/openapi.yaml` — API contract
- `lib/api-client-react/src/generated/` — Generated React API client
- `lib/api-zod/src/generated/` — Generated Zod schemas

## Important notes

- `downloadUrl` is a temporary signed URL; the bot should call the API again for a fresh URL whenever it's needed.
- The conversion flow depends on an upstream converter service. If the upstream is unavailable, the API returns `502`.
- When downloading and using videos, comply with YouTube's Terms of Service and the content owner's rights.

## Bot Command

The `yt.js` GoatBot command in this folder uses this API. Usage: `yt [mp4|mp3] <youtube link>`. Set `API_BASE` at the top of `yt.js` to your deployed API host.
