import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/context';
import { ApiError, connectMobileNotifications, getMobileNotificationsStatus } from '@/services';
import { Bell, Check, Copy, ExternalLink, RefreshCw, Smartphone } from 'lucide-react';

export function MobileNotificationsConnectionPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Connection state
  const [isConfigured, setIsConfigured] = useState(false);
  const [lastNotificationAt, setLastNotificationAt] = useState<string | null>(null);

  // Signature display (only shown once after generation)
  const [newSignature, setNewSignature] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Use ref to avoid dependency issues with getAccessToken
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);
      const token = await getAccessTokenRef.current();

      // Fetch status from dedicated endpoint
      const status = await getMobileNotificationsStatus(token);

      setIsConfigured(status.configured);
      setLastNotificationAt(status.lastNotificationAt);
    } catch (e) {
      if (e instanceof ApiError && e.message.includes('UNAUTHORIZED')) {
        setError('Please log in to access mobile notifications');
      } else {
        // Don't show error for empty results
        setIsConfigured(false);
        setLastNotificationAt(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch status on mount
  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleGenerateSignature = async (): Promise<void> => {
    setError(null);
    setSuccessMessage(null);
    setNewSignature(null);
    setCopied(false);

    try {
      setIsGenerating(true);
      const token = await getAccessTokenRef.current();
      const response = await connectMobileNotifications(token);

      setNewSignature(response.signature);
      setSuccessMessage(
        isConfigured
          ? 'New signature generated! Update your Tasker configuration with the new signature.'
          : 'Signature generated! Configure Tasker with this signature to start receiving notifications.'
      );

      // Refresh status from server to update Connection Status card
      await fetchStatus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to generate signature');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopySignature = async (): Promise<void> => {
    if (newSignature === null) return;

    try {
      await navigator.clipboard.writeText(newSignature);
      setCopied(true);
      setTimeout((): void => {
        setCopied(false);
      }, 3000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) {
      return 'just now';
    }
    if (diffMin < 60) {
      return `${String(diffMin)} minute${diffMin === 1 ? '' : 's'} ago`;
    }
    if (diffHour < 24) {
      return `${String(diffHour)} hour${diffHour === 1 ? '' : 's'} ago`;
    }
    if (diffDay < 7) {
      return `${String(diffDay)} day${diffDay === 1 ? '' : 's'} ago`;
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">Mobile Notifications</h2>
        <p className="text-slate-600">
          Capture notifications from your Android device using Tasker
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {error !== null && error !== '' ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
        ) : null}

        {successMessage !== null && successMessage !== '' ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
            {successMessage}
          </div>
        ) : null}

        {/* Signature Generation Card */}
        <Card title="Connection Setup">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Generate a signature to authenticate your mobile device. This signature is used by
              Tasker to send notifications to IntexuraOS.
            </p>

            {/* New Signature Display */}
            {newSignature !== null ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Bell className="h-5 w-5 text-amber-600" />
                  <span className="font-medium text-amber-800">
                    Important: Save this signature now!
                  </span>
                </div>
                <p className="mb-3 text-sm text-amber-700">
                  This signature is only shown once. Copy it and add it to your Tasker HTTP Request
                  header as{' '}
                  <code className="rounded bg-amber-100 px-1">
                    X-Mobile-Notifications-Signature
                  </code>
                  .
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto rounded bg-slate-800 px-3 py-2 font-mono text-sm text-green-400">
                    {newSignature}
                  </code>
                  <button
                    onClick={(): void => {
                      void handleCopySignature();
                    }}
                    className={`shrink-0 rounded-lg p-2 transition-colors ${
                      copied
                        ? 'bg-green-100 text-green-600'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    title={copied ? 'Copied!' : 'Copy signature'}
                  >
                    {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex gap-3">
              <Button
                onClick={(): void => {
                  void handleGenerateSignature();
                }}
                isLoading={isGenerating}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isGenerating ? 'animate-spin' : ''}`} />
                {isConfigured ? 'Regenerate Signature' : 'Generate Signature'}
              </Button>
            </div>

            {isConfigured && newSignature === null ? (
              <p className="text-sm text-slate-500">
                <strong>Note:</strong> Regenerating will invalidate your current signature. You will
                need to update your Tasker configuration with the new signature.
              </p>
            ) : null}
          </div>
        </Card>

        {/* Status Card */}
        <Card title="Connection Status" variant={isConfigured ? 'success' : 'default'}>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Status</dt>
              <dd className={`font-medium ${isConfigured ? 'text-green-700' : 'text-slate-500'}`}>
                {isConfigured ? 'Configured' : 'Not configured'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Last Notification</dt>
              <dd className="text-slate-900">
                {lastNotificationAt !== null
                  ? formatRelativeTime(lastNotificationAt)
                  : 'No notifications yet'}
              </dd>
            </div>
          </dl>
        </Card>

        {/* Setup Instructions Card */}
        <Card title="Setup Instructions">
          <div className="space-y-4 text-sm text-slate-600">
            <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600">
                1
              </div>
              <div>
                <p className="font-medium text-slate-800">Generate a signature</p>
                <p>Click the button above to generate your unique authentication signature.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600">
                2
              </div>
              <div>
                <p className="font-medium text-slate-800">Install Tasker & AutoNotification</p>
                <p>
                  Install{' '}
                  <a
                    href="https://play.google.com/store/apps/details?id=net.dinglisch.android.taskerm"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    Tasker
                  </a>{' '}
                  and{' '}
                  <a
                    href="https://play.google.com/store/apps/details?id=com.joaomgcd.autonotification"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    AutoNotification
                  </a>{' '}
                  on your Android device.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600">
                3
              </div>
              <div>
                <p className="font-medium text-slate-800">Configure your device</p>
                <p>
                  Follow our{' '}
                  <a
                    href="https://github.com/pbuchman/intexuraos/blob/main/docs/setup/08-mobile-notifications-xiaomi.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    detailed setup guide
                    <ExternalLink className="h-3 w-3" />
                  </a>{' '}
                  to configure Tasker with AutoNotification.
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 p-3">
              <Smartphone className="h-5 w-5 text-slate-400" />
              <span className="text-slate-500">
                Tested on Xiaomi devices with HyperOS. May require additional configuration on other
                manufacturers.
              </span>
            </div>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
