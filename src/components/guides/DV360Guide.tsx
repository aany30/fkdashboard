import CredentialInput from "@/components/forms/CredentialInput";
import GuideSection, { GuideLink, GuideButton, GuideCode } from "./GuideSection";

interface Props {
  /** Optional close handler when used inside a parent that toggles modes. */
  onClose?: () => void;
}

/**
 * DV360 connection guide — fully click-by-click manual flow.
 * Five sections (DV360 access → Cloud APIs → OAuth client → Refresh token →
 * Advertiser/Partner IDs) plus the inline credential form at the bottom.
 *
 * DV360 needs NO developer token (unlike Google Ads) — just a standard Google
 * OAuth refresh token with the display-video + doubleclickbidmanager scopes.
 */
export default function DV360Guide({ onClose }: Props) {
  return (
    <div className="space-y-4">
      {/* Quick connect option */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <p className="text-sm font-semibold text-green-900 mb-1">Fastest way — 2 clicks</p>
        <p className="text-sm text-green-800 mb-3">
          If your admin has set up the Google Cloud project, just sign in with the Google account that has DV360 access.
        </p>
        <a
          href="/api/auth/google/start"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition shadow-sm"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
          Connect with Google
        </a>
      </div>

      <div className="flex items-center gap-3 text-sm text-gray-400">
        <div className="flex-1 border-t border-gray-200" />
        or set up manually
        <div className="flex-1 border-t border-gray-200" />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
        <p className="font-semibold mb-0.5">~10 minutes total · No developer token, no app review</p>
        <p className="text-blue-800">
          You&apos;ll collect 4 things: an OAuth Client ID, its Client Secret, a Refresh Token (minted once via OAuth Playground), and your DV360 Advertiser ID.
        </p>
      </div>

      <GuideSection
        number={1}
        title="Make sure you have DV360 access"
        summary="Your Google account must be a user on the DV360 partner/advertiser"
        yieldsLabel="DV360 seat"
        defaultOpen
        subSteps={[
          {
            steps: [
              <>
                Open <GuideLink href="https://displayvideo.google.com">displayvideo.google.com</GuideLink> and confirm you can see the advertiser you want to audit. If you can&apos;t, ask your DV360 admin to add you: <GuideButton>Settings</GuideButton> → <GuideButton>Users</GuideButton> → <GuideButton>New user</GuideButton> (Read &amp; write or Read only both work).
              </>,
              <>
                Note: the API can only read what this Google account can see — the token you mint later inherits exactly these permissions.
              </>,
            ],
          },
        ]}
      />

      <GuideSection
        number={2}
        title="Enable the two APIs in Google Cloud"
        summary="Display & Video 360 API + DoubleClick Bid Manager API — one-time"
        yieldsLabel="APIs enabled"
        subSteps={[
          {
            steps: [
              <>
                Open <GuideLink href="https://console.cloud.google.com">console.cloud.google.com</GuideLink> and sign in with the same Google account. Create a project (any name, e.g. <GuideCode>auditor-dv360</GuideCode>) or select an existing one.
              </>,
              <>
                Go to <GuideButton>APIs &amp; Services</GuideButton> → <GuideButton>Library</GuideButton>. Search <GuideCode>Display &amp; Video 360 API</GuideCode> → <GuideButton>Enable</GuideButton>.
              </>,
              <>
                Back in the Library, search <GuideCode>DoubleClick Bid Manager API</GuideCode> → <GuideButton>Enable</GuideButton>. (This one powers the performance reports — spend, impressions, clicks, conversions.)
              </>,
            ],
          },
        ]}
      />

      <GuideSection
        number={3}
        title="Create an OAuth client"
        summary="Web-application client with the OAuth Playground as redirect URI"
        yieldsLabel="Client ID + Secret"
        subSteps={[
          {
            heading: "Step 3.1 — Consent screen (first time only)",
            steps: [
              <>
                <GuideButton>APIs &amp; Services</GuideButton> → <GuideButton>OAuth consent screen</GuideButton>. Choose <GuideButton>External</GuideButton>, fill only the required fields (app name, your email), and add your own Google account under <GuideButton>Test users</GuideButton>.
              </>,
              <>
                <span className="font-semibold">Important:</span> while the app&apos;s publishing status is <GuideCode>Testing</GuideCode>, refresh tokens expire after <span className="font-semibold">7 days</span>. Either click <GuideButton>Publish app</GuideButton> (no review needed for these scopes) or plan to re-mint weekly.
              </>,
            ],
          },
          {
            heading: "Step 3.2 — The client",
            steps: [
              <>
                <GuideButton>APIs &amp; Services</GuideButton> → <GuideButton>Credentials</GuideButton> → <GuideButton>Create credentials</GuideButton> → <GuideButton>OAuth client ID</GuideButton> → type <GuideButton>Web application</GuideButton>.
              </>,
              <>
                Under <span className="font-semibold">Authorized redirect URIs</span> add exactly: <GuideCode>https://developers.google.com/oauthplayground</GuideCode>
              </>,
              <>
                Click <GuideButton>Create</GuideButton> and copy the <span className="font-semibold">Client ID</span> (ends in <GuideCode>.apps.googleusercontent.com</GuideCode>) and <span className="font-semibold">Client Secret</span> (starts <GuideCode>GOCSPX-</GuideCode>).
              </>,
            ],
          },
        ]}
      />

      <GuideSection
        number={4}
        title="Mint the Refresh Token in OAuth Playground"
        summary="Authorize the display-video + doubleclickbidmanager scopes once"
        yieldsLabel="Refresh Token"
        subSteps={[
          {
            steps: [
              <>
                Open <GuideLink href="https://developers.google.com/oauthplayground">developers.google.com/oauthplayground</GuideLink>. Click the <GuideButton>⚙️ gear</GuideButton> (top right) → tick <GuideButton>Use your own OAuth credentials</GuideButton> → paste your Client ID + Secret.
              </>,
              <>
                In the left panel&apos;s <span className="font-semibold">Input your own scopes</span> box, paste both scopes separated by a space: <GuideCode>https://www.googleapis.com/auth/display-video https://www.googleapis.com/auth/doubleclickbidmanager</GuideCode>
              </>,
              <>
                Click <GuideButton>Authorize APIs</GuideButton> → sign in with your DV360-seated account → allow. (If you see an &quot;unverified app&quot; warning, click <GuideButton>Advanced</GuideButton> → <GuideButton>Go to app</GuideButton> — it&apos;s your own app.)
              </>,
              <>
                Click <GuideButton>Exchange authorization code for tokens</GuideButton> and copy the <span className="font-semibold">Refresh token</span> — it starts with <GuideCode>1//</GuideCode>. (The refresh token is only shown on the first consent; if it&apos;s missing, revoke access at myaccount.google.com/permissions and redo this step.)
              </>,
            ],
          },
        ]}
      />

      <GuideSection
        number={5}
        title="Find your Advertiser ID (and Partner ID)"
        summary="Both are right in the DV360 URL"
        yieldsLabel="Advertiser ID"
        subSteps={[
          {
            steps: [
              <>
                Open your advertiser in <GuideLink href="https://displayvideo.google.com">displayvideo.google.com</GuideLink> and look at the URL: <GuideCode>…#ng_nav/p/PARTNER_ID/a/ADVERTISER_ID/…</GuideCode>
              </>,
              <>
                The number after <GuideCode>/a/</GuideCode> is your <span className="font-semibold">Advertiser ID</span> (required). The number after <GuideCode>/p/</GuideCode> is the <span className="font-semibold">Partner ID</span> (optional — used for Floodlight config reads).
              </>,
            ],
          },
        ]}
      />

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h4 className="font-bold text-gray-900 mb-1">Paste your DV360 credentials</h4>
        <p className="text-sm text-gray-600 mb-4">All four required fields come from the steps above. Use Test Connection before saving.</p>
        <CredentialInput platform="dv360" onClose={onClose} />
      </div>
    </div>
  );
}
