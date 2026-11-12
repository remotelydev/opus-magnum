# Patient registration on the iPad

Patients fill in the registration form on a clinic iPad at `/rejestracja`. Reception sees the
answers under **Rejestracje** in Horarium and turns each one into a patient card (or attaches it to
an existing card).

## Why the iPad needs no login, and why that is safe

- **Paired, not logged in.** Reception opens `/rejestracja` on the iPad and types their own login
  and password once. The server then gives the iPad a random device token in an HttpOnly cookie
  scoped to `/api/kiosk`. No staff session stays on the tablet.
- **Write-only.** The device token can fetch the form and send answers. It cannot open the
  calendar, the patient list or anything else, and a sent form returns nothing about the patient.
- **Revocable.** Every paired iPad is listed under Rejestracje → Tablety and can be cut off with
  one click (a lost or stolen tablet stops working at once). Staff can also unpair it on the
  tablet itself: hold the logo in the top left for 3 seconds, then log in.
- **Nothing left for the next patient.** Every patient starts from an empty form; field names change
  per page load so Safari does not suggest the previous patient's answers; after 2 minutes without a
  touch the form asks whether the patient is still there and clears itself 30 seconds later; the
  thank-you screen returns to the start after 15 seconds. Text size and dark mode go back to default.
- **Abuse limits.** More than 30 forms an hour from one tablet are refused. Pairing uses the same
  lockout as the login screen. Answers are checked on the server against the same form definition.
- **Reviewed before use.** Answers never go straight into the patient database: reception reviews
  them first. Every step is in the change log (`intake.submit`, `intake.view`, `intake.accept`,
  `kiosk.pair`, `kiosk.revoke`), without medical content.

## Setting up an iPad (once)

1. In Safari open `http://<clinic server>/rejestracja`, log in with a reception login, pick the site
   and name the tablet.
2. Share → **Add to Home Screen**, then open the form from the home screen icon (full screen, no
   address bar).
3. Settings → Accessibility → **Guided Access**: turn it on and set a passcode.
4. Open the form, triple-click the side (or Home) button and start Guided Access. The patient now
   cannot leave the app, switch apps or open the address bar. Triple-click and the passcode end it.
5. Settings → Display & Brightness → Auto-Lock: **Never** (keep the tablet on its charger).

Inside the page the browser's back gesture is swallowed and there are no links, but only Guided
Access stops a patient from leaving Safari altogether, so use it.

## The questions

The form is defined in `src/intake-form.ts` (`FORM`). The questions there are samples until the
clinic supplies the real ones. Each field can say where its answer goes on the patient card
(`patient`), which answers add a medical flag (`flag` on an option) and which are copied into the
card's notes (`notesLabel`). Address fields are kept with the registration; the patient card has no
address yet.
