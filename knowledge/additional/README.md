# Additional Dr Hassan knowledge

Copy new lecture materials, transcripts, handouts, and formal course documents into this directory. Keep filenames descriptive because Dr Hassan displays them in source references.

Supported formats:

- PDF: `.pdf`
- Microsoft Word: `.doc`, `.docx`
- Microsoft PowerPoint: `.pptx`
- Web and text: `.html`, `.md`, `.txt`

Text-searchable files work best. Scanned PDFs should be OCR-processed before they are added.

After adding or changing files:

1. Run `npm run knowledge:check` to validate all sources locally.
2. Run `npm run knowledge:sync` if you want to update the configured OpenAI vector store immediately.
3. Commit and deploy the files. Netlify also runs the sync automatically during the production build.

The sync requires `OPENAI_API_KEY` and `OPENAI_VECTOR_STORE_ID`. Run `npm run knowledge:init` once to create the vector store and print the required configuration.
