# Video Job Contract

Interface between the Next.js app and the Railway **worker** (`worker.js`).  
All objects live in the Supabase Storage bucket **`videos`** unless noted otherwise.

## Input (`video_jobs` row the worker reads)

| Field | Type | Notes |
|-------|------|--------|
| `id` | `uuid` | Job id |
| `user_id` | `uuid` | Owner |
| `input_type` | `'upload' \| 'url'` | Source kind |
| `storage_path` | `string` | Set when `input_type = 'upload'`: path inside bucket `videos` (see Storage paths) |
| `input_url` | `string` | Set when `input_type = 'url'`: raw YouTube (or video page) URL |
| `prompt` | `string` | User instructions |
| `status` | `text` | Worker should pick rows with `status = 'queued'` |

## Status progression the worker must follow

```
queued → processing → transcribing → planning → generating → complete | failed
```

## Output (worker writes back to `video_jobs`)

| Field | Notes |
|-------|--------|
| `status` | `'complete'` or `'failed'` |
| `variations` | JSON array of objects (see below) |
| `error_message` | Set only when `status = 'failed'` |

### `variations` array element

Each object:

```json
{
  "variation_number": 1,
  "label": "Human-readable title",
  "url": "outputs/{userId}/{jobId}/variation_1.mp4",
  "style_note": "Optional short note on edit style"
}
```

- **`url`**: Storage **object path** inside bucket `videos` (not a full public `https://` URL). The Next.js app signs these paths for playback in the browser.

## Storage paths

| Kind | Pattern | Bucket |
|------|-----------|--------|
| Inputs (upload) | `inputs/{userId}/{timestamp}-{filename}` | `videos` |
| Outputs | `outputs/{userId}/{jobId}/variation_{n}.mp4` | `videos` |

`{userId}` is the auth user uuid; `{jobId}` is the `video_jobs.id`; `{n}` is typically `1`–`5`.
