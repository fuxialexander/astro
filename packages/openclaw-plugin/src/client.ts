/**
 * Astro API HTTP client for the OpenClaw plugin.
 *
 * Provides a thin, authenticated wrapper around the Astro backend REST API.
 * All tool implementations share this single client instance.
 */

export interface AstroClientConfig {
  /** Base URL of the Astro backend (e.g. http://localhost:3001) */
  serverUrl: string;
  /** Bearer token for API authentication. Empty string in local/no-auth mode. */
  authToken: string;
  /** Optional team ID sent as X-Team-Id header to scope requests. */
  teamId?: string;
}

export class AstroClient {
  private readonly serverUrl: string;
  private readonly authToken: string;
  private readonly teamId: string | undefined;

  constructor(config: AstroClientConfig) {
    this.serverUrl = config.serverUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
    this.teamId = config.teamId || undefined;
  }

  /**
   * Make an authenticated HTTP request to the Astro API.
   * Throws an {@link AstroApiError} if the response status is not 2xx.
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    if (this.teamId) {
      headers['X-Team-Id'] = this.teamId;
    }

    const url = `${this.serverUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({
        error: `HTTP ${response.status} ${response.statusText}`,
      })) as { error?: string };
      throw new AstroApiError(
        errorBody.error ?? `API request failed: ${response.status}`,
        response.status,
        method,
        path,
      );
    }

    return response.json() as Promise<T>;
  }

  /** Convenience: GET request */
  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /** Convenience: POST request */
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
}

/** Error thrown when the Astro API returns a non-2xx response. */
export class AstroApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly method: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = 'AstroApiError';
  }
}
