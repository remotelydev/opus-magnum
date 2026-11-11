import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Appointment, type ScheduleBlock } from "./api.ts";
import { addDays, fromClinicTime } from "./time.ts";

const REFRESH_MS = 30_000;

/**
 * One site's visits and schedules for one day, refreshed every 30 s. Shared by the calendar and the
 * staff panel, so both know who works that day from a single request.
 */
export function useDayData(site: string, date: string, enabled = true) {
  const key = `${site}|${date}`;
  const [data, setData] = useState<{ key: string; appointments: Appointment[]; schedules: ScheduleBlock[] }>({
    key: "",
    appointments: [],
    schedules: [],
  });
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(key);
  latest.current = key;

  const range = useMemo(
    () => ({ from: fromClinicTime(date, 0).toISOString(), to: fromClinicTime(addDays(date, 1), 0).toISOString() }),
    [date],
  );

  const reload = useCallback(async () => {
    try {
      const [appointments, schedules] = await Promise.all([
        api.appointments(site, range.from, range.to),
        api.schedules(site, range.from, range.to),
      ]);
      // A slow answer for a day the user already left must not overwrite the new day.
      if (latest.current !== key) return;
      setData({ key, appointments, schedules });
      setError(null);
    } catch (e) {
      if (latest.current === key) setError((e as Error).message);
    }
  }, [site, range, key]);

  useEffect(() => {
    if (!enabled) return;
    reload();
    const timer = setInterval(reload, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload, enabled]);

  const loaded = data.key === key;
  return {
    loaded,
    appointments: loaded ? data.appointments : [],
    schedules: loaded ? data.schedules : [],
    error,
    reload,
  };
}
