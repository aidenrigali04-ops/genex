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

---

## Text → video jobs (`text_video_jobs`)

The main process (`npm run worker` → `worker.js`) claims and runs these on the same poll loop as `video_jobs`. Optional standalone: `npm run text-video --prefix worker`.

### Claim

Use RPC `worker_claim_next_text_video_job()` (migration `20260425100000_worker_claim_next_text_video_job.sql`) so rows are not stuck `queued` when PostgREST cannot see them via plain `select`/`update`.

### Status progression

```
queued → planning → fetching → assembling → uploading → complete | failed
```

### Storage

- **Bucket:** `text-video-outputs`
- **Output object:** `{user_id}/{job_id}/output.mp4`
