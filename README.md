<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy SpotDiff

This contains everything you need to run your app locally.

## Run Locally

**Prerequisites:** Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local`
3. For local AI calls, either:
   - run with Vercel Functions (`vercel dev`), or
   - set `VITE_API_BASE_URL` in `.env.local` to a deployed app URL
4. Run the app:
   `npm run dev`

## Deploy To Vercel

1. Import the repo into Vercel.
2. Set `GEMINI_API_KEY` in Project Settings -> Environment Variables.
3. Deploy.

The app calls `/api/detect-differences`, and that function reads `GEMINI_API_KEY` server-side.
