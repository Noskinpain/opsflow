export interface WebhookDispatchResult {
  dispatched: boolean;
  webhookUrl?: string;
  eventType: string;
  error?: string;
}

export class WebhookService {
  /**
   * Dispatches workflow events to external orchestration tools like n8n.
   * Milestone 7/8 readiness: Core business logic remains strictly in our app;
   * n8n receives webhooks for peripheral orchestration (Slack, emails, external ERP sync).
   */
  static async dispatch(eventType: string, payload: any): Promise<WebhookDispatchResult> {
    const webhookUrl = process.env.N8N_WEBHOOK_URL;

    if (!webhookUrl) {
      // Mock dispatch / log for development
      return {
        dispatched: false,
        eventType,
      };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Business-Operations-Automation-Engine/1.0',
        },
        body: JSON.stringify({
          event: eventType,
          timestamp: new Date().toISOString(),
          data: payload,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return {
        dispatched: res.ok,
        webhookUrl,
        eventType,
      };
    } catch (err: any) {
      console.warn(`[WebhookService] Webhook dispatch to ${webhookUrl} failed gracefully:`, err.message);
      return {
        dispatched: false,
        webhookUrl,
        eventType,
        error: err.message,
      };
    }
  }
}
