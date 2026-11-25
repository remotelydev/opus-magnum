import { useState } from "react";
import { attachmentUrl, type Attachment, type DentalEntry } from "../lib/api.ts";
import { surfaceLabel } from "../lib/dental.ts";
import { toClinicTime } from "../lib/time.ts";

const dateFmt = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const formatDay = (iso: string) => dateFmt.format(new Date(`${toClinicTime(iso).date}T12:00:00Z`));

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Entries of the dental diagram kept in Versum, newest first. Read-only. */
export function DentalHistory({ entries }: { entries: DentalEntry[] }) {
  if (!entries.length) return null;
  return (
    <details className="space-y-2">
      <summary className="cursor-pointer text-sm font-medium">Diagram uzębienia z Versum ({entries.length})</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-normal">Data</th>
              <th className="py-1 pr-3 font-normal">Ząb</th>
              <th className="py-1 pr-3 font-normal">Rozpoznanie</th>
              <th className="py-1 pr-3 font-normal">Leczenie</th>
              <th className="py-1 pr-3 font-normal">Lekarz</th>
              <th className="py-1 font-normal">Opis</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-border align-top">
                <td className="whitespace-nowrap py-1 pr-3">{formatDay(e.recordedAt)}</td>
                <td className="whitespace-nowrap py-1 pr-3">
                  {e.color && (
                    <span aria-hidden className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: e.color }} />
                  )}
                  {e.tooth}
                  {surfaceLabel(e.tooth, e.surface) && (
                    <span className="text-muted-foreground"> · {surfaceLabel(e.tooth, e.surface)}</span>
                  )}
                </td>
                <td className="py-1 pr-3">{e.diagnosis ?? "—"}</td>
                <td className="py-1 pr-3">{e.treatment ?? "—"}</td>
                <td className="py-1 pr-3">{e.doctorName ?? "—"}</td>
                <td className="whitespace-pre-line py-1">{e.description ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Photos and files attached to the card. Photos load only when the section is opened (each view is logged). */
export function Attachments({ patientId, items }: { patientId: number; items: Attachment[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const photos = items.filter((a) => a.kind === "photo");
  const files = items.filter((a) => a.kind === "file");
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">
        Zdjęcia i pliki ({[photos.length && `${photos.length} zdj.`, files.length && `${files.length} plików`].filter(Boolean).join(", ")})
      </summary>
      {open && (
        <div className="mt-2 space-y-3">
          {photos.length > 0 && (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2">
              {photos.map((a) => (
                <li key={a.id} className="space-y-1 text-xs">
                  <a href={attachmentUrl(patientId, a.id)} target="_blank" rel="noreferrer">
                    <img
                      src={attachmentUrl(patientId, a.id)}
                      alt={a.description ?? a.name}
                      loading="lazy"
                      className="aspect-square w-full rounded-md border border-border object-cover"
                    />
                  </a>
                  <p className="truncate text-muted-foreground" title={a.description ?? a.name}>
                    {formatDay(a.addedAt)}
                    {a.description ? ` · ${a.description}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {files.length > 0 && (
            <ul className="space-y-1 text-sm">
              {files.map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-x-2">
                  <a href={attachmentUrl(patientId, a.id)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                    {a.name}
                  </a>
                  <span className="text-xs text-muted-foreground">
                    {formatDay(a.addedAt)} · {formatSize(a.size)}
                    {a.description ? ` · ${a.description}` : ""}
                  </span>
                  <a href={attachmentUrl(patientId, a.id, true)} className="text-xs underline-offset-2 hover:underline">
                    pobierz
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}
