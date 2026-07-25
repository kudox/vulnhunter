/**
 * Minimal Eventbrite v3 API client.
 *
 * Scope note: Eventbrite retired its public event-search endpoint in 2020,
 * so ingestion is organization-scoped — a merchant connects their Eventbrite
 * account (private token / OAuth) and LastCall reads *their* live events and
 * ticket availability. That matches the supply model anyway: offers come from
 * merchants who opted in, not from scraping a public firehose.
 */

const API_BASE = "https://www.eventbriteapi.com/v3";
const REQUEST_TIMEOUT_MS = 30_000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// --- Subset of the Eventbrite API payloads we consume ---

export interface EbOrganization {
  id: string;
  name: string;
}

export interface EbMultipartText {
  text?: string | null;
  html?: string | null;
}

export interface EbDatetime {
  utc: string;
  timezone?: string;
}

export interface EbAddress {
  address_1?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
}

export interface EbVenue {
  id: string;
  name?: string | null;
  address?: EbAddress | null;
}

export interface EbTicketPrice {
  /** Integer minor units, e.g. cents. */
  value: number;
  currency: string;
}

export interface EbTicketAvailability {
  has_available_tickets?: boolean;
  is_sold_out?: boolean;
  minimum_ticket_price?: EbTicketPrice | null;
  maximum_ticket_price?: EbTicketPrice | null;
}

export interface EbEvent {
  id: string;
  name?: EbMultipartText | null;
  summary?: string | null;
  description?: EbMultipartText | null;
  url?: string;
  start?: EbDatetime | null;
  end?: EbDatetime | null;
  status?: string;
  is_free?: boolean;
  category_id?: string | null;
  venue?: EbVenue | null;
  ticket_availability?: EbTicketAvailability | null;
}

export interface EbTicketClass {
  id: string;
  name?: string;
  free?: boolean;
  donation?: boolean;
  hidden?: boolean;
  cost?: EbTicketPrice | null;
  quantity_total?: number | null;
  quantity_sold?: number | null;
}

interface EbPagination {
  has_more_items?: boolean;
  continuation?: string;
}

export class EventbriteApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EventbriteApiError";
  }
}

export class EventbriteClient {
  private readonly token: string;
  private readonly fetchFn: FetchLike;

  constructor(token: string, fetchFn: FetchLike = fetch) {
    this.token = token;
    this.fetchFn = fetchFn;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const response = await this.fetchFn(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      switch (response.status) {
        case 401:
          throw new EventbriteApiError(
            "Eventbrite rejected the API token (401). Check EVENTBRITE_API_TOKEN — generate one at eventbrite.com > Account Settings > Developer Links > API Keys.",
            401,
          );
        case 404:
          throw new EventbriteApiError(`Eventbrite resource not found: ${path}`, 404);
        case 429:
          throw new EventbriteApiError(
            "Eventbrite rate limit exceeded (429). Lower the sync frequency (EVENTBRITE_REFRESH_MINUTES) and retry later.",
            429,
          );
        default:
          throw new EventbriteApiError(
            `Eventbrite API request failed: ${response.status} ${response.statusText} (${path})`,
            response.status,
          );
      }
    }
    return (await response.json()) as T;
  }

  /** Follow continuation-token pagination, collecting `key` arrays from each page. */
  private async getAllPages<T>(
    path: string,
    key: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const items: T[] = [];
    let continuation: string | undefined;
    // Hard page cap as a runaway guard; org event lists are small in practice.
    for (let page = 0; page < 20; page++) {
      const query = { ...params, ...(continuation ? { continuation } : {}) };
      const body = await this.get<Record<string, unknown> & { pagination?: EbPagination }>(
        path,
        query,
      );
      items.push(...((body[key] as T[] | undefined) ?? []));
      if (!body.pagination?.has_more_items || !body.pagination.continuation) break;
      continuation = body.pagination.continuation;
    }
    return items;
  }

  listOrganizations(): Promise<EbOrganization[]> {
    return this.getAllPages<EbOrganization>("/users/me/organizations/", "organizations");
  }

  /** Live (published, upcoming) events for an organization, with venue + availability. */
  listLiveEvents(organizationId: string): Promise<EbEvent[]> {
    return this.getAllPages<EbEvent>(`/organizations/${organizationId}/events/`, "events", {
      status: "live",
      order_by: "start_asc",
      expand: "venue,ticket_availability",
    });
  }

  listTicketClasses(eventId: string): Promise<EbTicketClass[]> {
    return this.getAllPages<EbTicketClass>(`/events/${eventId}/ticket_classes/`, "ticket_classes");
  }
}
