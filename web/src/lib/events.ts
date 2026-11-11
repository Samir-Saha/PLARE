import { api, post } from "./api";

export type Rsvp = "invited" | "yes" | "no" | "maybe";
export type EventGuest = { user_id: string; name: string; response: Rsvp };
export type CalEvent = {
  id: string; title: string; description: string; location: string;
  start_at: string; end_at: string;
  required_rsvps: number; going: number; needed: number;
  /** true once `going` reaches `required_rsvps`; the page shows the event green. */
  confirmed: boolean;
  my_response: Rsvp | null; // null = you weren't invited
  created_by: string; created_by_name: string;
  guests: EventGuest[];
};
export type NewEvent = {
  title: string; description?: string; location?: string;
  start_at: string; end_at: string; required_rsvps: number; guest_ids: string[];
};
export type OrgMember = { user_id: string; name: string; role: "admin" | "lead" | "member" };

export const listEvents = (orgId: string) => api<CalEvent[]>(`/orgs/${orgId}/events`);
export const createEvent = (orgId: string, body: NewEvent) => post<CalEvent>(`/orgs/${orgId}/events`, body);
export const deleteEvent = (id: string) => api<void>(`/events/${id}`, { method: "DELETE" });
export const setRsvp = (id: string, response: "yes" | "no" | "maybe") =>
  api<CalEvent>(`/events/${id}/rsvp`, { method: "PUT", body: JSON.stringify({ response }) });
export const listMembers = (orgId: string) => api<OrgMember[]>(`/orgs/${orgId}/members`);

/** Local calendar date (YYYY-MM-DD) of an instant, in the given timezone. */
export const dayKey = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export const RSVP_LABEL: Record<Rsvp, string> = { invited: "No answer", yes: "Going", maybe: "Maybe", no: "Can't go" };
