import { Button } from "@opus-magnum/dentaplus-ui/components/button";
import { Modal } from "@opus-magnum/dentaplus-ui/components/modal";
import { useState } from "react";
import type { Appointment } from "../lib/api.ts";
import { formatMinutes, toClinicTime } from "../lib/time.ts";

export interface MovePlace {
  startMin: number;
  staffName: string;
  siteName: string;
}

interface Props {
  appointment: Appointment;
  from: MovePlace;
  to: MovePlace;
  busy: boolean;
  error: string | null;
  onConfirm: (notifyPatient: boolean) => void;
  onCancel: () => void;
}

/** Asked after a visit is dropped somewhere new, so a slip of the mouse does not move a patient. */
export function MoveDialog({ appointment: a, from, to, busy, error, onConfirm, onCancel }: Props) {
  // Off by default: reception ticks it when the patient should hear about the change.
  const [notify, setNotify] = useState(false);
  const length = (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60_000;
  const place = (p: MovePlace) =>
    `${formatMinutes(p.startMin)}–${formatMinutes(p.startMin + length)} · ${p.staffName} · ${p.siteName}`;
  const day = toClinicTime(a.startsAt).date;

  return (
    <Modal title="Przenieść wizytę?" onClose={onCancel}>
      <div className="space-y-4 text-sm">
        <p className="font-medium">
          {a.patientName ?? a.title ?? "Blokada"}
          <span className="font-normal text-muted-foreground"> · {day}</span>
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Było</dt>
          <dd>{place(from)}</dd>
          <dt className="text-muted-foreground">Będzie</dt>
          <dd className="font-medium">{place(to)}</dd>
        </dl>
        {a.patientId && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Powiadom pacjenta SMS-em o nowym terminie
          </label>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => onConfirm(notify)} autoFocus>
            Przenieś
          </Button>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Anuluj
          </Button>
        </div>
      </div>
    </Modal>
  );
}
