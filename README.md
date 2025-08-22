# Carts & Mass Experiment (React + Firebase)

A minimal laptop-friendly app for students to enter experiment data and get instant visuals, plus a teacher dashboard that aggregates across classes.

## Quick Start

1. Install Node.js 18+.
2. Download and unzip this project.
3. In the project folder, run:
   ```bash
   npm i
   npm run dev
   ```
4. Open the local URL shown in your terminal.

## Firebase Setup

- Firestore Database created in your Firebase project
- Authentication → enable **Anonymous**
- (Optional) Firestore Rules (basic)
  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /{document=**} {
        allow read: if true;
        allow write: if request.auth != null;
      }
    }
  }
  ```

## Teacher Key (optional)
Set an environment variable `VITE_TEACHER_KEY` when deploying (e.g., on Vercel). Locally, the default key is `CLASS-TEACHER-KEY`.

## Deploy
- Vercel: import repo, set build to `npm run build`, output `dist`.
- Netlify: build `npm run build`, publish `dist`.
