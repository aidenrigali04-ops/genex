## Video Job Contract

### Input (`video_jobs` row the worker reads)

- `id`: uuid
- `user_id`: uuid
- `input_type`: `'upload' | 'url'`
- `storage_path`: string (set when `input_type = 'upload'`)
- `input_url`: string (set when `input_type = 'url'`)
- `prompt`: string
- `status`: `'queued'`

### Status progression the worker must follow

```
queued → processing → transcribing → planning →
generating → complete | failed
```

### Output (worker writes back to `video_jobs`)

- `status`: `'complete'` or `'failed'`
- `variations`: JSON array of:
  `{ variation_number, label, url, style_note }`
  where `url` is a Supabase Storage path (not a full public URL)
- `error_message`: string (only on `failed`)

### Storage paths

- **Inputs:** `inputs/{userId}/{timestamp}-{filename}`
- **Outputs:** `outputs/{userId}/{jobId}/variation_{n}.mp4`
- **Bucket:** `videos`
