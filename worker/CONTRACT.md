## Video Job Contract

**Primary product path:** source clipping — `video_jobs` (upload/URL + user `prompt` → transcribe → plan → FFmpeg variations). This is what most users should run.

**Secondary / optional:** `text_video_jobs` (script + stock footage + TTS assembly). Same `worker.js` poll loop unless `ENABLE_TEXT_VIDEO_JOBS=0` (disables claiming and should match the Next API flag so new jobs are not accepted).

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

Secondary feature. The main process (`npm run worker` → `worker.js`) claims and runs these on the same poll loop as `video_jobs` when `ENABLE_TEXT_VIDEO_JOBS` is not disabled. Optional standalone: `npm run text-video --prefix worker` (exits immediately if `ENABLE_TEXT_VIDEO_JOBS=0`).

### Claim

Use RPC `worker_claim_next_text_video_job()` (migration `20260425100000_worker_claim_next_text_video_job.sql`) so rows are not stuck `queued` when PostgREST cannot see them via plain `select`/`update`.

### Status progression

```
queued → planning → fetching → assembling → uploading → complete | failed
```

### Storage

- **Bucket:** `text-video-outputs`
- **Output object:** `{user_id}/{job_id}/output.mp4`

### ElevenLabs (voice)

Voice calls use **HTTPS** to `https://api.elevenlabs.io` only (`xi-api-key` header). If you see **401** with `detected_unusual_activity`, ElevenLabs is blocking the **server IP / VPN / free tier**—not a TLS bug. Use a **paid** plan for workers on cloud hosts (Railway, Fly, etc.) or run TTS from a network they accept.
