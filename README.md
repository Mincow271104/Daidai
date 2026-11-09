# DaiDai（呆呆）

**AI-powered Taiwanese Traditional Chinese learning app** built with React Native, Expo and TypeScript.

DaiDai is designed for international students and people living in Taiwan who want to understand and use Taiwanese Mandarin in real-life and workplace contexts.

## Current capabilities in the codebase

- AI language tutor with Flash and two-pass Reasoning modes, powered by Gemini.
- Voice recording, speech-to-text, Taiwanese Traditional Chinese translation and contextual analysis.
- Optional local FastAPI / Faster-Whisper speech recognition server with cloud fallback.
- Interactive sentence and word lookup with Pinyin, contextual meanings and speech playback.
- Personal vocabulary and conversation history stored in SQLite.
- FSRS-based spaced repetition scheduling using `ts-fsrs`.
- Situational roleplay and pronunciation practice.
- Learning reminders and a GitHub Actions iOS build workflow.

## Platforms

- **iOS:** Expo app configuration and an existing GitHub Actions unsigned IPA build workflow.
- **Android:** Basic app configuration exists. EAS profiles and a manual APK/AAB build workflow are being prepared on the `feature/android-apk-release-foundation` branch. A successful Android artifact has not yet been verified.

## Quick start

Requirements: Node.js 22 and npm.

```bash
npm ci
cp .env.example .env
npm run typecheck
npx expo start
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

See:
- [SETUP.md](./SETUP.md) — development and local speech server setup.
- [ANDROID_BUILD.md](./ANDROID_BUILD.md) — EAS Android APK/AAB build instructions.
- [ROADMAP.md](./ROADMAP.md) — prioritized reliability, security and product improvements.

## Security notes

See [SECURITY.md](./SECURITY.md) for a historical credential-exposure finding and required release actions.

- Do not commit `.env` or API credentials.
- `EXPO_PUBLIC_*` variables are bundled into the client application. Never use them for shared production secrets.
- For broader distribution, choose and implement a secure API-key strategy (user-provided keys or an authenticated, rate-limited backend).
- The optional local speech server is intended for a trusted development network unless additional authentication and access controls are configured.

## Project status

This repository is an evolving prototype/codebase. Platform builds, device compatibility, AI quality and learning outcomes must be verified on the target devices before calling a release complete.
