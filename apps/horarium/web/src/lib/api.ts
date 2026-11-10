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
  active: boolean;
  sites: string[];
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
  searchPatients: (q: string) => request<Patient[]>("GET", `/api/patients?${qs({ q, limit: 15 })}`),
  patient: (id: number) => request<Patient & { appointments: Appointment[] }>("GET", `/api/patients/${id}`),
  createPatient: (body: Partial<Patient>) => request<{ id: number }>("POST", "/api/patients", body),
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
