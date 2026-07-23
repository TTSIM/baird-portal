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
   - `COMMUNITY_ENABLED` (`false` until community launch approval)
   - `COMMUNITY_EMAIL_FROM`
   - `NETLIFY_EMAILS_PROVIDER=postmark`
   - `NETLIFY_EMAILS_PROVIDER_API_KEY`
   - `NETLIFY_EMAILS_SECRET`
2. Add the local Netlify URL and production origin to the Google OAuth web client's authorised JavaScript origins.
3. Run `npm install`.
4. Run `npm run dev`.

Only pre-approved emails may sign in. `simsingh@gmail.com` is created or upgraded as the protected owner after verified Google sign-in. Emails in `BAIRD_ADMIN_EMAILS` are created as administrators on first sign-in.

## Community

The protected Community tab uses strongly consistent Netlify Blobs for discussions and private images. Every account must confirm a profile after Google sign-in. Community images accept JPEG, PNG and WebP files up to 10 MB each and upload in 3 MB chunks.

Before enabling `COMMUNITY_ENABLED=true` in production:

1. Verify the Postmark sender used by `COMMUNITY_EMAIL_FROM`.
2. Configure the Netlify Email Integration variables for both Builds and Functions.
3. Review the community confidentiality, acceptable-use and privacy wording.
4. Test the feature on a Deploy Preview and confirm scheduled cleanup and email retry functions are present.

## Validation

```sh
npm run typecheck
npm test
npm run knowledge:check
npm run build:static
npm run test:e2e
```

Large repository-managed private sources go in `knowledge/additional/` and require a course assignment in `knowledge/additional/manifest.json`. Dashboard uploads are limited to 4 MB and are stored privately in Netlify Blobs.
