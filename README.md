# BAIRD Learning Portal

A static BAIRD course portal backed by Netlify Functions, Netlify Blobs, Google sign-in, and OpenAI file search.

## Local setup

1. Copy `.env.example` to `.env` and set:
   - `GOOGLE_CLIENT_ID`
   - `SESSION_SECRET` (at least 32 random characters)
   - `BAIRD_OWNER_EMAILS` (defaults to `simsingh@gmail.com`)
   - `BAIRD_ADMIN_EMAILS` (comma-separated initial administrator emails)
   - `OPENAI_API_KEY`
   - `OPENAI_VECTOR_STORE_ID`
2. Add the local Netlify URL and production origin to the Google OAuth web client's authorised JavaScript origins.
3. Run `npm install`.
4. Run `npm run dev`.

Only pre-approved emails may sign in. `simsingh@gmail.com` is created or upgraded as the protected owner after verified Google sign-in. Emails in `BAIRD_ADMIN_EMAILS` are created as administrators on first sign-in.

## Validation

```sh
npm run typecheck
npm test
npm run knowledge:check
npm run build:static
npm run test:e2e
```

Large repository-managed private sources go in `knowledge/additional/` and require a course assignment in `knowledge/additional/manifest.json`. Dashboard uploads are limited to 4 MB and are stored privately in Netlify Blobs.
