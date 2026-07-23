# Ask Dr Hassan setup

The page, course extractor, Netlify function, rate limiting, and automated tests are included in this repository. The live AI needs one OpenAI API key and one vector store.

## First-time setup

1. Use Node.js 20 and install dependencies:

   ```sh
   npm install
   ```

2. Export an OpenAI API key locally, then create the dedicated course vector store:

   ```sh
   export OPENAI_API_KEY="your-key"
   npm run knowledge:init
   ```

3. Copy the printed `OPENAI_VECTOR_STORE_ID` into your local environment and configure these Netlify environment variables:

   - `OPENAI_API_KEY`
   - `OPENAI_VECTOR_STORE_ID`
   - `OPENAI_MODEL=gpt-5.4-mini` (optional; this is already the default)
   - `GOOGLE_CLIENT_ID`
   - `SESSION_SECRET` (at least 32 random characters)
   - `BAIRD_OWNER_EMAILS=simsingh@gmail.com`
   - `BAIRD_ADMIN_EMAILS` (comma-separated initial administrator emails)

   Add the local Netlify origin and production origin to the Google OAuth web client's authorised JavaScript origins.

4. Upload and index all current course sources:

   ```sh
   npm run knowledge:sync
   ```

5. Start the portal with Netlify’s local function runtime:

   ```sh
   npm run dev
   ```

## Adding materials later

Administrators can upload files up to 4 MB from the private Knowledge screen. The originals are stored in a private Netlify Blob store and are not published with the site.

For larger text-searchable PDF, Word, PowerPoint, HTML, Markdown, or text files, copy them into `knowledge/additional/` and assign each file to a course in `knowledge/additional/manifest.json`. Run `npm run knowledge:check` before committing. The production build syncs these private AI-only references but does not publish the originals.

## Verification

```sh
npm run typecheck
npm test
npm run knowledge:check
npm run build:static
npm run test:e2e
```

The paid live browser smoke test is opt-in:

```sh
RUN_LIVE_DR_HASSAN=1 DR_HASSAN_BASE_URL="https://your-site.netlify.app" npm run test:e2e
```
