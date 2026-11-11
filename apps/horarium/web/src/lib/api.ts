// Thin client for the clinic API. The session lives in an HttpOnly cookie set at login.
export interface User {
  id: number;
  login: string;
  name: string;
  role: "admin" | "reception" | "doctor";
}
export interface Site {
  id: string;
  name: string;
}
export interface Staff {
  id: number;
  name: string;
  kind: "person" | "calendar";
  title: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  sortOrder: number;
  sites: string[];
}
export type StaffInput = Omit<Staff, "id">;
/** One opening range of a site on a weekday (1 = Monday ... 7 = Sunday), clinic time "HH:MM". */
export interface OpeningDay {
  weekday: number;
  opens: string;
  closes: string;
}
export interface OpeningException {
  date: string;
  opens: string | null;
  closes: string | null;
  closed: boolean;
  note: string | null;
}
export interface SiteOpening {
  id: string;
  name: string;
  week: OpeningDay[];
  exceptions: OpeningException[];
}
/** One range of a person's weekly work pattern. */
export interface PatternDay {
  weekday: number;
  siteId: string;
  starts: string;
  ends: string;
}
export interface Service {
  id: number;
  category: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMin: number | null;
  priceMax: number | null;
  priceNote: string | null;
  showOnline: boolean;
  sortOrder: number;
  active: boolean;
}
export type ServiceInput = Omit<Service, "id">;
export interface Patient {
  id: number;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  medicalFlags: string[];
  notes: string | null;
  smsConsent: boolean;
}
/** What the patient search returns: no notes or medical flags. */
export type PatientSummary = Pick<Patient, "id" | "firstName" | "lastName" | "phone" | "birthDate">;
export interface PatientPage {
  items: PatientSummary[];
  total: number;
  page: number;
  pageSize: number;
}
export interface HistoryEntry {
  id: number;
  at: string;
  action: string;
  entity: "patient" | "appointment";
  entityId: string;
  changes: Record<string, unknown> | null;
  userName: string | null;
}
export type AppointmentStatus = "booked" | "confirmed" | "cancelled" | "no_show" | "done";
export interface Appointment {
  id: number;
  siteId: string;
  staffId: number;
  patientId: number | null;
  patientName: string | null;
  serviceId: number | null;
  serviceName: string | null;
  title: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  source: "desk" | "bot" | "import";
  notes: string | null;
}
export interface ScheduleBlock {
  id: number;
  staffId: number;
  siteId: string;
  startsAt: string;
  endsAt: string;
  kind: "work" | "absence";
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Błąd ${res.status}`);
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
  ).toString();

export const api = {
  login: (login: string, password: string) => request<{ user: User }>("POST", "/api/auth/login", { login, password }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  me: () => request<User>("GET", "/api/me"),
  sites: () => request<Site[]>("GET", "/api/sites"),
  staff: () => request<Staff[]>("GET", "/api/staff"),
  services: () => request<Service[]>("GET", "/api/services"),
  allServices: () => request<Service[]>("GET", "/api/services?all=true"),
  createService: (body: Partial<ServiceInput>) => request<{ id: number }>("POST", "/api/services", body),
  updateService: (id: number, body: Partial<ServiceInput>) => request<{ ok: true }>("PATCH", `/api/services/${id}`, body),
  createStaff: (body: Partial<StaffInput>) => request<{ id: number }>("POST", "/api/staff", body),
  updateStaff: (id: number, body: Partial<StaffInput>) => request<{ ok: true }>("PATCH", `/api/staff/${id}`, body),
  openingHours: () => request<{ timezone: string; sites: SiteOpening[] }>("GET", "/api/opening-hours"),
  saveOpeningWeek: (site: string, week: OpeningDay[]) => request<{ ok: true }>("PUT", `/api/opening-hours/${site}`, { week }),
  saveOpeningException: (site: string, date: string, body: { opens: string | null; closes: string | null; note: string | null }) =>
    request<{ ok: true }>("PUT", `/api/opening-hours/${site}/exceptions/${date}`, body),
  deleteOpeningException: (site: string, date: string) =>
    request<{ ok: true }>("DELETE", `/api/opening-hours/${site}/exceptions/${date}`),
  workPattern: (staffId: number) => request<PatternDay[]>("GET", `/api/staff/${staffId}/pattern`),
  saveWorkPattern: (staffId: number, days: PatternDay[]) => request<{ ok: true }>("PUT", `/api/staff/${staffId}/pattern`, { days }),
  generateSchedule: (staffId: number, from: string, to: string) =>
    request<{ created: number; removed: number; skippedClosed: number }>("POST", `/api/staff/${staffId}/schedule/generate`, { from, to }),
  staffSchedules: (staffId: number, from: string, to: string) =>
    request<ScheduleBlock[]>("GET", `/api/staff/${staffId}/schedules?${qs({ from, to })}`),
  createSchedule: (body: { staffId: number; siteId: string; startsAt: string; endsAt: string; kind: "work" | "absence" }) =>
    request<{ id: number }>("POST", "/api/schedules", body),
  deleteSchedule: (id: number) => request<{ ok: true }>("DELETE", `/api/schedules/${id}`),
  searchPatients: (q: string) => request<PatientSummary[]>("GET", `/api/patients?${qs({ q, limit: 15 })}`),
  listPatients: (q: string, page: number, pageSize: number) =>
    request<PatientPage>("GET", `/api/patients/list?${qs({ q, page, pageSize })}`),
  patient: (id: number) => request<Patient & { appointments: Appointment[] }>("GET", `/api/patients/${id}`),
  patientHistory: (id: number) => request<HistoryEntry[]>("GET", `/api/patients/${id}/history`),
  createPatient: (body: Partial<Patient>) => request<{ id: number }>("POST", "/api/patients", body),
  updatePatient: (id: number, body: Partial<Omit<Patient, "id">>) =>
    request<{ ok: true }>("PATCH", `/api/patients/${id}`, body),
  appointments: (site: string, from: string, to: string) =>
    request<Appointment[]>("GET", `/api/appointments?${qs({ site, from, to })}`),
  schedules: (site: string, from: string, to: string) =>
    request<ScheduleBlock[]>("GET", `/api/schedules?${qs({ site, from, to })}`),
  createAppointment: (body: {
    siteId: string;
    staffId: number;
    patientId?: number | null;
    serviceId?: number | null;
    title?: string | null;
    startsAt: string;
    endsAt?: string;
    notes?: string | null;
  }) => request<{ id: number; endsAt: string; warnings: string[] }>("POST", "/api/appointments", body),
  updateAppointment: (
    id: number,
    body: Partial<{ staffId: number; startsAt: string; endsAt: string; status: AppointmentStatus; notes: string | null }>,
  ) => request<{ ok: true; endsAt: string; warnings: string[] }>("PATCH", `/api/appointments/${id}`, body),
};

export { STATUS_LABEL } from "@opus-magnum/dentaplus-ui/components/status";
