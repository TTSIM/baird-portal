# Additional Dr Hassan knowledge

Copy larger lecture materials, transcripts, handouts, and formal course documents into this directory. Files added through the admin dashboard do not need to be committed here.

Supported formats:

- PDF: `.pdf`
- Microsoft Word: `.doc`, `.docx`
- Microsoft PowerPoint: `.pptx`
- Web and text: `.html`, `.md`, `.txt`

Text-searchable files work best. Scanned PDFs should be OCR-processed before they are added.

After adding or changing files:

1. Add an entry to `manifest.json` using the file's relative path and a valid course ID. An optional title can also be supplied:

   ```json
   {
     "sources": {
       "external-lecture.pdf": {
         "courseId": "implant-dentistry-2026",
         "title": "External lecture"
       }
     }
   }
   ```

2. Run `npm run knowledge:check` to validate all sources locally.
3. Run `npm run knowledge:sync` if you want to update the configured OpenAI vector store immediately.
4. Commit and deploy the files. Netlify also runs the sync automatically during the production build.

These sources are private AI-only references. Delegates can ask questions grounded in them when they have access to any module in the assigned course, but cannot browse or download the source.

The sync requires `OPENAI_API_KEY` and `OPENAI_VECTOR_STORE_ID`. Run `npm run knowledge:init` once to create the vector store and print the required configuration.
