# YouTube MP4/MP3 Download URL API

এই project-এর API server YouTube video URL নিয়ে একটি temporary MP4 বা MP3 download URL তৈরি করে। Bot-side থেকে API call করে পাওয়া `downloadUrl` ব্যবহার করে video বা audio download করা যাবে।

## Bot API

### MP4 download URL

```http
GET /api/dl?link=<youtube-url>&format=mp4
```

`link` URL অবশ্যই URL-encoded করে পাঠাতে হবে।

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

`format` না দিলে `mp4` ব্যবহার করা হবে:

```http
GET /api/dl?link=<youtube-url>
```

### MP3 support

Audio-only URL পেতে `format=mp3` পাঠাতে হবে:

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
| `title` | string | Video title from the converter, with YouTube oEmbed metadata as fallback |
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
| `GET` | `/api/title-update.zip` | Download only the updated `download.ts` file |

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

OpenAPI source file পরিবর্তন করলে codegen চালাতে হবে:

```bash
pnpm --filter @workspace/api-spec run codegen
```

OpenAPI contract-এর source of truth:

```text
lib/api-spec/openapi.yaml
```

## Implementation map

- `artifacts/api-server/src/routes/download.ts` — YouTube URL validation, MP4/MP3 conversion flow, progress polling এবং response handling
- `artifacts/api-server/src/routes/project.ts` — Complete project ZIP download route
- `artifacts/api-server/src/routes/index.ts` — API route registration
- `lib/api-spec/openapi.yaml` — API contract
- `lib/api-client-react/src/generated/` — Generated React API client
- `lib/api-zod/src/generated/` — Generated Zod schemas

## Important notes

- `downloadUrl` একটি temporary signed URL; bot-এর প্রয়োজনের সময় API call করে নতুন URL নেওয়া উচিত।
- Converter-এর `progressURL` conversion complete না হওয়া পর্যন্ত poll করা হয়, যাতে premature download থেকে upstream `error:6` না আসে।
- Upstream quality নির্বাচন করার parameter দেয় না। Real MP4 test-এ output H.264 + AAC এবং 854×480 (480p) পাওয়া গেছে; 360p guarantee করা যায় না।
- Conversion flow একটি upstream converter service-এর উপর নির্ভরশীল। Upstream unavailable হলে API `502` ফেরত দেয়।
- Video download এবং ব্যবহার করার ক্ষেত্রে YouTube-এর Terms of Service এবং content owner's rights মেনে চলতে হবে।