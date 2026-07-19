import { useState } from "react";
import { useRouter } from "next/router";
import { useAuthStore } from "@/store/auth";
import { CheckCircle2, XCircle, AlertCircle, Loader2, Lightbulb, ArrowRight } from "lucide-react";

interface CredentialInputProps {
  platform: "meta" | "dv360";
  // Renamed in callers to `onComplete` — both names accepted for compatibility.
  onClose?: () => void;
  onComplete?: () => void;
}

interface TestResult {
  ok: boolean;
  platform: string;
  message: string;
  details?: string;
  hint?: string;
}

export default function CredentialInput({ platform, onClose, onComplete }: CredentialInputProps) {
  const router = useRouter();
  const { setMetaCredentials, setDV360Credentials } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const done = () => { onComplete?.(); onClose?.(); };

  const [metaForm, setMetaForm] = useState({
    accessToken: "",
    businessId: "",
    pixelIds: "",
  });

  const [dv360Form, setDV360Form] = useState({
    clientId: "",
    clientSecret: "",
    refreshToken: "",
    advertiserId: "",
    partnerId: "",
  });


  const inputClass =
    "w-full bg-white text-gray-900 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

  const testMetaConnection = async () => {
    setTesting(true);
    setTestResults(null);
    setError(null);
    try {
      const pixelIds = metaForm.pixelIds.split(",").map((id) => id.trim()).filter(Boolean);
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "meta",
          accessToken: metaForm.accessToken,
          businessId: metaForm.businessId,
          pixelIds,
        }),
      });
      const data = await res.json();
      setTestResults(data.results || []);
    } catch (e: any) {
      setError("Connection test failed: " + e.message);
    } finally {
      setTesting(false);
    }
  };

  const testDV360Connection = async () => {
    setTesting(true);
    setTestResults(null);
    setError(null);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "dv360",
          clientId: dv360Form.clientId,
          clientSecret: dv360Form.clientSecret,
          refreshToken: dv360Form.refreshToken,
          advertiserId: dv360Form.advertiserId,
          partnerId: dv360Form.partnerId || undefined,
        }),
      });
      const data = await res.json();
      setTestResults(data.results || []);
    } catch (e: any) {
      setError("Connection test failed: " + e.message);
    } finally {
      setTesting(false);
    }
  };

  const handleMetaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (!metaForm.accessToken.trim()) throw new Error("Access token is required");
      if (!metaForm.businessId.trim()) throw new Error("Business ID is required");
      // Pixel IDs are optional — they're auto-derived from the ad account
      // when missing, so users don't need to look them up upfront.
      const pixelIds = metaForm.pixelIds.split(",").map((id) => id.trim()).filter(Boolean);
      setMetaCredentials(metaForm.accessToken.trim(), metaForm.businessId.trim(), pixelIds);
      setMetaForm({ accessToken: "", businessId: "", pixelIds: "" });
      setSavedSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDV360Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (!dv360Form.clientId.trim()) throw new Error("OAuth Client ID is required");
      if (!dv360Form.clientSecret.trim()) throw new Error("OAuth Client Secret is required");
      if (!dv360Form.refreshToken.trim()) throw new Error("Refresh Token is required");
      if (!dv360Form.advertiserId.trim()) throw new Error("Advertiser ID is required");

      setDV360Credentials({
        clientId: dv360Form.clientId.trim(),
        clientSecret: dv360Form.clientSecret.trim(),
        refreshToken: dv360Form.refreshToken.trim(),
        advertiserId: dv360Form.advertiserId.trim().replace(/[^0-9]/g, ""),
        partnerId: dv360Form.partnerId.trim().replace(/[^0-9]/g, "") || undefined,
      });
      setDV360Form({ clientId: "", clientSecret: "", refreshToken: "", advertiserId: "", partnerId: "" });
      setSavedSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const renderTestResults = () => {
    if (!testResults) return null;
    const allOk = testResults.every((r) => r.ok);
    return (
      <div className={`border rounded-lg p-3 space-y-2 ${allOk ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
        <div className="font-semibold text-sm text-gray-900 mb-2">
          {allOk ? "All checks passed" : `${testResults.filter((r) => !r.ok).length} of ${testResults.length} checks failed`}
        </div>
        {testResults.map((r, idx) => (
          <div key={idx} className="flex items-start gap-2 text-sm">
            {r.ok ? (
              <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1">
              <div className="font-medium text-gray-900">
                {r.platform}: <span className="font-normal text-gray-700">{r.message}</span>
              </div>
              {r.details && <div className="text-xs text-gray-600 mt-1 font-mono bg-white p-1.5 rounded border border-gray-200">{r.details}</div>}
              {r.hint && (
                <div className="text-xs text-blue-700 mt-1 flex items-start gap-1">
                  <Lightbulb className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{r.hint}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Success screen — shows "Go to Dashboard" CTA after successful save.
  if (savedSuccess) {
    return (
      <div className="bg-green-50 border-2 border-green-300 rounded-xl p-6 text-center space-y-4">
        <div className="inline-flex items-center justify-center w-14 h-14 bg-green-500 rounded-full">
          <CheckCircle2 className="w-8 h-8 text-white" strokeWidth={2.5} />
        </div>
        <div>
          <h3 className="text-xl font-bold text-green-900">
            {platform === "meta" ? "Meta" : "DV360"} connected!
          </h3>
          <p className="text-green-700 text-sm mt-1">
            Your credentials are saved. Open the dashboard to see your live data.
          </p>
        </div>
        <button
          onClick={() => router.push("/app/dashboard")}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 transition shadow-sm"
        >
          Go to Dashboard
          <ArrowRight className="w-4 h-4" />
        </button>
        <div>
          <button
            onClick={() => { setSavedSuccess(false); done(); }}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Connect another account first
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {platform === "meta" ? (
        <form onSubmit={handleMetaSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              Access Token (User or System Token)
            </label>
            <textarea
              value={metaForm.accessToken}
              onChange={(e) => setMetaForm({ ...metaForm, accessToken: e.target.value })}
              placeholder="EAAB..."
              className={inputClass}
              rows={3}
            />
            <p className="text-gray-500 text-xs mt-1">
              Required scopes: ads_management, business_management, read_insights
            </p>
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              Ad Account ID
              <span className="ml-1 text-xs font-normal text-gray-500">— from Ads Manager URL (act_XXXXXXX)</span>
            </label>
            <input
              type="text"
              value={metaForm.businessId}
              onChange={(e) => setMetaForm({ ...metaForm, businessId: e.target.value })}
              placeholder="e.g., 123456789012345 or act_123456789012345"
              className={inputClass}
            />
            <p className="text-gray-500 text-xs mt-1">
              Find this in Ads Manager → Settings → Ad Account ID (the number after "act_").
            </p>
          </div>

          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              Pixel IDs (comma-separated)
              <span className="ml-1 text-xs font-normal text-gray-500">— optional</span>
            </label>
            <input
              type="text"
              value={metaForm.pixelIds}
              onChange={(e) => setMetaForm({ ...metaForm, pixelIds: e.target.value })}
              placeholder="Leave blank to auto-detect from your ad accounts"
              className={inputClass}
            />
            <p className="text-gray-500 text-xs mt-1">
              Skip this to audit all pixels in your account. Specify IDs to scope the audit to specific pixels.
            </p>
          </div>

          {renderTestResults()}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={testMetaConnection}
              disabled={testing || !metaForm.accessToken || !metaForm.businessId}
              className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 text-gray-700 font-semibold py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Test Connection
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2.5 px-4 rounded-lg transition"
            >
              {isLoading ? "Saving..." : "Connect Meta"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 px-4 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleDV360Submit} className="space-y-4">
          {/* REQUIRED #1 — OAuth Client ID */}
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              OAuth Client ID <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={dv360Form.clientId}
              onChange={(e) => setDV360Form({ ...dv360Form, clientId: e.target.value })}
              placeholder="e.g., 1234567890-abc123.apps.googleusercontent.com"
              className={inputClass}
            />
            <p className="text-gray-500 text-xs mt-1">
              From <code className="bg-gray-100 px-1 rounded">console.cloud.google.com → APIs &amp; Services → Credentials</code>. See the guide above for setup.
            </p>
          </div>

          {/* REQUIRED #2 — OAuth Client Secret */}
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              OAuth Client Secret <span className="text-red-600">*</span>
            </label>
            <input
              type="password"
              value={dv360Form.clientSecret}
              onChange={(e) => setDV360Form({ ...dv360Form, clientSecret: e.target.value })}
              placeholder="GOCSPX-..."
              className={inputClass}
            />
          </div>

          {/* REQUIRED #3 — Refresh Token */}
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              Refresh Token <span className="text-red-600">*</span>
            </label>
            <textarea
              value={dv360Form.refreshToken}
              onChange={(e) => setDV360Form({ ...dv360Form, refreshToken: e.target.value })}
              placeholder="1//0gExA-MEnW5lkCgYIARAAGBASNwF..."
              className={inputClass}
              rows={3}
            />
            <p className="text-gray-500 text-xs mt-1">
              From OAuth Playground with scopes <code className="bg-gray-100 px-1 rounded">display-video</code> + <code className="bg-gray-100 px-1 rounded">doubleclickbidmanager</code>. Starts with <code className="bg-gray-100 px-1 rounded">1//</code>.
            </p>
          </div>

          {/* REQUIRED #4 — Advertiser ID */}
          <div>
            <label className="block text-gray-700 text-sm font-semibold mb-2">
              DV360 Advertiser ID <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={dv360Form.advertiserId}
              onChange={(e) => setDV360Form({ ...dv360Form, advertiserId: e.target.value })}
              placeholder="e.g., 1234567"
              className={inputClass}
            />
            <p className="text-gray-500 text-xs mt-1">
              From the DV360 URL: <code className="bg-gray-100 px-1 rounded">displayvideo.google.com/#ng_nav/p/PARTNER/a/ADVERTISER/…</code>
            </p>
          </div>

          {/* Optional — Partner ID */}
          <details className="border border-gray-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 select-none">
              Optional — Partner ID (needed only for Floodlight config reads)
            </summary>
            <div className="p-4 border-t border-gray-200">
              <label className="block text-gray-700 text-sm font-semibold mb-2">
                DV360 Partner ID <span className="text-xs text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={dv360Form.partnerId}
                onChange={(e) => setDV360Form({ ...dv360Form, partnerId: e.target.value })}
                placeholder="e.g., 123456"
                className={inputClass}
              />
              <p className="text-gray-500 text-xs mt-1">
                The number after <code className="bg-gray-100 px-1 rounded">/p/</code> in the DV360 URL. Improves Floodlight group lookups.
              </p>
            </div>
          </details>

          {renderTestResults()}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={testDV360Connection}
              disabled={testing || !dv360Form.clientId || !dv360Form.clientSecret || !dv360Form.refreshToken || !dv360Form.advertiserId}
              className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 text-gray-700 font-semibold py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Test Connection
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-2.5 px-4 rounded-lg transition"
            >
              {isLoading ? "Saving..." : "Connect DV360"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 px-4 rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
