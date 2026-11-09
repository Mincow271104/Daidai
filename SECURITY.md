# DaiDai — Security Notes

## Immediate credential rotation required

A review of the repository's historical `.env` commits found that non-empty values were previously committed in `EXPO_PUBLIC_GEMINI_API_KEY`. The current development branch removes the tracked `.env` file and adds ignore rules, but **this does not erase credentials from earlier Git commits**.

Before sharing this repository with additional people or changing it to public:

1. Revoke the previously committed Gemini API keys in Google AI Studio / Google Cloud.
2. Create replacement keys only after revocation.
3. Do not put shared production secrets in `EXPO_PUBLIC_*` variables. Expo embeds public environment variables into the client bundle.
4. Avoid committing personal API keys, even if the repository is private.
5. Decide whether DaiDai will use a BYOK model (each user supplies their own key) or an authenticated backend proxy with quotas and abuse protection.

History cleanup is a separate operation. If the repository owner decides to rewrite Git history to remove old credential-bearing blobs, coordinate with all collaborators first, create a backup, use a reviewed history-rewrite procedure, force-push the rewritten refs, and require collaborators to re-clone or carefully reset their local repositories. Do not treat history rewriting as a replacement for revoking the exposed keys.

## Current client-side key handling

The app currently supports a developer environment key and user-entered Gemini keys. Values with the `EXPO_PUBLIC_` prefix are public client configuration, and user-entered keys are stored by the app's persistence layer. Review secure storage and the desired BYOK/backend architecture before distributing the app broadly.

## Local speech server and Worker

The optional FastAPI speech server and standalone Cloudflare Worker need authentication, input limits, request quotas/rate limits, and carefully restricted network exposure before they are exposed to the public Internet. CORS restrictions alone are not authentication.
